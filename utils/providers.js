// utils/providers.js - Multi-provider AI clients (Gemini, Groq, OpenAI), Turbo Race & Debug Escalation
import { extractCodeBlock, parseMultiFileSolution } from './code-format.js';
import { extractCommandsFromResponse } from './commands.js';
import { SYSTEM_PROMPT, buildPrompt, buildCompactGroqMessages, getContextGatedSystemPrompt } from './prompts.js';

export const DEFAULT_SETTINGS = {
  provider: 'race', // 'race' (Turbo Parallel) | 'groq' | 'gemini' | 'openai'
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  groqKey: '',
  groqModel: 'openai/gpt-oss-120b',
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

        const commands = extractCommandsFromResponse(text);
        const files = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
        return {
          raw: text,
          code: files.length > 0 ? files[0].code : extractCodeBlock(text),
          files,
          commands,
          model,
          debugEscalated: isDebug
        };
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

        const commands = extractCommandsFromResponse(text);
        const files = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
        return {
          raw: text,
          code: files.length > 0 ? files[0].code : extractCodeBlock(text),
          files,
          commands,
          model,
          debugEscalated: isDebug
        };
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
    throw new Error('OpenAI / OpenRouter API key is missing. Please set it in AP-Solver options.');
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

  const commands = extractCommandsFromResponse(text);
  const files = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
  return {
    raw: text,
    code: files.length > 0 ? files[0].code : extractCodeBlock(text),
    files,
    commands,
    model
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
  settings.isDebugMode = isDebugMode;
  settings.activeFile = promptData.activeFile || 'src/index.js';
  settings.workspaceFiles = promptData.workspaceFiles || [];
  settings.deadlineAt = Date.now() + (isDebugMode ? 120000 : 85000);

  const prompt = buildPrompt(promptData);

  const hasGemini = !!(settings.geminiKey && settings.geminiKey.trim());
  const hasGroq = !!(settings.groqKey && settings.groqKey.trim());
  const hasOpenAI = !!(settings.openaiKey && settings.openaiKey.trim());

  if (!hasGemini && !hasGroq && !hasOpenAI) {
    throw new Error('No API key configured. Please enter your Gemini or Groq API key in AP-Solver settings.');
  }

  const hasValidSolution = (res) => !!(res && (
    (res.code && res.code.trim().length > 5) ||
    (Array.isArray(res.files) && res.files.some(f => f.code && f.code.trim().length > 5))
  ));

  let provider = settings.provider || 'race';

  // MODEL ESCALATION FOR DEBUGGING (Attempt 2+ / Local Test Fix)
  if (isDebugMode) {
    console.log('[AP-Solver] 🧠 Debug Escalation Mode active: prioritizing High-Reasoning analysis...');
    const debugOrder = [];
    if (hasGemini) debugOrder.push('gemini');
    if (provider === 'openai' && hasOpenAI) debugOrder.push('openai');
    if (hasGroq) debugOrder.push('groq');
    if (hasOpenAI && !debugOrder.includes('openai')) debugOrder.push('openai');
    const uniqueOrder = [...new Set(debugOrder)];

    let lastDebugErr = null;
    for (const p of uniqueOrder) {
      if (Date.now() >= settings.deadlineAt - 2000) break;
      try {
        const t0 = Date.now();
        let res;
        if (p === 'gemini') res = await callGemini(prompt, settings);
        else if (p === 'groq') res = await callGroq(prompt, settings);
        else res = await callOpenAI(prompt, settings);
        if (!hasValidSolution(res)) {
          console.warn(`[AP-Solver] Debug Escalation provider (${p}) returned empty result, trying next...`);
          lastDebugErr = new Error(`${p} returned an empty/invalid response during debug.`);
          continue;
        }
        res.latencyMs = Date.now() - t0;
        res.debugEscalated = true;
        res.commands = res.commands || [];
        res.raceWinner = `🧠 Debug Escalated (${p === 'gemini' ? 'Gemini High-Reasoning' : p}: ${res.model})`;
        return res;
      } catch (err) {
        console.warn(`[AP-Solver] Debug Escalation provider (${p}) failed:`, err);
        lastDebugErr = err;
      }
    }
    throw lastDebugErr || new Error('All debug escalation AI solvers failed.');
  }

  // SPECULATIVE TURBO PARALLEL RACE (Attempt 1 Fast Solve)
  const shouldRace = (provider === 'race' || provider === 'auto') ? (hasGroq && hasGemini) : (hasGroq && hasGemini && (provider === 'groq' || provider === 'gemini'));

  if (shouldRace || (provider === 'race' && hasGroq && hasGemini)) {
    console.log('[AP-Solver] ⚡ Turbo Parallel Race: Executing Groq & Gemini concurrently...');

    const runGroq = async () => {
      const t0 = Date.now();
      const res = await callGroq(prompt, settings);
      if (!hasValidSolution(res)) throw new Error('Groq returned empty code.');
      res.latencyMs = Date.now() - t0;
      res.commands = res.commands || [];
      res.raceWinner = `Groq LPU (${res.model})`;
      return res;
    };

    const runGemini = async () => {
      const t0 = Date.now();
      const res = await callGemini(prompt, settings);
      if (!hasValidSolution(res)) throw new Error('Gemini returned empty code.');
      res.latencyMs = Date.now() - t0;
      res.commands = res.commands || [];
      res.raceWinner = `Google Gemini (${res.model})`;
      return res;
    };

    try {
      const winner = await Promise.any([runGroq(), runGemini()]);
      console.log(`[AP-Solver] 🚀 Turbo Winner: ${winner.raceWinner} in ${winner.latencyMs}ms!`);
      return winner;
    } catch (aggErr) {
      console.warn('[AP-Solver] Turbo race aggregate error, trying fallback:', aggErr);
      if (hasOpenAI) return await callOpenAI(prompt, settings);
      throw aggErr.errors?.[0] || new Error('All parallel AI solvers failed.');
    }
  }

  if (provider === 'race') provider = hasGroq ? 'groq' : (hasGemini ? 'gemini' : 'openai');
  if (provider === 'gemini' && !hasGemini) provider = hasGroq ? 'groq' : 'openai';
  else if (provider === 'groq' && !hasGroq) provider = hasGemini ? 'gemini' : 'openai';

  try {
    if (provider === 'gemini') return await callGemini(prompt, settings);
    if (provider === 'groq') return await callGroq(prompt, settings);
    if (provider === 'openai') return await callOpenAI(prompt, settings);
  } catch (err) {
    console.warn(`[AP-Solver] Primary provider (${provider}) failed:`, err);
    if (provider !== 'groq' && hasGroq) {
      console.log('[AP-Solver] Falling back to Groq...');
      return await callGroq(prompt, settings);
    } else if (provider !== 'gemini' && hasGemini) {
      console.log('[AP-Solver] Falling back to Gemini...');
      return await callGemini(prompt, settings);
    } else if (provider !== 'openai' && hasOpenAI) {
      return await callOpenAI(prompt, settings);
    }
    throw err;
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}
