// utils/llm.js - Multi-Provider AI Engine (Gemini, Groq, OpenAI / OpenRouter)

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
   - For Prisma Schema ('prisma/schema.prisma'):
     * Datasource & Generator:
       datasource db {
         provider = "postgresql"
         url = env("DATABASE_URL")
       }
       generator client {
         provider = "prisma-client-js"
       }
     * One-to-One Relationships (e.g. User and Profile):
       model User {
         id Int @id @default(autoincrement())
         name String
         email String @unique
         profile Profile?
       }
       model Profile {
         id Int @id @default(autoincrement())
         bio String
         age Int
         city String
         userId Int @unique
         user User @relation(fields: [userId], references: [id])
       }
   - For Prisma Seeding ('src/seed.js' or 'seed.js'):
     * Import PrismaClient: 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();'.
     * In async function main():
       - Clear old records first in dependency order (e.g. child before parent):
         await prisma.profile.deleteMany();
         await prisma.user.deleteMany();
       - For batch records, support createMany with skipDuplicates: true:
         await prisma.user.createMany({ data: usersData, skipDuplicates: true });
       - Populate records with the exact fields and values specified in the task description:
         await prisma.user.create({
           data: {
             name: 'Priya',
             email: 'priya@example.com',
             profile: {
               create: {
                 bio: 'Priya bio',
                 age: 30,
                 city: 'New York'
               }
             }
           }
         });
         await prisma.user.create({
           data: {
             name: 'Rahul',
             email: 'rahul@example.com',
             profile: {
               create: {
                 bio: 'Rahul bio',
                 age: 25,
                 city: 'Los Angeles'
               }
             }
           }
         });
       - Catch errors with console.error and process.exit(1).
       - In 'finally', ALWAYS call 'await prisma.$disconnect();' so the connection doesn't hang!
     * Invoke main(): 'main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });'.
     * For Prisma challenges, ALWAYS output all required files in separate blocks:
       1. 'prisma/schema.prisma' with complete datasource and models.
       2. 'src/seed.js' with complete seeding implementation.
       3. 'src/index.js' with clean express starter (module.exports = app;) free of any artifacts.
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
   - For JWT Authentication & Token Challenges (e.g. "Login and Get a Token", POST /login, authenticate middleware, GET /profile):
     * Hardcoded User & Secret:
       - Preserve the hardcoded 'SECRET' (e.g. 'const SECRET = "my_super_secret_key";') and 'user' object exactly as defined in the starter code.
     * POST /login Endpoint:
       - Extract credentials: 'const { username, password } = req.body || {};'.
       - Reject missing, null, undefined, non-string, or empty/whitespace credentials:
         if (!username || !password || typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password.trim()) {
           return res.status(401).json({ message: 'Invalid credentials' });
         }
       - Exact Match Validation:
         if (username !== user.username || password !== user.password) {
           return res.status(401).json({ message: 'Invalid credentials' });
         }
       - Generate Token: Sign with payload containing 'userId: user.id' (or 'user.userId'), secret 'SECRET', and EXACTLY 15 minutes expiry:
         const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '15m' });
         return res.status(200).json({ token });
     * authenticate Middleware:
       - Extract header: 'const authHeader = req.headers["authorization"] || req.headers["Authorization"];'.
       - Reject if Authorization header is missing or not a string:
         if (!authHeader || typeof authHeader !== 'string') {
           return res.status(401).json({ message: 'Token missing' });
         }
         const parts = authHeader.split(' ');
         if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
           return res.status(401).json({ message: 'Invalid or expired token' });
         }
         const token = parts[1];
       - Verify Token with SECRET:
         try {
           const decoded = jwt.verify(token, SECRET);
           if (!decoded || (!decoded.userId && !decoded.id)) {
             return res.status(401).json({ message: 'Invalid or expired token' });
           }
           req.user = decoded;
           return next();
         } catch (err) {
           return res.status(401).json({ message: 'Invalid or expired token' });
         }
     * GET /profile Endpoint:
       - Protect with 'authenticate' middleware: 'app.get("/profile", authenticate, (req, res) => { ... });'.
       - Check user match:
         const targetId = req.user ? (req.user.userId || req.user.id) : null;
         if (targetId && targetId !== user.id) {
           return res.status(404).json({ message: 'User not found' });
         }
       - NEVER expose password in the profile response:
         const { password: _, ...safeUser } = user;
         return res.status(200).json(safeUser);
     * Module Exports:
       - Support both default and named imports for the test runner:
         module.exports = app;
         module.exports.app = app;
         module.exports.authenticate = authenticate;
         module.exports.SECRET = SECRET;
         module.exports.user = user;
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
   - POST-WRITE TERMINAL COMMANDS (IF REQUIRED): If the task or error requires running terminal commands after writing files (e.g. npx prisma migrate deploy, npx prisma db push, npx prisma generate, node src/seed.js, npm run build, npm install <pkg>), output an optional bash block with '// __commands__' on Line 1 and one command per line. Never put shell commands inside .js/.ts/.prisma files.
7. OUTPUT FORMAT:
   - Output ONLY the clean replacement code enclosed in markdown code block(s):
   \`\`\`javascript
   code here
   \`\`\`
   - Absolutely NO explanations, markdown or conversational text outside the code block(s).
8. AVOID WRITING COMMENTS IN CODE:
   - CRITICAL REQUIREMENT: NEVER write any comments inside the generated code.
   - Do NOT write single-line comments ('// ...').
   - Do NOT write multi-line comments ('/* ... */').
   - Do NOT write JSDoc comments or conversational explanations.
   - Output 100% pure, clean, executable code ONLY.
9. MASTER DEBUGGING & ROOT CAUSE RESOLUTION PROTOCOL:
   When refining code after failed test cases:
   - READ THE EXACT ERROR TRACE: Inspect the AssertionError, diff (+ expected - actual), and stack trace line number.
   - CHAI / MOCHA EQUALITY ASSERTIONS:
     * 'expected 200 to equal 400': Test expected 400 Bad Request (input validation failure), but endpoint returned 200. Add explicit validation guard at the top of the route handler: if (!field || typeof field !== 'string' || !field.trim()) return res.status(400).json({ error: 'Field is required', message: 'Field is required' });
     * 'expected 200 to equal 201': POST resource creation routes must return HTTP 201 Created: res.status(201).json(...).
     * 'expected 500 to equal 404': Uncaught error or non-existent record threw 500 instead of returning 404 Not Found. Add null check: if (!record) return res.status(404).json({ error: 'Not found', message: 'Not found' });
     * 'expected 200 to equal 409' or 'expected 500 to equal 400' on duplicate: Check uniqueness before inserting (e.g. findUnique/findFirst); return error status if record exists.
   - DUAL ERROR PROPERTY SUPPORT:
     Newton School test assertions frequently check either res.body.error or res.body.message.
     * If the Question Description or discovered Test Suite explicitly checks an exact JSON object equality (e.g. deep.equal({ error: "..." }) or deep.equal({ message: "..." })), return THAT exact key.
     * Otherwise, ALWAYS provide BOTH properties on error responses: res.status(code).json({ error: msg, message: msg });
   - INSTALLED PACKAGES & MODULE ADHERENCE:
     * Strictly inspect package.json dependencies. NEVER require/import an uninstalled package (e.g. do NOT require('bcrypt') if package.json lists 'bcryptjs'; use the exact package listed).
     * Respect "type": "module" if set in package.json (ESM import/export); otherwise use CommonJS require/module.exports.
   - EXPRESS JSON SYNTAX ERROR MIDDLEWARE & ZERO HANGING TIMEOUTS:
     * In Express apps, add malformed-JSON body error handler after routes so invalid JSON payloads return 400 instead of 500: app.use((err, req, res, next) => { if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ error: 'Invalid JSON', message: 'Invalid JSON' }); return res.status(err.status || 500).json({ error: err.message || 'Server error', message: err.message || 'Server error' }); });
     * PREVENT MOCHA 2000MS TIMEOUTS: Every async route handler MUST be wrapped in try/catch, and EVERY code branch (if, else, catch) MUST send a response with return res.status(...).json(...). Never omit 'return' before res.status().
   - COMPLETE WORKSPACE SYNCHRONIZATION:
     Always return all required files (e.g. prisma/schema.prisma, src/seed.js, src/index.js) so the entire project remains complete and functioning.`;

export function stripComments(code) {
  if (!code) return '';
  // Remove multi-line comments: /* ... */
  let clean = code.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments: // ... (ensuring we don't strip inside quotes)
  const lines = clean.split('\n');
  const result = [];
  for (const line of lines) {
    let inQuote = false;
    let quoteChar = '';
    let commentIdx = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if ((c === '"' || c === "'" || c === '`') && (i === 0 || line[i - 1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = c;
        } else if (c === quoteChar) {
          inQuote = false;
        }
      } else if (!inQuote && c === '/' && line[i + 1] === '/') {
        commentIdx = i;
        break;
      }
    }
    const processed = commentIdx !== -1 ? line.substring(0, commentIdx).trimEnd() : line;
    if (commentIdx !== -1 && !processed.trim() && line.trim().startsWith('//')) {
      continue;
    }
    result.push(processed);
  }
  return result.join('\n');
}

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

/** Sanitize and validate a container setup/build/migration command so only safe, non-blocking commands execute. */
export function sanitizePostWriteCommand(rawCmd) {
  if (!rawCmd || typeof rawCmd !== 'string') return '';
  let cmd = rawCmd.trim()
    .replace(/^(?:\$|>\s*|#\s*)/, '')
    .trim();
  if (!cmd || cmd.startsWith('//') || cmd.startsWith('#') || cmd.length > 300) return '';
  if (/&&\s*$|^\s*&&|\n|\r/.test(cmd)) return '';
  if (/(?:rm\s+-[a-z]*rf?\s+\/(?:\s|$)|mkfs\b|dd\s+if=|shutdown\b|reboot\b|:\(\)\{|curl\s+[^|]*\|\s*(?:ba)?sh|wget\s+[^|]*\|\s*(?:ba)?sh|>\s*\/dev\/)/i.test(cmd)) {
    return '';
  }
  // Reject commands that block forever or re-invoke full test runners during setup phase
  if (/^(?:npm\s+(?:test|t|start)|npm\s+run\s+(?:test|start|dev|watch)\b|nodemon\b|node\s+(?:src\/)?index\.js\b)/i.test(cmd)) {
    return '';
  }
  if (!/^(?:npm\s+(?:install|i|ci|run\s+[\w:.-]+|exec)|npx\s+|yarn\s+|pnpm\s+|node\s+|prisma\s+|tsc\b|mkdir\s+-p\b|cp\s+|chmod\s+|psql\b|sqlite3\b|python3?\s+|pip3?\s+install)/i.test(cmd)) {
    return '';
  }
  return cmd;
}

/** Extract optional post-write terminal commands (// __commands__ or ```ap-commands) from LLM response. */
export function extractCommandsFromResponse(rawText) {
  if (!rawText) return [];
  const commands = [];
  const blockRegex = /```([a-zA-Z0-9_\-]+)?(?::([^\n]+))?([^\n]*)\n([\s\S]*?)```/g;
  for (const match of rawText.matchAll(blockRegex)) {
    const lang = (match[1] || '').toLowerCase();
    const extra = ((match[2] || '') + ' ' + (match[3] || '')).toLowerCase();
    const body = (match[4] || '').trim();
    if (!body) continue;
    const firstLine = body.split('\n')[0].trim();
    const isCommandBlock =
      lang === 'ap-commands' ||
      /^(?:\/\/|#)\s*(?:__commands__|run_commands)\b/i.test(firstLine) ||
      /__commands__/i.test(extra);
    if (!isCommandBlock) continue;

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^(?:\/\/|#)/.test(trimmed)) continue;
      for (const sub of trimmed.split(/\s*&&\s*/)) {
        const clean = sanitizePostWriteCommand(sub);
        if (clean && !commands.includes(clean)) {
          commands.push(clean);
        }
      }
    }
  }
  return commands;
}

/** Auto-detect required setup, build, migration, or error-remediation terminal commands. */
export function detectRequiredPostWriteCommands({
  questionDetails = '',
  packageJsonStr = '',
  filesToWrite = [],
  lastErrorOutput = ''
} = {}) {
  const cmds = [];
  const addCmd = (raw) => {
    const clean = sanitizePostWriteCommand(raw);
    if (clean && !cmds.includes(clean)) cmds.push(clean);
  };

  let pkg = {};
  try {
    if (packageJsonStr) pkg = JSON.parse(packageJsonStr);
  } catch (e) {}
  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const nodeBuiltins = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
    'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
    'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
    'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
  ]);

  // 1. Auto-remediation directly from previous terminal/runtime error traces
  if (lastErrorOutput) {
    const modMatches = [...String(lastErrorOutput).matchAll(/Cannot find module\s+['"]([^'"]+)['"]/gi)];
    for (const m of modMatches) {
      const mod = (m[1] || '').trim();
      if (!mod || mod.startsWith('.') || mod.startsWith('/') || mod.startsWith('node:')) continue;
      const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
      if (nodeBuiltins.has(pkgName)) continue;
      if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkgName)) {
        if (deps[pkgName]) {
          addCmd('npm install --no-audit --no-fund');
        } else {
          addCmd(`npm install --no-audit --no-fund ${pkgName}`);
        }
      }
    }
    if (/sh:\s*\d+:\s*(?:mocha|jest|tsc|prisma):\s*not found/i.test(lastErrorOutput)) {
      addCmd('npm install --no-audit --no-fund');
    }
    if (/@prisma\/client did not initialize|PrismaClientInitializationError|table\s+.*\s+does not exist|does not exist in the current database/i.test(lastErrorOutput)) {
      addCmd('npx -y prisma generate');
      addCmd('npx -y prisma db push --skip-generate');
    }
    if (/Cannot find module\s+['"]\.\/(?:dist|build)\//i.test(lastErrorOutput) && scripts.build) {
      addCmd('npm run build');
    }
  }

  // 2. Build / migration commands inferred from package.json & written files
  const writesTs = (filesToWrite || []).some(f => f.filePath && /\.ts$/i.test(f.filePath));
  if (writesTs && scripts.build) {
    addCmd('npm run build');
  }
  const hasPrismaFile = (filesToWrite || []).some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client/i.test(f.code || ''));
  if (!hasPrismaFile) {
    // Only extract explicit setup commands from question prose if not already covered by Prisma auto-script
    if (scripts.migrate) addCmd('npm run migrate');
  }

  // 3. Backtick-quoted setup commands explicitly mentioned in Question Description
  if (questionDetails) {
    const btMatches = [...String(questionDetails).matchAll(/`((?:npm\s+run\s+(?:build|seed|migrate|setup|db:[a-z0-9_-]+)|npx\s+(?:prisma\s+(?:migrate|db\s+push|generate)|tsc)[^`]*|node\s+src\/(?:seed|init|setup|migrate)[^`]*))`/gi)];
    for (const bm of btMatches) {
      addCmd(bm[1]);
    }
  }

  return cmds;
}

export function stripFileCommentHeaders(code) {
  if (!code) return '';
  return code
    .replace(/^\s*(?:\/\/|\/\*|#+)\s*file\s*\d+[^\n]*(?:\*\/)?\s*\n?/gim, '')
    .replace(/^\s*(?:\/\/|\/\*|#+)\s*(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:src\/)?[a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql)[^\n]*(?:\*\/)?\s*\n?/gi, '')
    .trim();
}

export function parseMultiFileSolution(rawText, defaultActiveFile = 'src/index.js', workspaceFiles = []) {
  if (!rawText) return [];

  // Strip optional post-write __commands__ / ap-commands bash blocks before parsing code files
  const sanitizedRawText = String(rawText).replace(
    /```(?:[a-zA-Z0-9_\-]+)?(?::[^\n]+)?[^\n]*\n\s*(?:(?:\/\/|#)\s*(?:__commands__|RUN_COMMANDS)\b[\s\S]*?)```/gi,
    ''
  ).replace(/```ap-commands[^\n]*\n[\s\S]*?```/gi, '').trim();
  const parseSource = sanitizedRawText || rawText;

  const normPath = (fn) => {
    if (!fn) return '';
    fn = fn.trim();
    if (fn.endsWith('.prisma') || fn === 'schema.prisma') {
      return fn.startsWith('prisma/') ? fn : 'prisma/' + fn;
    }
    if (fn.startsWith('src/')) return fn;
    if (fn.includes('/') || fn === 'package.json' || fn.startsWith('.')) return fn;
    return 'src/' + fn;
  };

  const isValidFilename = (fn) => {
    if (!fn) return false;
    fn = fn.trim();
    if (/__commands__|run_commands/i.test(fn)) return false;
    if (/^(1|2|3|4|5|one|two|file1|file2|file_1|file_2)(\.(js|ts|prisma|sql))?$/i.test(fn)) return false;
    return /\.(js|ts|json|txt|prisma|sql|env|graphql|html|css)$/i.test(fn);
  };

  const resolveTargetFile = (fn, codeSnippet, idx) => {
    // 1. Content-based detection ALWAYS takes absolute precedence over generic/mismatched filenames
    if (/datasource\s+db|generator\s+client|model\s+[A-Z]/i.test(codeSnippet) || (fn && fn.endsWith('.prisma'))) {
      return 'prisma/schema.prisma';
    }
    if (/PrismaClient|prisma\.\w+\.(create|deleteMany|find)/i.test(codeSnippet) && !/express|createServer|app\.listen/i.test(codeSnippet)) {
      return 'src/seed.js';
    }
    if (/express|createServer|app\.listen|app\.use/i.test(codeSnippet) && !/PrismaClient|prisma\.\w+/i.test(codeSnippet)) {
      return 'src/index.js';
    }
    if (/"prisma"\s*:\s*\{|"scripts"\s*:\s*\{/i.test(codeSnippet) || fn === 'package.json') {
      return 'package.json';
    }

    if (fn && isValidFilename(fn)) return normPath(fn);
    if (workspaceFiles && workspaceFiles.length > 0) {
      const codeFiles = workspaceFiles.filter(f => /\.(js|ts|prisma)$/i.test(f) && !/nodemon|package|config/i.test(f));
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

  const fileHeaderPattern = /^(?:\/\/\s*|\/\*\s*|#+\s*)?(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+|file\s*\d+)[\.:\-\)]\s*)?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))(?:\s*---|\s*\*\/)?\s*(?:\n|$)/i;

  // Strategy 1: Multiple or Single markdown code blocks
  const blockRegex = /```(?:[a-zA-Z0-9_\-]+)?(?::([^\n]+))?([^\n]*)\n([\s\S]*?)```/g;
  const blocks = [...parseSource.matchAll(blockRegex)];

  if (blocks.length > 0) {
    const parsedBlocks = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const langExtra = (b[1] || '') + ' ' + (b[2] || '');
      let code = stripFileCommentHeaders(b[3]);

      const prevEnd = (i > 0) ? (blocks[i - 1].index + blocks[i - 1][0].length) : 0;
      const precedingText = parseSource.substring(prevEnd, b.index).trim();

      let detectedFilename = '';

      // 1. Check first line inside code
      const firstLineMatch = b[3].trim().match(fileHeaderPattern);
      if (firstLineMatch && isValidFilename(firstLineMatch[1])) {
        detectedFilename = firstLineMatch[1];
      }

      // 2. Check lang tag / extra
      if (!detectedFilename && langExtra) {
        const m = langExtra.match(/([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))/i);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }

      // 3. Check preceding text (last 3 lines)
      if (!detectedFilename && precedingText) {
        const lines = precedingText.split('\n').map(l => l.trim()).filter(Boolean);
        const lastFew = lines.slice(-3).join(' ');
        const m = lastFew.match(/(?:file:?\s*)?(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:`|'|\")?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))/i);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }

      const finalPath = resolveTargetFile(detectedFilename, code, i);
      if (finalPath && code) {
        parsedBlocks.push({ filePath: finalPath, code: formatCodeIndentation(stripComments(stripFileCommentHeaders(code))) });
      }
    }

    if (parsedBlocks.length > 0 && (blocks.length > 1 || parsedBlocks[0].filePath !== normPath(defaultActiveFile))) {
      return parsedBlocks;
    }
  }

  // Strategy 2: Single block or raw text split by line-based file comment headers
  const headerRegex = /(?:^|\n)\s*(?:\/\/|\/\*|#+)\s*(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+|file\s*\d+)[\.:\-\)]\s*)?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))(?:\s*---|\s*\*\/)?\s*(?:\n|$)/gi;
  const headers = [...parseSource.matchAll(headerRegex)].filter(h => isValidFilename(h[1]));

  if (headers.length > 0) {
    const inlineFiles = [];
    for (let i = 0; i < headers.length; i++) {
      const fn = headers[i][1];
      const start = headers[i].index + headers[i][0].length;
      const end = (i + 1 < headers.length) ? headers[i + 1].index : parseSource.length;
      let rawCode = parseSource.substring(start, end).trim();
      rawCode = rawCode.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
      rawCode = stripFileCommentHeaders(rawCode);
      if (rawCode.length > 5) {
        inlineFiles.push({ filePath: normPath(fn), code: formatCodeIndentation(stripComments(rawCode)) });
      }
    }
    if (inlineFiles.length > 0) {
      return inlineFiles;
    }
  }

  // Strategy 3: Check if raw text starts with a file header line
  let cleaned = parseSource.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
  const topMatch = cleaned.match(fileHeaderPattern);
  if (topMatch && isValidFilename(topMatch[1])) {
    const fn = topMatch[1];
    cleaned = stripFileCommentHeaders(cleaned);
    return [{ filePath: normPath(fn), code: formatCodeIndentation(stripComments(cleaned)) }];
  }

  const singleCode = stripFileCommentHeaders(extractCodeBlock(parseSource));
  const finalSinglePath = resolveTargetFile('', singleCode, 0);
  return [{
    filePath: finalSinglePath,
    code: formatCodeIndentation(stripComments(singleCode))
  }];
}

export function extractCodeBlock(rawText) {
  if (!rawText) return '';
  const parseSource = String(rawText)
    .replace(/```(?:[a-zA-Z0-9_\-]+)?(?::[^\n]+)?[^\n]*\n\s*(?:(?:\/\/|#)\s*(?:__commands__|RUN_COMMANDS)\b[\s\S]*?)```/gi, '')
    .replace(/```ap-commands[^\n]*\n[\s\S]*?```/gi, '')
    .trim() || rawText;
  let extracted = '';
  const match = parseSource.match(/```(?:javascript|js|typescript|ts|node)?\s*\n([\s\S]*?)```/i);
  if (match && match[1]) {
    extracted = match[1].trim();
  } else {
    // If wrapped in generic code block
    const genericMatch = parseSource.match(/```\s*\n([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
      extracted = genericMatch[1].trim();
    } else {
      extracted = parseSource.trim();
    }
  }

  extracted = stripComments(stripFileCommentHeaders(extracted));
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

  // Track files already attached in feedback so debug prompts never duplicate identical file bodies 2-3x
  const feedbackEmbeddedFiles = new Set();
  if (feedback) {
    for (const m of String(feedback).matchAll(/### File:\s*`([^`]+)`/g)) {
      if (m[1]) feedbackEmbeddedFiles.add(m[1].trim());
    }
  }

  if (referenceFiles && Object.keys(referenceFiles).length > 0) {
    // 1. Parse package.json explicitly so LLM never imports missing packages (e.g. bcrypt vs bcryptjs) or wrong module syntax
    const pkgKey = Object.keys(referenceFiles).find(k => k === 'package.json' || k.endsWith('/package.json'));
    if (pkgKey && referenceFiles[pkgKey]) {
      try {
        const pkg = JSON.parse(referenceFiles[pkgKey]);
        const deps = pkg.dependencies ? Object.entries(pkg.dependencies).map(([k, v]) => `${k} (${v})`) : [];
        const devDeps = pkg.devDependencies ? Object.entries(pkg.devDependencies).map(([k, v]) => `${k} (${v})`) : [];
        const moduleType = pkg.type === 'module'
          ? 'ES Modules ("type": "module" -> MUST use `import`/`export` syntax)'
          : 'CommonJS (default -> MUST use `require()`/`module.exports`)';
        const scriptsStr = pkg.scripts ? JSON.stringify(pkg.scripts) : '{}';
        parts.push(`## 📦 INSTALLED PACKAGES & SCRIPTS (\`package.json\` — STRICT CONTRACT):
- **Module System**: ${moduleType}
- **Installed Dependencies**: ${deps.length > 0 ? deps.join(', ') : 'None listed'}
- **Dev Dependencies**: ${devDeps.length > 0 ? devDeps.join(', ') : 'None listed'}
- **NPM Scripts**: \`${scriptsStr}\`
- **CRITICAL IMPORT RULE**: ONLY import/require packages explicitly listed above or built-in Node modules (\`node:http\`, \`fs\`, \`path\`, \`crypto\`, \`events\`, \`url\`). NEVER import an uninstalled package (e.g. do NOT write \`require('bcrypt')\` if only \`bcryptjs\` is installed!).`);
      } catch (e) {}
    }

    // 2. Separate discovered test files from starter files so grader assertions get top focus
    const testEntries = [];
    const starterEntries = [];
    for (const [fname, content] of Object.entries(referenceFiles)) {
      if (!content) continue;
      if (feedbackEmbeddedFiles.has(fname)) continue; // Already included inside CURRENT CODE section in feedback
      const ext = fname.split('.').pop().toLowerCase();
      const lang = ext === 'json' ? 'json' : (ext === 'prisma' ? 'prisma' : (ext === 'ts' ? 'typescript' : 'javascript'));
      if (/(?:^|\/)(?:test|tests|__tests__)\/|(?:\.test|\.spec)\.(?:js|ts|mjs|cjs)$/i.test(fname)) {
        testEntries.push(`### Grading Test File: \`${fname}\`\n\`\`\`${lang}\n${content}\n\`\`\``);
      } else {
        starterEntries.push(`### Initial Starter File: \`${fname}\`\n\`\`\`${lang}\n${content}\n\`\`\``);
      }
    }

    if (testEntries.length > 0) {
      parts.push(`## 🎯 EXACT GRADING TEST SUITE FILES DISCOVERED IN WORKSPACE:\nInspect EVERY \`describe\`, \`it\`, \`test\`, route path, status code, and property assertion in these actual test files! Your implementation MUST satisfy 100% of them:\n${testEntries.join('\n\n')}`);
    }

    if (starterEntries.length > 0) {
      parts.push(`## Initial Workspace Files & Starter Code:\n${starterEntries.join('\n\n')}`);
    }
  }

  if (questionDetails) {
    let compactDetails = String(questionDetails).replace(/\n{3,}/g, '\n\n').trim();
    // On retries keep problem specification concise so error logs & code receive full token budget
    if (feedback && compactDetails.length > 5500) {
      compactDetails = compactDetails.slice(0, 3800) + '\n...\n' + compactDetails.slice(-1200);
    }
    parts.push(`## Problem Description & Requirements:\n${compactDetails}`);
  }

  if (testCases && testCases.length > 0) {
    parts.push(`## Test Cases to Pass (All Must Pass):\n${testCases.map((tc, i) => `${i + 1}. ${tc}`).join('\n')}`);
  }

  const activeAlreadyInFeedback = feedback && (
    feedbackEmbeddedFiles.has(activeFile) ||
    [...feedbackEmbeddedFiles].some(f => f.endsWith('/' + activeFile) || activeFile.endsWith('/' + f))
  );
  if (currentCode && !activeAlreadyInFeedback) {
    const codeHeader = feedback
      ? `## Previous Attempt Solution Code in \`${activeFile}\` (${language}):`
      : `## Current Starter Code in \`${activeFile}\` (${language}):`;
    parts.push(`${codeHeader}\n\`\`\`${language}\n${currentCode}\n\`\`\``);
  }

  if (feedback) {
    parts.push(`## CRITICAL: PREVIOUS SUBMISSION FAILED — ONE-SHOT SIMULTANEOUS ERROR RESOLUTION REQUIRED
Earlier attempt resulted in test failures. The full terminal logs, assertion diffs, and itemized errors have been deeply analyzed below.
You MUST analyze EVERY failure trace and implement a unified, comprehensive fix that resolves ALL test cases simultaneously in this single output.

${feedback}

### MANDATORY ONE-SHOT REFINEMENT INSTRUCTIONS:
1. Resolve EVERY failing test simultaneously. Do NOT cherry-pick or fix only the first failure.
2. Cross-reference the exact line numbers and stack traces with the current file contents provided above.
3. Match exact status codes (200, 201, 400, 404, 409) and exact JSON key shapes as demanded by tests.
4. Guarantee no hanging async requests (every branch must call res.status(...).json(...) or res.send(...)).
5. If setup/build/migration/seed commands must run in terminal after writing files, add an optional \`\`\`bash // __commands__\`\`\` block.
6. Return complete, production-ready code for all updated files with \`// <filepath>\` on Line 1 and zero comments.`);
  }

  const isPrismaTask = /prisma|schema\.prisma|seed\.js|one-to-one/i.test((questionTitle || '') + ' ' + (questionDetails || ''));
  if (isPrismaTask) {
    parts.push(`## MANDATORY PRISMA MULTI-FILE REQUIREMENTS:
This challenge REQUIRES multiple files. You MUST output ALL required files in separate markdown code blocks:
\`\`\`prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  profile Profile?
}

model Profile {
  id Int @id @default(autoincrement())
  bio String
  age Int
  city String
  userId Int @unique
  user User @relation(fields: [userId], references: [id])
}
\`\`\`

\`\`\`javascript
// src/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: {
      name: 'Priya',
      email: 'priya@example.com',
      profile: {
        create: {
          bio: 'Priya bio',
          age: 30,
          city: 'New York'
        }
      }
    }
  });

  await prisma.user.create({
    data: {
      name: 'Rahul',
      email: 'rahul@example.com',
      profile: {
        create: {
          bio: 'Rahul bio',
          age: 25,
          city: 'Los Angeles'
        }
      }
    }
  });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
\`\`\`

\`\`\`javascript
// src/index.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8000;
app.use(express.json());
app.get('/', (req, res) => { res.send('Server is running'); });
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => { console.log('Server running on port ' + PORT); });
}
module.exports = app;
\`\`\`
DO NOT OMIT prisma/schema.prisma! It is required for the database tables to be created!`);
  }

  parts.push(`## Operational Process Guidelines:
1. GIVE FULL QUESTION AND INITIAL CODE: Carefully inspect the full question requirements and initial starter code across all files above.
2. DETERMINE ALL REQUIRED FILES & LOCATIONS: Identify all files in which code must be written. If a required file is not present in the project (e.g. \`src/seed.js\`, \`src/routes/tasks.js\`, \`src/controllers/userController.js\`), specify its full path on Line 1 so it will be created at its given location.
3. WRITE COMPLETE CODE & ERASE INITIAL CODE: Provide 100% complete, bug-free replacement code for all required files that completely erases initial starter code and fills corresponding files.
4. ONE CODE BLOCK PER FILE: Output each file in its own distinct markdown code block with the exact file path on Line 1 (e.g. \`// src/seed.js\`).
5. NO GENERIC LABELS: Never use "File 1", "1.js", or conversational text. Return ONLY the code blocks.
6. AVOID WRITING COMMENTS IN CODE: NEVER write comments in the code. Output clean, pure executable code only.`);

  return parts.join('\n\n');
}

function getContextGatedSystemPrompt(userPrompt, isDebug = false) {
  const p = String(userPrompt || '');
  // Inspect ONLY the original challenge specification & package/workspace context (never stale feedback errors)
  const specSection = p.split('## CRITICAL: PREVIOUS SUBMISSION FAILED')[0].split('=== PREVIOUS ATTEMPT')[0];
  const needsPrisma = /prisma|schema\.prisma|seed\.js|postgresql/i.test(specSection);
  const needsJwt = /jwt|jsonwebtoken|refresh\s*token|\/login|\/refresh|bearer/i.test(specSection);
  const needsNativeHttp = /node:http|createServer|http\.createServer/i.test(specSection);
  const needsExpressAuth = /bcrypt|\/register/i.test(specSection);

  const lines = [
    'You are a Senior Full-Stack Software Engineer. Write complete, bug-free, test-compliant solutions.',
    'RULES: Follow every requirement verbatim. Match starter code style (CommonJS vs ESM, Express vs node:http). Preserve all exports (e.g. module.exports = app/server).',
    'NEVER invent extra files (e.g. NEVER create prisma/schema.prisma or seed.js unless explicitly required by the problem!).',
    'NEVER invent uninstalled packages; strictly use packages in package.json or Node built-ins. Fix JSON SyntaxError with express error handler returning 400. Return res.status(...).json(...) on every branch so requests never hang or timeout.',
    'Output ONLY clean executable code (NO comments, NO explanations, NO "... rest of code") in markdown fenced code block(s) with exact file path on line 1 (e.g. // src/index.js).',
    'If setup/migration/build/seed commands must run in terminal after writing files, add a separate ```bash block starting with // __commands__ and list one shell command per line.',
    '2-space indentation only; no tabs.'
  ];
  if (needsPrisma) lines.push('PRISMA: Output prisma/schema.prisma, src/seed.js (deleteMany child-then-parent, await prisma.$disconnect() in finally), and src/index.js cleanly.');
  if (needsNativeHttp) lines.push('NODE HTTP: Set Content-Type application/json; parse JSON safely (400 on invalid JSON); export server cleanly (module.exports = server; module.exports.server = server;). Return 404 on unknown routes.');
  if (needsJwt) lines.push('JWT: Preserve hardcoded SECRET and user object; reject missing/invalid/malformed/wrong-secret tokens accurately per spec.');
  if (needsExpressAuth) lines.push('EXPRESS AUTH: Validate inputs strictly (400), check duplicate records via findFirst/findUnique before create, hash password with installed bcrypt/bcryptjs, omit password from JSON response.');
  if (isDebug || /PREVIOUS ATTEMPT|FAILED/i.test(p)) lines.push('DEBUG: Fix EVERY failing test simultaneously in one complete replacement file without breaking passing routes.');
  return lines.join('\n');
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
    if (seenPro429 && /pro/i.test(model)) {
      continue; // Skip redundant Pro alias after quota exhaustion; fall straight to Flash
    }
    if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 3000) {
      break;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const maxOut = /1\.5|2\.0/.test(model) ? 8192 : (isDebug ? 12288 : 8192);
    const isGemini3 = /^gemini-3/i.test(model);
    const isProModel = /pro/i.test(model);

    // Gemini 2.5 models use thinkingBudget (thinkingLevel causes HTTP 400 on 2.5); Gemini 3 uses thinkingLevel
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
          {
            temperature: 0.1,
            topP: 0.95,
            maxOutputTokens: maxOut
          }
        ];

    for (const genConfig of configsToTry) {
      if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 2000) {
        break;
      }
      const remainingMs = settings.deadlineAt ? Math.max(8000, settings.deadlineAt - Date.now()) : (isDebug ? 50000 : 35000);
      const reqTimeoutMs = Math.min(isDebug ? (isProModel ? 45000 : 35000) : 30000, remainingMs);

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: gatedSysPrompt + '\n\n' + prompt }
            ]
          }
        ],
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
        // Extract text ONLY from non-thought parts (never treat raw internal thought prose as code)
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
          if (genConfig === configsToTry[configsToTry.length - 1]) {
            break;
          }
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

// Smart priority-preserving compactor for strict Groq TPM quotas (never slices off debug errors at the bottom)
function buildCompactGroqMessages(systemPrompt, userPrompt, desiredMaxTokens = 4096, tpmLimit = 7600) {
  const p = String(userPrompt || '');
  const sys = getContextGatedSystemPrompt(p, /PREVIOUS ATTEMPT|FAILED/i.test(p));

  let compactPrompt = p;
  const reservedOutputTokens = Math.min(4400, Math.max(desiredMaxTokens, Math.floor(tpmLimit * 0.54)));
  const maxPromptChars = Math.min(7600, Math.max(2800, Math.floor((tpmLimit - reservedOutputTokens - 350) * 3.0) - sys.length));

  if (compactPrompt.length > maxPromptChars) {
    // 1. First shrink verbose Tab 3 terminal output while preserving AssertionError, Error, passing/failing & user stack lines
    compactPrompt = compactPrompt.replace(
      /(SIDE BAR TERMINAL & MOCHA ERROR TRACES \(FROM TAB 3\):\n```\n)([\s\S]*?)(\n```)/,
      (_, hdr, body, ftr) => {
        const important = body.split('\n').filter(l =>
          /\d+\s+(?:passing|failing)|\d+\)|AssertionError|TypeError|ReferenceError|SyntaxError|Error:|expected|actual|diff|^[+-]\s|at\s+/i.test(l)
        ).join('\n');
        const chosen = important.length >= 120 ? important : body;
        return hdr + chosen.slice(0, 1200) + ftr;
      }
    );
  }

  if (compactPrompt.length > maxPromptChars) {
    // 2. Priority split: preserve Debug feedback + Current Code at the bottom, trimming spec filler from the middle
    const splitMarker = compactPrompt.includes('## CRITICAL: PREVIOUS SUBMISSION FAILED')
      ? '## CRITICAL: PREVIOUS SUBMISSION FAILED'
      : (compactPrompt.includes('=== PREVIOUS ATTEMPT') ? '=== PREVIOUS ATTEMPT' : '');

    if (splitMarker) {
      const idx = compactPrompt.indexOf(splitMarker);
      const specPart = compactPrompt.slice(0, idx);
      let debugPart = compactPrompt.slice(idx);

      const debugBudget = Math.floor(maxPromptChars * 0.65);
      const specBudget = maxPromptChars - Math.min(debugPart.length, debugBudget) - 20;

      if (debugPart.length > debugBudget) {
        // Keep itemized failures header (top) + current workspace code (bottom)
        const codeMarkerIdx = debugPart.indexOf('=== CURRENT CODE OF ALL WORKSPACE FILES');
        if (codeMarkerIdx > 0) {
          const topFailures = debugPart.slice(0, Math.min(codeMarkerIdx, Math.floor(debugBudget * 0.48)));
          const codeBottom = debugPart.slice(codeMarkerIdx);
          const remForCode = debugBudget - topFailures.length - 12;
          debugPart = topFailures + '\n...\n' + codeBottom.slice(0, Math.max(800, remForCode));
        } else {
          debugPart = debugPart.slice(0, debugBudget);
        }
      }

      const trimmedSpec = specPart.length > specBudget
        ? specPart.slice(0, Math.max(900, specBudget - 8)) + '\n...'
        : specPart;

      compactPrompt = trimmedSpec + '\n\n' + debugPart;
    } else {
      compactPrompt = compactPrompt.slice(0, maxPromptChars);
    }
  }

  const estInputTokens = Math.ceil((sys.length + compactPrompt.length) / 3.0);
  const safeMaxTokens = Math.max(2800, Math.min(4600, Math.max(desiredMaxTokens, reservedOutputTokens), tpmLimit - estInputTokens - 300));
  return { sys, compactPrompt, safeMaxTokens };
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
    if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 3000) {
      break;
    }
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
                  messages: [
                    { role: 'system', content: compact4K.sys },
                    { role: 'user', content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 16384,
                  reasoning_effort: 'high'
                },
                {
                  model,
                  messages: [
                    { role: 'system', content: compact4K.sys },
                    { role: 'user', content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 6144,
                  reasoning_effort: 'medium'
                },
                {
                  model,
                  messages: [
                    { role: 'system', content: compact4K.sys },
                    { role: 'user', content: prompt }
                  ],
                  temperature: 0.1,
                  max_tokens: 6144,
                  reasoning_effort: 'low'
                }
              ]
            : []),
          {
            model,
            messages: [
              { role: 'system', content: compact4K.sys },
              { role: 'user', content: compact4K.compactPrompt }
            ],
            temperature: 0.1,
            max_tokens: compact4K.safeMaxTokens,
            reasoning_effort: 'low'
          },
          {
            model,
            messages: [
              { role: 'system', content: compact4K.sys },
              { role: 'user', content: compact4K.compactPrompt }
            ],
            temperature: 0.1,
            max_tokens: compact4K.safeMaxTokens
          }
        ]
      : [
          {
            model,
            messages: [
              { role: 'system', content: compact4K.sys },
              { role: 'user', content: estFullInputTokens < 2200 ? prompt : compact4K.compactPrompt }
            ],
            temperature: 0.1,
            max_tokens: Math.min(8192, Math.max(3600, compact4K.safeMaxTokens)),
            reasoning_effort: 'low'
          },
          {
            model,
            messages: [
              { role: 'system', content: compact4K.sys },
              { role: 'user', content: compact4K.compactPrompt }
            ],
            temperature: 0.1,
            max_tokens: compact4K.safeMaxTokens
          }
        ];

    let waited429 = false;
    for (let pi = 0; pi < payloadsToTry.length; pi++) {
      if (settings.deadlineAt && Date.now() >= settings.deadlineAt - 2000) {
        break;
      }
      const payload = payloadsToTry[pi];
      const controller = new AbortController();
      const timeoutMs = payload.reasoning_effort ? 35000 : 28000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
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
                messages: [
                  { role: 'system', content: tight.sys },
                  { role: 'user', content: tight.compactPrompt }
                ],
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
    messages: [
      { role: 'system', content: sysContent },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 8192
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
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
  // Always load stored settings containing saved API keys
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
      if (hasOpenAI) {
        return await callOpenAI(prompt, settings);
      }
      throw aggErr.errors?.[0] || new Error('All parallel AI solvers failed.');
    }
  }

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
