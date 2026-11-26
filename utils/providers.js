// utils/providers.js - Multi-provider AI clients (Gemini, Groq, Cerebras, OpenAI/NIM/OpenRouter) & Dynamic Orchestrator
import { extractCodeBlock, parseMultiFileSolution } from './code-format.js';
import { extractCommandsFromResponse } from './commands.js';
import { SYSTEM_PROMPT, buildPrompt, buildCompactGroqMessages, getContextGatedSystemPrompt } from './prompts.js';
import { analyzeFileModificationPlan, enforceFilePlan } from './file-planner.js';
import { formatFullCollaborationHistory } from './attempt-history.js';
import {
  getConfiguredProviders,
  planModelOrchestration,
  recordProviderOutcome,
  isUsableProviderResult,
  validateApiKeyFormat
} from './orchestrator.js';

export const DEFAULT_SETTINGS = {
  provider: 'auto', // 'auto' (Dynamic Smart Orchestrator) | 'race' | 'gemini' | 'groq' | 'cerebras' | 'openai'
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  groqKey: '',
  groqModel: 'openai/gpt-oss-120b',
  cerebrasKey: '',
  cerebrasModel: 'gpt-oss-120b',
  openaiKey: '',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  autoSubmit: true,
  autoRetry: true,
  maxRetries: 5,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(updates) {
  await chrome.storage.local.set(updates);
  return getSettings();
}

function finalizeProviderResult(text, model, settings) {
  const commands = extractCommandsFromResponse(text);
  const parsed = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
  const { files, blockedFiles, remappedFiles } = settings.filePlan
    ? enforceFilePlan(parsed, settings.filePlan)
    : { files: parsed, blockedFiles: [], remappedFiles: [] };
  return {
    raw: text,
    code: files.length > 0 ? files[0].code : extractCodeBlock(text),
    files,
    commands,
    blockedFiles,
    remappedFiles,
    filePlan: settings.filePlan || null,
    model,
    debugEscalated: !!settings.isDebugMode
  };
}

export async function callGemini(prompt, settings) {
  const apiKey = settings.geminiKey?.trim();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please set it in AP-Solver settings.');
  }

  let requestedModel = (settings.geminiModel || 'gemini-2.5-flash').trim();
  if (!requestedModel || /1\.5|3\.5|3\.8/.test(requestedModel)) {
    requestedModel = 'gemini-2.5-flash';
  }

  const isDebug = !!settings.isDebugMode;
  const modelsToTry = isDebug
    ? (
        /pro/i.test(requestedModel)
          ? [requestedModel, 'gemini-2.5-pro', 'gemini-pro-latest', 'gemini-2.5-flash', 'gemini-flash-latest']
          : ['gemini-2.5-pro', requestedModel, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-pro-latest']
      ).filter(Boolean)
    : [
        requestedModel === 'gemini-2.5-pro' ? 'gemini-2.5-flash' : requestedModel,
        'gemini-2.5-flash',
        'gemini-flash-latest',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite'
      ].filter(Boolean);
  const uniqueModels = [...new Set(modelsToTry)];

  const gatedSysPrompt = getContextGatedSystemPrompt(prompt, isDebug);
  let lastError = null;
  let seenPro429 = false;

  for (const model of uniqueModels) {
    if (seenPro429 && /pro/i.test(model)) continue;
    if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 3000) break;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const maxOut = /1\.5|2\.0/.test(model) ? 8192 : (isDebug ? 12288 : 8192);
    const isGemini3 = /^gemini-3/i.test(model);
    const isProModel = /pro/i.test(model);

    // Gemini 2.5 models use thinkingBudget (thinkingLevel triggers HTTP 400 on 2.5)
    const configsToTry = isDebug
      ? (isGemini3
          ? [
              { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut, thinkingConfig: { thinkingLevel: 'high' } },
              { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut, thinkingConfig: { thinkingBudget: 8192 } },
              { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut }
            ]
          : isProModel
            ? [
                { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut, thinkingConfig: { thinkingBudget: 4096 } },
                { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut }
              ]
            : [
                { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut, thinkingConfig: { thinkingBudget: 2048 } },
                { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut }
              ])
      : [
          ...(isGemini3
            ? [{ temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut, thinkingConfig: { thinkingLevel: 'low' } }]
            : /2\.5/.test(model)
              ? [{ temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut, thinkingConfig: { thinkingBudget: 0 } }]
              : []),
          { temperature: 0.1, topP: 0.95, maxOutputTokens: maxOut }
        ];

    for (const genConfig of configsToTry) {
      if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 2000) break;
      const remainingMs = settings.deadlineAt ? Math.max(8000, settings.deadlineAt - Date.now()) : (isDebug ? 50000 : 35000);
      const reqTimeoutMs = Math.min(isDebug ? (isProModel ? 45000 : 35000) : 30000, remainingMs);

      const payload = {
        contents: [{ role: 'user', parts: [{ text: gatedSysPrompt + '\n\n' + prompt }] }],
        generationConfig: genConfig
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), reqTimeoutMs);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errText = await resp.text();
          let msg = `Gemini API error (${resp.status})`;
          try {
            const errJson = JSON.parse(errText);
            msg += `: ${errJson.error?.message || errText}`;
          } catch {
            msg += `: ${errText}`;
          }

          if (resp.status === 400) {
            console.warn(`[AP-Solver] Gemini 400 on ${model} (${msg}), trying fallback config/model...`);
            lastError = new Error(msg);
            continue;
          }
          if (resp.status === 403 || resp.status === 404 || resp.status === 429 || resp.status >= 500 || /not found|no longer available|high demand|unavailable|quota|permission|API key/i.test(msg)) {
            console.warn(`[AP-Solver] Gemini model ${model} unavailable (${resp.status}), trying next candidate...`);
            lastError = new Error(msg);
            if (resp.status === 429 && isProModel) seenPro429 = true;
            if (resp.status === 429 && !isProModel) await new Promise(r => setTimeout(r, 800));
            break;
          }
          throw new Error(msg);
        }

        const data = await resp.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const hasThoughtParts = parts.some(p => p.thought);
        const codeParts = parts.filter(p => !p.thought && p.text).map(p => p.text);
        const text = (codeParts.length > 0
          ? codeParts.join('\n')
          : (hasThoughtParts ? '' : parts.map(p => p.text || '').join('\n'))
        ).trim();

        if (!text) {
          const finishReason = candidate?.finishReason || 'unknown';
          console.warn(`[AP-Solver] Gemini model ${model} returned empty content (finishReason=${finishReason}), trying next config/model...`);
          lastError = new Error(`Gemini returned an empty response (${finishReason}).`);
          if (genConfig === configsToTry[configsToTry.length - 1]) break;
          continue;
        }

        return finalizeProviderResult(text, model, settings);
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          lastError = new Error(`Gemini model ${model} request timed out.`);
          break;
        }
        if (err.message && (err.message.includes('404') || err.message.includes('429') || /\b5\d{2}\b/.test(err.message) || /unavailable|no longer available|quota|empty response|Failed to fetch|network/i.test(err.message))) {
          lastError = err;
          break;
        }
        throw err;
      }
    }
  }

  throw lastError || new Error('All Gemini model candidates failed.');
}

export async function callGroq(prompt, settings) {
  const apiKey = settings.groqKey?.trim();
  if (!apiKey) {
    throw new Error('Groq API key is missing. Please set it in AP-Solver settings.');
  }

  let requestedModel = (settings.groqModel || '').trim();
  if (!requestedModel || requestedModel.includes('llama') || requestedModel.includes('mixtral') || requestedModel.includes('qwen-2.5')) {
    requestedModel = 'openai/gpt-oss-120b';
  }

  const modelsToTry = [
    requestedModel,
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3-32b',
    'moonshotai/kimi-k2-instruct'
  ].filter(Boolean);
  const uniqueModels = [...new Set(modelsToTry)];

  const isDebug = !!settings.isDebugMode;
  let lastError = null;
  let primaryNon404Error = null;

  for (const model of uniqueModels) {
    if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 3000) break;
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const compact4K = buildCompactGroqMessages(SYSTEM_PROMPT, prompt, 4200, 7600);
    const estFullInputTokens = Math.ceil((compact4K.sys.length + prompt.length) / 3.0);
    const isSmallerReasoningModel = /(?:^|[-/])(?:20b|qwen)/i.test(model);
    const payloadsToTry = isDebug
      ? [
          ...(!isSmallerReasoningModel && estFullInputTokens < 2200
            ? [
                {
                  model,
                  messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 16384,
                  reasoning_effort: 'high'
                },
                {
                  model,
                  messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 6144,
                  reasoning_effort: 'medium'
                },
                {
                  model,
                  messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 6144,
                  reasoning_effort: 'low'
                }
              ]
            : []),
          {
            model,
            messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: compact4K.compactPrompt }],
            temperature: 0.1,
            max_tokens: compact4K.safeMaxTokens,
            reasoning_effort: 'low'
          },
          {
            model,
            messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: compact4K.compactPrompt }],
            temperature: 0.1,
            max_tokens: compact4K.safeMaxTokens
          }
        ]
      : [
          {
            model,
            messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: estFullInputTokens < 2200 ? prompt : compact4K.compactPrompt }],
            temperature: 0.1,
            max_tokens: Math.min(8192, Math.max(3600, compact4K.safeMaxTokens)),
            reasoning_effort: 'low'
          },
          {
            model,
            messages: [{ role: 'system', content: compact4K.sys }, { role: 'user', content: compact4K.compactPrompt }],
            temperature: 0.1,
            max_tokens: compact4K.safeMaxTokens
          }
        ];

    let waited429 = false;
    for (let pi = 0; pi < payloadsToTry.length; pi++) {
      if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 2000) break;
      const payload = payloadsToTry[pi];
      const controller = new AbortController();
      const timeoutMs = payload.reasoning_effort ? 35000 : 28000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errText = await resp.text();
          let msg = `Groq API error (${resp.status})`;
          try {
            const errJson = JSON.parse(errText);
            msg += `: ${errJson.error?.message || errText}`;
          } catch {
            msg += `: ${errText}`;
          }

          if (resp.status === 413 || /too large|TPM/i.test(msg)) {
            const limM = msg.match(/Limit\s+(\d+)/i);
            const parsedLim = limM ? parseInt(limM[1], 10) : 7600;
            const tight = buildCompactGroqMessages(SYSTEM_PROMPT, prompt, 3000, Math.max(4200, parsedLim - 300));
            if (pi === payloadsToTry.length - 1 && !payload._tightRetried) {
              payloadsToTry.push({
                model,
                messages: [{ role: 'system', content: tight.sys }, { role: 'user', content: tight.compactPrompt }],
                temperature: 0.1,
                max_tokens: tight.safeMaxTokens,
                _tightRetried: true
              });
            }
            console.warn(`[AP-Solver] Groq ${model} (413, max_tokens=${payload.max_tokens}) stepped down cleanly for TPM limit...`);
            lastError = new Error(msg);
            primaryNon404Error = primaryNon404Error || lastError;
            continue;
          }

          if (resp.status === 400 && (payload.reasoning_effort || payload.max_tokens > 2048)) {
            console.warn(`[AP-Solver] Groq ${model} (400, max_tokens=${payload.max_tokens}) stepped down to fallback payload...`);
            lastError = new Error(msg);
            primaryNon404Error = primaryNon404Error || lastError;
            continue;
          }

          const isDailyTPD = /TPD|tokens per day|Please try again in \d+[mh]/i.test(msg);
          if (resp.status === 429 && !isDailyTPD && !waited429) {
            waited429 = true;
            console.warn(`[AP-Solver] Groq ${model} RPM rate-limited (429), retrying briefly...`);
            lastError = new Error(msg);
            primaryNon404Error = primaryNon404Error || lastError;
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }

          if (resp.status === 403 || resp.status === 404 || resp.status === 413 || resp.status === 429 || resp.status >= 500 || /does not exist|access|decommissioned|rate limit|too large|TPM|TPD|RPM|unavailable|overloaded/i.test(msg)) {
            console.warn(`[AP-Solver] Groq model ${model} unavailable (${resp.status}), trying next model...`);
            lastError = new Error(msg);
            if (resp.status !== 404) primaryNon404Error = primaryNon404Error || lastError;
            break;
          }

          throw new Error(msg);
        }

        const data = await resp.json();
        const choice = data.choices?.[0];
        const rawContent = choice?.message?.content;
        const text = typeof rawContent === 'string' ? rawContent.trim() : '';
        if (!text) {
          const finishReason = choice?.finish_reason || 'unknown';
          if (payload.reasoning_effort) {
            console.warn(`[AP-Solver] Groq ${model} returned empty content (finish_reason=${finishReason}, reasoning=${payload.reasoning_effort}), stepping down...`);
            lastError = new Error(`Groq returned an empty response (${finishReason}).`);
            primaryNon404Error = primaryNon404Error || lastError;
            continue;
          }
          console.warn(`[AP-Solver] Groq ${model} returned empty content (finish_reason=${finishReason}), skipping to next model...`);
          lastError = new Error(`Groq returned an empty response (${finishReason}).`);
          primaryNon404Error = primaryNon404Error || lastError;
          break;
        }

        return finalizeProviderResult(text, model, settings);
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          console.warn(`[AP-Solver] Groq ${model} timed out after ${timeoutMs}ms, trying fallback...`);
          lastError = new Error(`Groq model ${model} timed out.`);
          primaryNon404Error = primaryNon404Error || lastError;
          continue;
        }
        if (err.message && (err.message.includes('404') || err.message.includes('413') || err.message.includes('429') || /\b5\d{2}\b/.test(err.message) || /too large|TPM|RPM|rate limit|empty response|Failed to fetch|network/i.test(err.message))) {
          lastError = err;
          if (!err.message.includes('404')) primaryNon404Error = primaryNon404Error || err;
          break;
        }
        throw err;
      }
    }
  }

  throw primaryNon404Error || lastError || new Error('All Groq model candidates failed.');
}

export async function callOpenAI(prompt, settings) {
  const apiKey = settings.openaiKey?.trim();
  if (!apiKey) {
    throw new Error('OpenAI / NIM / OpenRouter API key is missing. Please set it in AP-Solver options.');
  }

  const model = settings.openaiModel || 'gpt-4o';
  const baseUrl = (settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const sysContent = getContextGatedSystemPrompt(prompt, !!settings.isDebugMode);

  const payload = {
    model,
    messages: [{ role: 'system', content: sysContent }, { role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 8192
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    let msg = `OpenAI API error (${resp.status})`;
    try {
      const errJson = JSON.parse(errText);
      msg += `: ${errJson.error?.message || errText}`;
    } catch {
      msg += `: ${errText}`;
    }
    throw new Error(msg);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned an empty response.');
  }

  return finalizeProviderResult(text, model, settings);
}

const _cerebrasModelsCache = { fetchedAt: 0, models: [] };

async function fetchCerebrasAccountModels(apiKey) {
  if (_cerebrasModelsCache.models.length > 0 && (Date.now() - _cerebrasModelsCache.fetchedAt) < 600000) {
    return _cerebrasModelsCache.models;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch('https://api.cerebras.ai/v1/models', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    const ids = (Array.isArray(data?.data) ? data.data : [])
      .map(m => m?.id)
      .filter(Boolean)
      .sort((a, b) => {
        const rank = (s) => /gpt-oss-120b|qwen-3|qwen3/i.test(s) ? 0 : /llama-3\.3-70b|llama-4/i.test(s) ? 1 : 2;
        return rank(a) - rank(b);
      });
    if (ids.length > 0) {
      _cerebrasModelsCache.fetchedAt = Date.now();
      _cerebrasModelsCache.models = ids;
    }
    return ids;
  } catch (e) {
    return [];
  }
}

/** Call Cerebras Inference OpenAI-compatible API with model fallback, dynamic discovery, and compaction. */
export async function callCerebras(prompt, settings) {
  const apiKey = settings.cerebrasKey?.trim();
  if (!apiKey) {
    throw new Error('Cerebras API key is missing. Please set it in AP-Solver settings.');
  }

  const requestedModel = (settings.cerebrasModel || 'gpt-oss-120b').trim();
  const baseCandidates = [
    requestedModel,
    'gpt-oss-120b',
    'qwen-3-32b',
    'qwen-3.8-27b',
    'llama-3.3-70b',
    'llama3.1-8b'
  ].filter(Boolean);
  const queue = [...new Set(baseCandidates)];
  const triedModels = new Set();
  let discoveredOnce = false;
  let lastError = null;
  const isDebug = !!settings.isDebugMode;

  while (queue.length > 0) {
    if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 3000) break;
    const model = queue.shift();
    if (triedModels.has(model)) continue;
    triedModels.add(model);

    const url = 'https://api.cerebras.ai/v1/chat/completions';
    const compactMedium = buildCompactGroqMessages(SYSTEM_PROMPT, prompt, 6000, 14000);
    const estFullTokens = Math.ceil((compactMedium.sys.length + prompt.length) / 3.0);
    const useFull = estFullTokens < 7200;

    const payloads = [
      {
        model,
        messages: [{ role: 'system', content: compactMedium.sys }, { role: 'user', content: useFull ? prompt : compactMedium.compactPrompt }],
        temperature: 0.1,
        max_completion_tokens: isDebug ? 8192 : 6144
      }
    ];
    if (!useFull || isDebug) {
      const compactTight = buildCompactGroqMessages(SYSTEM_PROMPT, prompt, 3800, 7200);
      payloads.push({
        model,
        messages: [{ role: 'system', content: compactTight.sys }, { role: 'user', content: compactTight.compactPrompt }],
        temperature: 0.1,
        max_completion_tokens: Math.min(4096, compactTight.safeMaxTokens)
      });
    }

    for (let pi = 0; pi < payloads.length; pi++) {
      if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 2000) break;
      const payload = payloads[pi];
      const controller = new AbortController();
      const timeoutMs = isDebug ? 36000 : 28000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errText = await resp.text();
          let msg = `Cerebras API error (${resp.status})`;
          try {
            const errJson = JSON.parse(errText);
            msg += `: ${errJson.error?.message || errText}`;
          } catch {
            msg += `: ${errText}`;
          }

          if (resp.status === 413 || resp.status === 400 && /context|length|token|max_completion_tokens/i.test(msg)) {
            lastError = new Error(msg);
            if (pi === payloads.length - 1 && !payload._tightRetried) {
              const tight = buildCompactGroqMessages(SYSTEM_PROMPT, prompt, 3200, 6200);
              payloads.push({
                model,
                messages: [{ role: 'system', content: tight.sys }, { role: 'user', content: tight.compactPrompt }],
                temperature: 0.1,
                max_completion_tokens: 3200,
                _tightRetried: true
              });
            }
            continue;
          }

          if ((resp.status === 404 || /model.*not.*found|does not exist/i.test(msg)) && !discoveredOnce) {
            discoveredOnce = true;
            const liveModels = await fetchCerebrasAccountModels(apiKey);
            for (const lm of liveModels) {
              if (!triedModels.has(lm) && !queue.includes(lm)) queue.unshift(lm);
            }
          }

          if (resp.status === 403 || resp.status === 404 || resp.status === 429 || resp.status >= 500 || /rate limit|unavailable|overloaded|does not exist/i.test(msg)) {
            console.warn(`[AP-Solver] Cerebras model ${model} unavailable (${resp.status}), trying next candidate...`);
            lastError = new Error(msg);
            break;
          }

          throw new Error(msg);
        }

        const data = await resp.json();
        const choice = data.choices?.[0];
        let text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
        text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!text) {
          lastError = new Error(`Cerebras returned an empty response (${choice?.finish_reason || 'unknown'}).`);
          break;
        }

        return finalizeProviderResult(text, model, settings);
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          lastError = new Error(`Cerebras model ${model} timed out.`);
          continue;
        }
        if (/404|413|429|\b5\d{2}\b|rate limit|timeout|empty response|Failed to fetch|network/i.test(err.message || '')) {
          lastError = err;
          break;
        }
        throw err;
      }
    }
  }

  throw lastError || new Error('All Cerebras model candidates failed.');
}

async function invokeSingleProvider(providerId, prompt, settings) {
  if (providerId === 'gemini') return await callGemini(prompt, settings);
  if (providerId === 'groq') return await callGroq(prompt, settings);
  if (providerId === 'cerebras') return await callCerebras(prompt, settings);
  if (providerId === 'openai') return await callOpenAI(prompt, settings);
  throw new Error(`Unsupported AI provider: ${providerId}`);
}

/** Validate format and test live connectivity across configured providers cleanly. */
export async function testProviderConnections(settingsOverride = null) {
  const stored = await getSettings();
  const settings = { ...stored, ...(settingsOverride || {}) };
  const configured = getConfiguredProviders(settings);
  if (configured.length === 0) {
    return { ok: false, results: [], error: 'No API key configured.' };
  }

  const targetList = (settings.provider && settings.provider !== 'auto' && settings.provider !== 'race' && configured.includes(settings.provider))
    ? [settings.provider]
    : configured;

  const tinyPrompt = 'Reply with a JavaScript code block containing: const ping = "ok";';
  const checks = await Promise.all(targetList.map(async (p) => {
    const keyVal = p === 'gemini' ? settings.geminiKey
      : p === 'groq' ? settings.groqKey
        : p === 'cerebras' ? settings.cerebrasKey
          : settings.openaiKey;
    const fmt = validateApiKeyFormat(p, keyVal);
    if (!fmt.valid) {
      return { provider: p, ok: false, error: fmt.message, latencyMs: 0 };
    }
    const t0 = Date.now();
    try {
      const res = await invokeSingleProvider(p, tinyPrompt, { ...settings, deadlineAt: Date.now() + 18000, isDebugMode: false });
      const latencyMs = Date.now() - t0;
      recordProviderOutcome(p, { ok: true, latencyMs });
      return { provider: p, ok: true, model: res.model, latencyMs, formatNote: fmt.message };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      recordProviderOutcome(p, { ok: false, latencyMs, errorMsg: err.message });
      return { provider: p, ok: false, error: err.message || String(err), latencyMs };
    }
  }));

  const anyOk = checks.some(c => c.ok);
  return {
    ok: anyOk,
    results: checks,
    error: anyOk ? '' : checks.map(c => `${c.provider}: ${c.error}`).join(' | ')
  };
}

export async function generateSolution(promptData, settingsOverride = null) {
  const stored = await getSettings();
  const settings = { ...stored };
  if (settingsOverride && typeof settingsOverride === 'object') {
    for (const [k, v] of Object.entries(settingsOverride)) {
      if (v !== undefined && v !== null && v !== '') {
        settings[k] = v;
      }
    }
  }
  const isDebugMode = !!(promptData.feedback && String(promptData.feedback).trim().length > 0);
  const attemptNumber = Math.max(1, Number(promptData.attemptNumber) || (isDebugMode ? 2 : 1));
  const collaborationHistory = promptData.collaborationHistory ||
    (Array.isArray(promptData.attemptRecords) && promptData.attemptRecords.length > 0
      ? formatFullCollaborationHistory(promptData.attemptRecords, { maxTotalChars: 13000 })
      : '');
  const filePlan = promptData.filePlan || analyzeFileModificationPlan(promptData);
  settings.isDebugMode = isDebugMode;
  settings.attemptNumber = attemptNumber;
  settings.filePlan = filePlan;
  settings.activeFile = filePlan.primaryFile || promptData.activeFile || 'src/index.js';
  settings.workspaceFiles = filePlan.allExistingFiles?.length ? filePlan.allExistingFiles : (promptData.workspaceFiles || []);
  settings.deadlineAt = Date.now() + (isDebugMode ? 120000 : 85000);

  const prompt = buildPrompt({
    ...promptData,
    filePlan,
    attemptNumber,
    collaborationHistory
  });

  const configured = getConfiguredProviders(settings);
  if (configured.length === 0) {
    throw new Error('No API key configured. Please enter a Gemini, Groq, Cerebras, or OpenAI-compatible API key in AP-Solver settings.');
  }

  const plan = planModelOrchestration(promptData, prompt, settings);
  const triedProviders = [];
  const roleTag = isDebugMode
    ? (attemptNumber >= 3 ? `Stage ${attemptNumber}/5 Multi-AI Collaborator` : `Stage ${attemptNumber}/5 Debug Escalation`)
    : 'Dynamic Orchestrator';

  const executeAndTrack = async (candidate) => {
    const p = candidate.provider;
    triedProviders.push(p);
    const t0 = Date.now();
    try {
      const res = await invokeSingleProvider(p, prompt, settings);
      const latencyMs = Date.now() - t0;
      if (!isUsableProviderResult(res)) {
        const emptyErr = new Error(`${p} returned unusable or empty code output.`);
        recordProviderOutcome(p, { ok: false, latencyMs, errorMsg: emptyErr.message });
        throw emptyErr;
      }
      recordProviderOutcome(p, { ok: true, latencyMs });
      res.latencyMs = latencyMs;
      res.debugEscalated = isDebugMode;
      res.attemptNumber = attemptNumber;
      res.commands = res.commands || [];
      res.raceWinner = `${roleTag} (${candidate.label}: ${res.model})`;
      res.orchestration = {
        mode: plan.executionMode,
        taskStage: plan.taskProfile.stage,
        complexityScore: plan.taskProfile.complexityScore,
        selectedProvider: p,
        selectedLabel: candidate.label,
        selectedModel: res.model,
        reason: candidate.reason,
        triedProviders: [...new Set(triedProviders)],
        fallbackUsed: triedProviders.length > 1
      };
      return res;
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const errMsg = err?.message || String(err);
      const statusM = errMsg.match(/\((\d{3})\)/);
      recordProviderOutcome(p, {
        ok: false,
        latencyMs,
        status: statusM ? parseInt(statusM[1], 10) : 0,
        errorMsg: errMsg
      });
      throw err;
    }
  };

  let lastError = null;

  // Phase 1: Adaptive Parallel Race between top 2 dynamically matched candidates (no fixed priority)
  if (plan.executionMode === 'adaptive_race' && plan.parallelCandidates.length >= 2) {
    const names = plan.parallelCandidates.map(c => c.label).join(' vs ');
    console.log(`[AP-Solver] ⚡ Adaptive Parallel Orchestration (${plan.taskProfile.stage}): ${names}`);
    try {
      const winner = await Promise.any(plan.parallelCandidates.map(c => executeAndTrack(c)));
      console.log(`[AP-Solver] 🚀 Orchestrator Winner: ${winner.orchestration.selectedLabel} (${winner.model}) in ${winner.latencyMs}ms [${winner.orchestration.reason}]`);
      return winner;
    } catch (aggErr) {
      lastError = aggErr.errors?.[0] || aggErr;
      console.warn('[AP-Solver] Adaptive race failed across top candidates, rolling into dynamic fallback chain...', lastError?.message);
    }
  }

  // Phase 2: Dynamic Capability-Ordered Execution & Automatic Fallback across ALL configured providers
  const seqCandidates = plan.executionMode === 'adaptive_race' ? plan.fallbackCandidates : plan.ranked;
  for (const cand of seqCandidates) {
    if (Date.now() >= settings.deadlineAt - 2000) break;
    try {
      console.log(`[AP-Solver] 🧠 [${roleTag}] Trying ${cand.label} (score=${cand.score}, stage=${plan.taskProfile.stage}, why=${cand.reason})...`);
      const res = await executeAndTrack(cand);
      return res;
    } catch (err) {
      console.warn(`[AP-Solver] Provider ${cand.provider} failed/unusable (${err.message}), seamlessly falling back to next candidate...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All configured AI providers failed or hit rate limits.');
}
