// utils/llm.js - Multi-Provider AI Engine (Gemini, Groq, OpenAI / OpenRouter)

export const DEFAULT_SETTINGS = {
  provider: 'gemini', // 'gemini' | 'groq' | 'openai'
  geminiKey: '',
  geminiModel: 'gemini-3.8-flash',
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  openaiKey: '',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  autoSubmit: false,
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
1. ACCURACY: Follow every requirement and endpoint specification verbatim.
2. STARTER CODE ADHERENCE:
   - Carefully examine the starter code.
   - If the starter code uses native 'node:http' or 'http', DO NOT convert it to Express unless the question explicitly asks for Express. Keep the native http server setup and request listener!
   - If the starter code uses Express ('express()'), follow Express idioms.
   - Preserve all exported identifiers (e.g. 'module.exports = server;' or 'module.exports = { app };').
   - Keep predefined variables (such as 'const tasks = [...]' or 'PORT') intact.
3. TEST CASE COVERAGE:
   - Review each listed test case carefully. Your code MUST pass every single one without exception:
     * Check exact status codes (200, 201, 400, 404).
     * Check exact response body formats (e.g., error responses must include an 'error' field like { error: "Descriptive message" }).
     * Check input validation (non-empty strings, valid types, malformed JSON bodies handling with try-catch).
     * Check URL query parameter handling (e.g., ?completed=true vs ?completed=false boolean filtering).
     * Check route parameter parsing (/tasks/:id with numeric IDs, invalid ID format rejection with 400).
     * Check payload data sanitization (ignore client-supplied id or completed fields on POST creation, auto-generate unique numeric IDs, default completed=false).
     * For PATCH: preserve title and other unmentioned properties, update only specified fields, reject invalid types with 400, missing tasks with 404.
4. COMPLETENESS:
   - Return the ENTIRE replacement file ready to run.
   - Do NOT omit any parts with comments like "// ... rest of code".
5. OUTPUT FORMAT:
   - Output ONLY the clean replacement code enclosed in a single markdown code block:
   \`\`\`javascript
   // complete code here
   \`\`\`
   - Absolutely NO explanations, markdown or conversational text outside the code block.`;

export function extractCodeBlock(rawText) {
  if (!rawText) return '';
  const match = rawText.match(/```(?:javascript|js|typescript|ts|node)?\s*\n([\s\S]*?)```/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  // If wrapped in generic code block
  const genericMatch = rawText.match(/```\s*\n([\s\S]*?)```/);
  if (genericMatch && genericMatch[1]) {
    return genericMatch[1].trim();
  }
  return rawText.trim();
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

  // Model fallback chain: start with gemini-3.8-flash, gemini-1.5-flash, gemini-2.0-flash
  const requestedModel = settings.geminiModel || 'gemini-3.8-flash';
  const modelsToTry = [
    requestedModel === 'gemini-2.5-flash' ? 'gemini-3.8-flash' : requestedModel,
    'gemini-3.8-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash'
  ];
  const uniqueModels = [...new Set(modelsToTry)];

  let lastError = null;

  for (const model of uniqueModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT + '\n\n' + prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        maxOutputTokens: 8192
      }
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        let msg = `Gemini API error (${resp.status})`;
        try {
          const errJson = JSON.parse(errText);
          msg += `: ${errJson.error?.message || errText}`;
        } catch {
          msg += `: ${errText}`;
        }

        // If 404 (model not found / deprecated for user), try next model in chain
        if (resp.status === 404 || /not found|no longer available/i.test(msg)) {
          console.warn(`[AP-Solver] Gemini model ${model} unavailable (404), falling back to next model...`);
          lastError = new Error(msg);
          continue;
        }

        throw new Error(msg);
      }

      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned an empty response.');
      }

      return {
        raw: text,
        code: extractCodeBlock(text),
        model
      };
    } catch (err) {
      if (err.message && (err.message.includes('404') || err.message.includes('no longer available'))) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All Gemini model candidates failed.');
}

export async function callGroq(prompt, settings) {
  const apiKey = settings.groqKey?.trim();
  if (!apiKey) {
    throw new Error('Groq API key is missing. Please set it in AP-Solver options.');
  }

  const model = settings.groqModel || 'llama-3.3-70b-versatile';
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
