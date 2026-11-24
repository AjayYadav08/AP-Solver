// utils/llm.js - Multi-Provider AI Engine (Gemini, Groq, OpenAI / OpenRouter)

export const DEFAULT_SETTINGS = {
  provider: 'race', // 'race' (Turbo Parallel) | 'groq' | 'gemini' | 'openai'
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
3. REST API & BACKEND PATTERNS:
   - For Express / Prisma / PostgreSQL / Authentication (e.g. POST /register, POST /login):
     * Input Validation: Validate required fields (such as 'email', 'password').
       - Validate: if (!email || !password || typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password.trim()) { return res.status(400).json({ error: 'Email and password are required' }); }
       - Return HTTP 400 immediately if email is missing, empty, or whitespace-only.
       - Return HTTP 400 immediately if password is missing, empty, or whitespace-only.
       - Return HTTP 400 immediately if both fields are missing.
     * Duplicate Check: Before creating a user, query PostgreSQL using Prisma (e.g. 'await prisma.user.findFirst({ where: { email: email.trim() } })' or 'findUnique'). If an account with that email already exists, return HTTP status 400 with { error: "User already registered" }.
     * Bcrypt Hashing: Always hash passwords using bcrypt with EXACTLY 10 salt rounds: 'const hashedPassword = await bcrypt.hash(password.trim(), 10);'. NEVER store plain text passwords in the database!
     * Database Creation: Save the record to PostgreSQL using Prisma: 'const user = await prisma.user.create({ data: { email: email.trim(), password: hashedPassword } });'.
     * Response Security: NEVER return or expose the plain-text password or password hash in the response! Omit the password field from the returned object: 'const { password: _, ...userWithoutPassword } = user; return res.status(201).json(userWithoutPassword);'.
     * Async Route Handlers: Always declare route handlers as 'async (req, res) => { try { ... } catch (err) { res.status(500).json({ error: err.message }); } }'. Ensure EVERY code path calls 'res.status(...).json(...)' or 'res.send(...)' so requests NEVER time out or exceed Mocha timeout!
   - For Native Node.js HTTP Server ('node:http'):
     * Always set 'Content-Type: application/json; charset=utf-8' on every response.
     * For GET /tasks:
       - Support '?completed=true' and '?completed=false'.
       - If '?completed' has an invalid value, return status 400 with { error: "Invalid completed filter" }.
       - If no tasks match, return status 200 with [].
     * For POST /tasks:
       - Validate body is valid JSON; if malformed, return 400 with { error: "Invalid JSON" }.
       - Validate 'title' is a non-empty string. If missing or empty, return 400.
       - Auto-generate unique numeric ID and set completed: false. Return status 201 with created object.
     * For PATCH /tasks/:id:
       - Parameter ':id' must be valid numeric integer digits; if non-numeric, return 400.
       - If task does not exist, return 404 with { error: "Task not found" }.
       - Validate 'completed' is boolean; if invalid, return 400.
       - Preserve 'title' and other fields. Return status 200 with updated object.
     * For unknown routes or unsupported methods:
       - Return status 404 with { error: "Route not found" }.
4. WIPE & REPLACE COMPLETENESS:
   - Return the ENTIRE replacement file ready to run from top imports to exports.
   - Do NOT omit any parts with comments like "// ... rest of code".
   - Your code will completely wipe and replace the starter file.
5. CLEAN READABLE CODE & INDENTATION:
   - Use strict, standard 2-space indentation for every nested block, function, if-else, and object.
   - Do NOT use tab characters.
   - Keep code clean, elegant, and readable.
6. MULTI-FILE WORKSPACE & TARGET FILE AWARENESS:
   - Determine ALL files in which code is needed to be written.
   - If a file is not yet present in the project (e.g. 'src/seed.js' or 'src/controllers/userController.js'), specify its target path so it can be created at its given location.
   - For every required file, provide complete code that erases the initial starter code and fills in the full implementation.
   - Output EACH file in its own distinct markdown code block with the exact file path on Line 1:
     \`\`\`javascript
     // src/seed.js
     ...complete code for seed.js...
     \`\`\`
     \`\`\`javascript
     // src/index.js
     ...complete code for index.js...
     \`\`\`
   - Never merge multiple different modules or files into index.js. Keep each file independent with its own requires and exports.
7. OUTPUT FORMAT:
   - Output ONLY the clean replacement code enclosed in markdown code block(s):
   \`\`\`javascript
   // complete code here
   \`\`\`
   - Absolutely NO explanations, markdown or conversational text outside the code block(s).`;

export function formatCodeIndentation(code) {
  if (!code) return '';
  const lines = code.split('\n');
  let currentIndent = 0;
  const indentSize = 2;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    // Determine how many blocks this line closes at start
    let closes = 0;
    if (/^(\}|\)|\])+/.test(trimmed)) {
      const match = trimmed.match(/^(\}+|\]+|\)+)/);
      if (match) {
        closes = match[1].length;
      } else {
        closes = 1;
      }
    } else if (/^(else|catch|finally)\b/.test(trimmed)) {
      closes = 1;
    }

    const currentLineIndent = Math.max(0, currentIndent - closes);
    result.push(' '.repeat(currentLineIndent * indentSize) + trimmed);

    // Calculate net brace change for subsequent lines
    // Strip comments and strings first
    const stripped = trimmed
      .replace(/\/\/.*/, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');

    let net = 0;
    for (let j = 0; j < stripped.length; j++) {
      const c = stripped[j];
      if (c === '{' || c === '[') net++;
      if (c === '}' || c === ']') net--;
    }

    currentIndent = Math.max(0, currentIndent + net);
  }

  return result.join('\n');
}

export function stripFileCommentHeaders(code) {
  if (!code) return '';
  return code
    .replace(/^\s*(?:\/\/|\/\*|#+)\s*file\s*\d+[^\n]*(?:\*\/)?\s*\n?/gim, '')
    .replace(/^\s*(?:\/\/|\/\*|#+)\s*(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:src\/)?[a-zA-Z0-9_\-]+\.(?:js|ts|json|txt)[^\n]*(?:\*\/)?\s*\n?/gi, '')
    .trim();
}

export function parseMultiFileSolution(rawText, defaultActiveFile = 'src/index.js', workspaceFiles = []) {
  if (!rawText) return [];

  const normPath = (fn) => {
    if (!fn) return '';
    fn = fn.trim();
    if (fn.startsWith('src/')) return fn;
    if (fn.includes('/') || fn === 'package.json' || fn.startsWith('.')) return fn;
    return 'src/' + fn;
  };

  const isValidFilename = (fn) => {
    if (!fn) return false;
    fn = fn.trim();
    if (/^(1|2|3|4|5|one|two|file1|file2|file_1|file_2)(\.(js|ts))?$/i.test(fn)) return false;
    return /\.(js|ts|json|txt)$/i.test(fn);
  };

  const resolveTargetFile = (fn, codeSnippet, idx) => {
    if (fn && isValidFilename(fn)) return normPath(fn);
    if (workspaceFiles && workspaceFiles.length > 0) {
      const codeFiles = workspaceFiles.filter(f => /\.(js|ts)$/i.test(f) && !/nodemon|package|config/i.test(f));
      if (/validate|middleware/i.test(codeSnippet)) {
        const m = codeFiles.find(f => /middleware|validate/i.test(f));
        if (m) return normPath(m);
      }
      if (/express|createServer|app\.listen/i.test(codeSnippet)) {
        const idxF = codeFiles.find(f => /index\.(js|ts)/i.test(f));
        if (idxF) return normPath(idxF);
      }
      if (idx === 0 && codeFiles.find(f => !/index/i.test(f))) {
        return normPath(codeFiles.find(f => !/index/i.test(f)));
      }
      if (idx === 1 && codeFiles.find(f => /index/i.test(f))) {
        return normPath(codeFiles.find(f => /index/i.test(f)));
      }
    }
    return normPath(defaultActiveFile);
  };

  const fileHeaderPattern = /^(?:\/\/\s*|\/\*\s*|#+\s*)?(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+|file\s*\d+)[\.:\-\)]\s*)?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt))(?:\s*---|\s*\*\/)?\s*(?:\n|$)/i;

  // Strategy 1: Multiple or Single markdown code blocks
  const blockRegex = /```(?:[a-zA-Z0-9_\-]+)?(?::([^\n]+))?([^\n]*)\n([\s\S]*?)```/g;
  const blocks = [...rawText.matchAll(blockRegex)];

  if (blocks.length > 0) {
    const parsedBlocks = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const langExtra = (b[1] || '') + ' ' + (b[2] || '');
      let code = stripFileCommentHeaders(b[3]);

      const prevEnd = (i > 0) ? (blocks[i - 1].index + blocks[i - 1][0].length) : 0;
      const precedingText = rawText.substring(prevEnd, b.index).trim();

      let detectedFilename = '';

      // 1. Check first line inside code
      const firstLineMatch = b[3].trim().match(fileHeaderPattern);
      if (firstLineMatch && isValidFilename(firstLineMatch[1])) {
        detectedFilename = firstLineMatch[1];
      }

      // 2. Check lang tag / extra
      if (!detectedFilename && langExtra) {
        const m = langExtra.match(/([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt))/i);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }

      // 3. Check preceding text (last 3 lines)
      if (!detectedFilename && precedingText) {
        const lines = precedingText.split('\n').map(l => l.trim()).filter(Boolean);
        const lastFew = lines.slice(-3).join(' ');
        const m = lastFew.match(/(?:file:?\s*)?(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:`|'|\")?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt))/i);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }

      const finalPath = resolveTargetFile(detectedFilename, code, i);
      if (finalPath && code) {
        parsedBlocks.push({ filePath: finalPath, code: formatCodeIndentation(code) });
      }
    }

    if (parsedBlocks.length > 0 && (blocks.length > 1 || parsedBlocks[0].filePath !== normPath(defaultActiveFile))) {
      return parsedBlocks;
    }
  }

  // Strategy 2: Single block or raw text split by line-based file comment headers
  const headerRegex = /(?:^|\n)\s*(?:\/\/|\/\*|#+)\s*(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+|file\s*\d+)[\.:\-\)]\s*)?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt))(?:\s*---|\s*\*\/)?\s*(?:\n|$)/gi;
  const headers = [...rawText.matchAll(headerRegex)].filter(h => isValidFilename(h[1]));

  if (headers.length > 0) {
    const inlineFiles = [];
    for (let i = 0; i < headers.length; i++) {
      const fn = headers[i][1];
      const start = headers[i].index + headers[i][0].length;
      const end = (i + 1 < headers.length) ? headers[i + 1].index : rawText.length;
      let rawCode = rawText.substring(start, end).trim();
      rawCode = rawCode.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
      rawCode = stripFileCommentHeaders(rawCode);
      if (rawCode.length > 5) {
        inlineFiles.push({ filePath: normPath(fn), code: formatCodeIndentation(rawCode) });
      }
    }
    if (inlineFiles.length > 0) {
      return inlineFiles;
    }
  }

  // Strategy 3: Check if raw text starts with a file header line
  let cleaned = rawText.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
  const topMatch = cleaned.match(fileHeaderPattern);
  if (topMatch && isValidFilename(topMatch[1])) {
    const fn = topMatch[1];
    cleaned = stripFileCommentHeaders(cleaned);
    return [{ filePath: normPath(fn), code: formatCodeIndentation(cleaned) }];
  }

  const singleCode = stripFileCommentHeaders(extractCodeBlock(rawText));
  const finalSinglePath = resolveTargetFile('', singleCode, 0);
  return [{
    filePath: finalSinglePath,
    code: formatCodeIndentation(singleCode)
  }];
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

  extracted = stripFileCommentHeaders(extracted);
  return formatCodeIndentation(extracted);
}

export function buildPrompt({
  questionTitle,
  questionDetails,
  testCases,
  currentCode,
  activeFile = 'src/index.js',
  workspaceFiles = [],
  referenceFiles = {},
  language = 'javascript',
  feedback = null
}) {
  const parts = [];
  parts.push(`# PROBLEM: ${questionTitle || 'Coding Challenge'}`);
  
  if (activeFile) {
    parts.push(`## Target Active File in Editor: \`${activeFile}\``);
  }

  if (workspaceFiles && workspaceFiles.length > 0) {
    parts.push(`## Project Workspace Files:\n${workspaceFiles.map(f => `- ${f}`).join('\n')}`);
  }

  if (referenceFiles && Object.keys(referenceFiles).length > 0) {
    const refs = Object.entries(referenceFiles).map(([fname, content]) => {
      const ext = fname.split('.').pop().toLowerCase();
      const lang = ext === 'json' ? 'json' : (ext === 'prisma' ? 'prisma' : (ext === 'ts' ? 'typescript' : 'javascript'));
      return `### Initial Starter File: \`${fname}\`\n\`\`\`${lang}\n${content}\n\`\`\``;
    }).join('\n\n');
    parts.push(`## Initial Workspace Files & Starter Code:\n${refs}`);
  }

  if (questionDetails) {
    parts.push(`## Problem Description & Requirements:\n${questionDetails}`);
  }

  if (testCases && testCases.length > 0) {
    parts.push(`## Test Cases to Pass (All Must Pass):\n${testCases.map((tc, i) => `${i + 1}. ${tc}`).join('\n')}`);
  }

  if (currentCode) {
    parts.push(`## Current Starter Code in \`${activeFile}\` (${language}):\n\`\`\`${language}\n${currentCode}\n\`\`\``);
  }

  if (feedback) {
    parts.push(`## CRITICAL: PREVIOUS SUBMISSION FAILED
Earlier attempt resulted in test failures. Fix these issues immediately:
${feedback}
Carefully re-read requirements and ensure all edge cases, files, and status codes are handled.`);
  }

  parts.push(`## Operational Process Guidelines:
1. GIVE FULL QUESTION AND INITIAL CODE: Carefully inspect the full question requirements and initial starter code across all files above.
2. DETERMINE ALL REQUIRED FILES & LOCATIONS: Identify all files in which code must be written. If a required file is not present in the project (e.g. \`src/seed.js\`, \`src/routes/tasks.js\`, \`src/controllers/userController.js\`), specify its full path on Line 1 so it will be created at its given location.
3. WRITE COMPLETE CODE & ERASE INITIAL CODE: Provide 100% complete, bug-free replacement code for all required files that completely erases initial starter code and fills corresponding files.
4. ONE CODE BLOCK PER FILE: Output each file in its own distinct markdown code block with the exact file path on Line 1 (e.g. \`// src/seed.js\`).
5. NO GENERIC LABELS: Never use "File 1", "1.js", or conversational text. Return ONLY the code blocks.`);

  return parts.join('\n\n');
}

export async function callGemini(prompt, settings) {
  const apiKey = settings.geminiKey?.trim();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please set it in AP-Solver settings.');
  }

  let requestedModel = settings.geminiModel || 'gemini-3.8-flash';
  if (requestedModel === 'gemini-2.5-flash' || requestedModel === 'gemini-1.5-flash') {
    requestedModel = 'gemini-3.8-flash';
  }

  const modelsToTry = [
    requestedModel,
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-2.5-flash-lite'
  ].filter(Boolean);
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
      const timer = setTimeout(() => controller.abort(), 60000);

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

          // If 404 (model not found / deprecated) or 503 (high demand), try next model candidate
          if (resp.status === 404 || resp.status === 503 || /not found|no longer available|high demand|unavailable/i.test(msg)) {
            console.warn(`[AP-Solver] Gemini model ${model} unavailable (${resp.status}), trying next candidate...`);
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

        const files = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
        return {
          raw: text,
          code: files.length > 0 ? files[0].code : extractCodeBlock(text),
          files,
          model
        };
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          lastError = new Error(`Gemini model ${model} request timed out.`);
          break; // Try next model
        }
        if (err.message && (err.message.includes('404') || err.message.includes('503') || err.message.includes('unavailable') || err.message.includes('no longer available'))) {
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

  let requestedModel = (settings.groqModel || '').trim();
  // Auto-normalize deprecated/inaccessible model names to ultra-fast GPT OSS 120B
  if (!requestedModel || requestedModel.includes('llama') || requestedModel.includes('mixtral') || requestedModel.includes('qwen-2.5')) {
    requestedModel = 'openai/gpt-oss-120b';
  }

  const modelsToTry = [
    requestedModel,
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b'
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

        // If 404 (model does not exist or access denied) or 429 (rate limit), try next model
        if (resp.status === 404 || resp.status === 429 || /does not exist|access|decommissioned|rate limit/i.test(msg)) {
          console.warn(`[AP-Solver] Groq model ${model} unavailable (${resp.status}), trying next model...`);
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

      const files = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
      return {
        raw: text,
        code: files.length > 0 ? files[0].code : extractCodeBlock(text),
        files,
        model
      };
    } catch (err) {
      if (err.message && (err.message.includes('404') || err.message.includes('does not exist') || err.message.includes('429'))) {
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

  const files = parseMultiFileSolution(text, settings.activeFile, settings.workspaceFiles);
  return {
    raw: text,
    code: files.length > 0 ? files[0].code : extractCodeBlock(text),
    files,
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
  settings.activeFile = promptData.activeFile || 'src/index.js';
  settings.workspaceFiles = promptData.workspaceFiles || [];

  const prompt = buildPrompt(promptData);

  // Check which providers have valid keys
  const hasGemini = !!(settings.geminiKey && settings.geminiKey.trim());
  const hasGroq = !!(settings.groqKey && settings.groqKey.trim());
  const hasOpenAI = !!(settings.openaiKey && settings.openaiKey.trim());

  if (!hasGemini && !hasGroq && !hasOpenAI) {
    throw new Error('No API key configured. Please enter your Gemini or Groq API key in AP-Solver settings.');
  }

  let provider = settings.provider || 'race';

  // SPECULATIVE TURBO PARALLEL RACE:
  // If provider is 'race' OR if both Groq and Gemini keys are available, race them concurrently!
  // Whichever provider returns valid code first WINS and solves the problem in sub-second time!
  const shouldRace = (provider === 'race' || provider === 'auto') ? (hasGroq && hasGemini) : (hasGroq && hasGemini && (provider === 'groq' || provider === 'gemini'));

  if (shouldRace || (provider === 'race' && hasGroq && hasGemini)) {
    console.log('[AP-Solver] ⚡ Turbo Parallel Race: Executing Groq & Gemini concurrently...');

    const runGroq = async () => {
      const t0 = Date.now();
      const res = await callGroq(prompt, settings);
      res.latencyMs = Date.now() - t0;
      res.raceWinner = `Groq LPU (${res.model})`;
      return res;
    };

    const runGemini = async () => {
      const t0 = Date.now();
      const res = await callGemini(prompt, settings);
      res.latencyMs = Date.now() - t0;
      res.raceWinner = `Google Gemini (${res.model})`;
      return res;
    };

    try {
      const winner = await Promise.any([runGroq(), runGemini()]);
      console.log(`[AP-Solver] 🚀 Turbo Winner: ${winner.raceWinner} in ${winner.latencyMs}ms!`);
      return winner;
    } catch (aggErr) {
      console.warn('[AP-Solver] Turbo race aggregate error, trying fallback:', aggErr);
      if (hasOpenAI) {
        return await callOpenAI(prompt, settings);
      }
      throw aggErr.errors?.[0] || new Error('All parallel AI solvers failed.');
    }
  }

  // Single provider mode or fallback
  if (provider === 'race') {
    provider = hasGroq ? 'groq' : (hasGemini ? 'gemini' : 'openai');
  }

  if (provider === 'gemini' && !hasGemini) {
    provider = hasGroq ? 'groq' : 'openai';
  } else if (provider === 'groq' && !hasGroq) {
    provider = hasGemini ? 'gemini' : 'openai';
  }

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
