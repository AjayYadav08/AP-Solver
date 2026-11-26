// utils/prompts.js - System instructions, context-gated prompt assembly & priority-preserving TPM compaction

export const SYSTEM_PROMPT = `You are a Senior Full-Stack Software Engineer and competitive programming expert.
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

/** Assemble deduplicated prompt containing specs, installed package contract, test files, current code & debug feedback. */
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

  const feedbackEmbeddedFiles = new Set();
  if (feedback) {
    for (const m of String(feedback).matchAll(/### File:\s*`([^`]+)`/g)) {
      if (m[1]) feedbackEmbeddedFiles.add(m[1].trim());
    }
  }

  if (referenceFiles && Object.keys(referenceFiles).length > 0) {
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

    const testEntries = [];
    const starterEntries = [];
    for (const [fname, content] of Object.entries(referenceFiles)) {
      if (!content || feedbackEmbeddedFiles.has(fname)) continue;
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

/** Generate concise context-gated system rules based only on the challenge specification (not stale error text). */
export function getContextGatedSystemPrompt(userPrompt, isDebug = false) {
  const p = String(userPrompt || '');
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

/** Smart priority-preserving compactor for strict Groq TPM quotas (never slices off debug errors or current code). */
export function buildCompactGroqMessages(systemPrompt, userPrompt, desiredMaxTokens = 4096, tpmLimit = 7600) {
  const p = String(userPrompt || '');
  const sys = getContextGatedSystemPrompt(p, /PREVIOUS ATTEMPT|FAILED/i.test(p));

  let compactPrompt = p;
  const reservedOutputTokens = Math.min(4400, Math.max(desiredMaxTokens, Math.floor(tpmLimit * 0.54)));
  const maxPromptChars = Math.min(7600, Math.max(2800, Math.floor((tpmLimit - reservedOutputTokens - 350) * 3.0) - sys.length));

  if (compactPrompt.length > maxPromptChars) {
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
