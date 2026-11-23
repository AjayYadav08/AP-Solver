// utils/llm.js - Multi-Provider AI Engine (Gemini, Groq, OpenAI / OpenRouter)

export const DEFAULT_SETTINGS = {
  provider: 'groq', // 'gemini' | 'groq' | 'openai'
  geminiKey: '',
  geminiModel: 'gemini-3.8-flash',
  groqKey: '',
  groqModel: 'openai/gpt-oss-120b',
  openaiKey: '',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  autoSubmit: true,
  autoRetry: true,
  maxRetries: 3,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(updates) {
  await chrome.storage.local.set(updates);
  return getSettings();
}

const SYSTEM_PROMPT = `You are a Senior Full-Stack Software Engineer and competitive programming expert.
Your job is to write complete, production-ready, 100% bug-free solutions for auto-graded coding and API assignments.

STRICT GUIDELINES:
1. ACCURACY & SPECIFICATION:
   Follow every requirement, endpoint, status code, and edge case verbatim.
2. STARTER CODE ADHERENCE:
   - Carefully examine the starter code.
   - If the starter code uses native 'node:http' or 'http', DO NOT convert it to Express unless the question explicitly asks for Express. Keep the native http server setup and request listener!
   - If the starter code uses Express ('express()'), follow Express idioms.
   - Preserve all exported identifiers (e.g. 'module.exports = server;' or 'module.exports = { app };').
   - Keep predefined variables (such as 'const tasks = [...]' or 'PORT') intact.
3. REST API & NODE HTTP BEST PRACTICES:
   - Always set 'Content-Type: application/json; charset=utf-8' on every response.
   - For GET /tasks:
     * Support '?completed=true' and '?completed=false'.
     * If '?completed' is present with an invalid value (not 'true' or 'false'), return status 400 with { error: "Invalid completed filter" }.
     * If no tasks match, return status 200 with an empty array [].
   - For POST /tasks:
     * Request body must be valid JSON; if malformed JSON, return status 400 with { error: "Invalid JSON" }.
     * Validate 'title': must be a non-empty string. If missing, empty, or not a string, return status 400 with { error: "Title is required" }.
     * Ignore client-supplied 'id' and 'completed' values.
     * Auto-generate a unique numeric ID (e.g. tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1).
     * Set completed to false.
     * Push to tasks array and return status 201 with the created task object.
   - For PATCH /tasks/:id:
     * URL path parameter ':id' must be valid numeric integer digits. If non-numeric (e.g. /tasks/abc or /tasks/-1), return status 400 with { error: "Invalid task ID" }.
     * Check if task exists in tasks array. If not found, return status 404 with { error: "Task not found" }.
     * Request body must be valid JSON; if malformed JSON, return status 400 with { error: "Invalid JSON" }.
     * Validate 'completed': must be a boolean (typeof body.completed === 'boolean'). If missing or not boolean, return status 400 with { error: "Invalid completed value" }.
     * Update only 'completed' (task.completed = body.completed). Preserve 'title' and all other existing properties!
     * Return status 200 with the updated task object.
   - For unknown routes or unsupported methods:
     * Return status 404 with { error: "Route not found" }.
4. WIPE & REPLACE COMPLETENESS:
   - Return the ENTIRE replacement file ready to run from top imports to exports.
   - Do NOT omit any parts with comments like "// ... rest of code".
   - Your code will completely wipe and replace the starter file.
5. CLEAN READABLE CODE & INDENTATION:
   - Use strict, standard 2-space indentation for every nested block, function, if-else, and object.
   - Do NOT use tab characters.
   - Keep code clean, elegant, and readable.
6. OUTPUT FORMAT:
   - Output ONLY the clean replacement code enclosed in a single markdown code block:
   \`\`\`javascript
   // complete code here
   \`\`\`
   - Absolutely NO explanations, markdown or conversational text outside the code block.`;

export function formatCodeIndentation(code) {
  if (!code) return '';
  const lines = code.split('\n');
  let currentIndent = 0;
  const indentSize = 2;
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    // Check how many closing braces/brackets start this line
    let leadingCloses = 0;
    const m = trimmed.match(/^(\}|\)|\])+/);
    if (m) {
      leadingCloses = m[0].length;
    } else if (/^(else|catch|finally)\b/.test(trimmed)) {
      leadingCloses = 1;
    }

    const printIndent = Math.max(0, currentIndent - leadingCloses);
    result.push(' '.repeat(printIndent * indentSize) + trimmed);

    // Calculate net brace change across the line
    let net = 0;
    let inStr = false;
    let quote = '';
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      const prev = i > 0 ? trimmed[i - 1] : '';
      if (inStr) {
        if (c === quote && prev !== '\\') inStr = false;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        inStr = true;
        quote = c;
        continue;
      }
      if (c === '/' && trimmed[i + 1] === '/') break; // line comment
      if (c === '{' || c === '(' || c === '[') net++;
      if (c === '}' || c === ')' || c === ']') net--;
    }

    currentIndent = Math.max(0, currentIndent + net);
  }

  return result.join('\n');
}

export function extractCodeBlock(rawText) {
  if (!rawText) return '';
  let extracted = '';
  const match = rawText.match(/```(?:javascript|js|typescript|ts|node)?\s*\n([\s\S]*?)```/i);
  if (match && match[1]) {
    extracted = match[1].trim();
  } else {
    // If wrapped in generic code block
    const genericMatch = rawText.match(/```\s*\n([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
      extracted = genericMatch[1].trim();
    } else {
      extracted = rawText.trim();
    }
  }

  return formatCodeIndentation(extracted);
}

export function buildPrompt({ questionTitle, questionDetails, testCases, currentCode, language = 'javascript', feedback = null }) {
  const parts = [];
  parts.push(`# PROBLEM: ${questionTitle || 'Coding Challenge'}`);
  
  if (questionDetails) {
    parts.push(`## Problem Description & Requirements:\n${questionDetails}`);
  }

  if (testCases && testCases.length > 0) {
    parts.push(`## Test Cases to Pass (All Must Pass):\n${testCases.map((tc, i) => `${i + 1}. ${tc}`).join('\n')}`);
  }

  if (currentCode) {
    parts.push(`## Current Starter Code in Editor (${language}):\n\`\`\`${language}\n${currentCode}\n\`\`\``);
  }

  if (feedback) {
    parts.push(`## CRITICAL: PREVIOUS SUBMISSION FAILED
Earlier attempt resulted in test failures. Fix these issues immediately:
${feedback}
Carefully re-read requirements and ensure all edge cases and status codes are handled.`);
  }

  parts.push(`## Instruction:
Implement the complete solution. Return ONLY the full code inside a \`\`\`${language} code block.`);

  return parts.join('\n\n');
}

export async function callGemini(prompt, settings) {
  const apiKey = settings.geminiKey?.trim();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please set it in AP-Solver settings.');
  }

  const requestedModel = settings.geminiModel || 'gemini-3.8-flash';
  const modelsToTry = [
    requestedModel === 'gemini-2.5-flash' ? 'gemini-3.8-flash' : requestedModel,
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];
  const uniqueModels = [...new Set(modelsToTry)];

  let lastError = null;

  for (const model of uniqueModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Config options to try:
    // 1. With thinkingLevel: "low" (super fast for gemini-3.8-flash: ~3-5s response time)
    // 2. Standard config without thinkingConfig (for models that don't support thinkingConfig)
    const configsToTry = [
      {
        temperature: 0.1,
        topP: 0.95,
        maxOutputTokens: 8192,
        thinkingConfig: {
          thinkingLevel: 'low'
        }
      },
      {
        temperature: 0.1,
        topP: 0.95,
        maxOutputTokens: 8192
      }
    ];

    for (const genConfig of configsToTry) {
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT + '\n\n' + prompt }
            ]
          }
        ],
        generationConfig: genConfig
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);

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

          // If 400 Bad Request mentions thinkingConfig, retry without thinkingConfig
          if (resp.status === 400 && /thinking/i.test(msg)) {
            console.warn(`[AP-Solver] thinkingConfig not supported by ${model}, retrying standard config...`);
            continue;
          }

          // If 404 (model not found / deprecated for user), try next model
          if (resp.status === 404 || /not found|no longer available/i.test(msg)) {
            console.warn(`[AP-Solver] Gemini model ${model} unavailable (404), falling back to next model...`);
            lastError = new Error(msg);
            break; // Try next model in uniqueModels
          }

          throw new Error(msg);
        }

        const data = await resp.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        // Extract text from non-thought parts
        const codeParts = parts.filter(p => !p.thought && p.text).map(p => p.text);
        const text = (codeParts.length > 0 ? codeParts.join('\n') : parts.map(p => p.text || '').join('\n')).trim();

        if (!text) {
          throw new Error('Gemini returned an empty response.');
        }

        return {
          raw: text,
          code: extractCodeBlock(text),
          model
        };
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          lastError = new Error(`Gemini model ${model} request timed out after 90s.`);
          break; // Try next model
        }
        if (err.message && (err.message.includes('404') || err.message.includes('no longer available'))) {
          lastError = err;
          break; // Try next model
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

  const requestedModel = settings.groqModel || 'openai/gpt-oss-120b';
  const modelsToTry = [
    requestedModel,
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile'
  ].filter(Boolean);
  const uniqueModels = [...new Set(modelsToTry)];

  let lastError = null;

  for (const model of uniqueModels) {
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const payload = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 8192
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        let msg = `Groq API error (${resp.status})`;
        try {
          const errJson = JSON.parse(errText);
          msg += `: ${errJson.error?.message || errText}`;
        } catch {
          msg += `: ${errText}`;
        }

        // If 404 (model does not exist or access denied), try next model
        if (resp.status === 404 || /does not exist|access|decommissioned/i.test(msg)) {
          console.warn(`[AP-Solver] Groq model ${model} unavailable (404), trying next model...`);
          lastError = new Error(msg);
          continue;
        }

        throw new Error(msg);
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Groq returned an empty response.');
      }

      return {
        raw: text,
        code: extractCodeBlock(text),
        model
      };
    } catch (err) {
      if (err.message && (err.message.includes('404') || err.message.includes('does not exist'))) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All Groq model candidates failed.');
}

export async function callOpenAI(prompt, settings) {
  const apiKey = settings.openaiKey?.trim();
  if (!apiKey) {
    throw new Error('OpenAI / OpenRouter API key is missing. Please set it in AP-Solver options.');
  }

  const model = settings.openaiModel || 'gpt-4o';
  const baseUrl = (settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 8192
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

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

  return {
    raw: text,
    code: extractCodeBlock(text),
    model
  };
}

export async function generateSolution(promptData, settingsOverride = null) {
  // Always load stored settings containing saved API keys
  const stored = await getSettings();
  
  // Merge any runtime options without losing API keys
  const settings = { ...stored };
  if (settingsOverride && typeof settingsOverride === 'object') {
    for (const [k, v] of Object.entries(settingsOverride)) {
      if (v !== undefined && v !== null && v !== '') {
        settings[k] = v;
      }
    }
  }

  const prompt = buildPrompt(promptData);

  // Check which providers have valid keys
  const hasGemini = !!(settings.geminiKey && settings.geminiKey.trim());
  const hasGroq = !!(settings.groqKey && settings.groqKey.trim());
  const hasOpenAI = !!(settings.openaiKey && settings.openaiKey.trim());

  let provider = settings.provider || 'gemini';

  // Smart Auto-Switch: If the chosen provider has NO key, auto-switch to whatever provider HAS a key!
  if (provider === 'gemini' && !hasGemini) {
    if (hasGroq) {
      console.log('[AP-Solver] Gemini key missing, auto-switching to configured Groq key');
      provider = 'groq';
    } else if (hasOpenAI) {
      provider = 'openai';
    }
  } else if (provider === 'groq' && !hasGroq) {
    if (hasGemini) {
      console.log('[AP-Solver] Groq key missing, auto-switching to configured Gemini key');
      provider = 'gemini';
    } else if (hasOpenAI) {
      provider = 'openai';
    }
  } else if (provider === 'openai' && !hasOpenAI) {
    if (hasGemini) provider = 'gemini';
    else if (hasGroq) provider = 'groq';
  }

  if (!hasGemini && !hasGroq && !hasOpenAI) {
    throw new Error('No API key configured. Please enter your Gemini or Groq API key in AP-Solver settings.');
  }

  // Attempt main provider with automatic fallback
  try {
    if (provider === 'gemini') {
      return await callGemini(prompt, settings);
    } else if (provider === 'groq') {
      return await callGroq(prompt, settings);
    } else if (provider === 'openai') {
      return await callOpenAI(prompt, settings);
    }
  } catch (err) {
    console.warn(`[AP-Solver] Primary provider (${provider}) failed:`, err);

    // Fallbacks if available
    if (provider !== 'gemini' && hasGemini) {
      console.log('[AP-Solver] Falling back to Gemini...');
      return await callGemini(prompt, settings);
    } else if (provider !== 'groq' && hasGroq) {
      console.log('[AP-Solver] Falling back to Groq...');
      return await callGroq(prompt, settings);
    }

    throw err;
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}
