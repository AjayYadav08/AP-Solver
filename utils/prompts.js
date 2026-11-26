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
     * Set 'Content-Type: text/html; charset=utf-8' when serving HTML pages, or 'Content-Type: application/json; charset=utf-8' for JSON APIs.
     * Follow exact problem routes and port (use process.env.PORT || <env_or_spec_port>); ALWAYS create separate files for every required HTML/static asset when requested.
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
   - For JWT Authentication & Token Challenges:
     * SPEC FIRST: ALWAYS follow the CURRENT PROBLEM SPECIFICATION, GRADING TESTS, and STARTER CODE verbatim (secret env/variable name like 'JWT_SECRET' vs 'SECRET', login field 'email' vs 'username', token payload '{ email: user.email }' vs '{ userId }', expiry '1h' vs '15m', status codes 400/401/403, exact JSON response keys/messages, and protected route path & response body).
     * PRESERVE BOILERPLATE & RELATIVE PATHS: Keep pre-implemented working routes in starter code (such as an existing '/register' route) intact unless tests explicitly fail on them, and preserve exact relative 'require(...)' paths (e.g. 'require("./middleware/validate")').
     * Generic JWT Rules (apply when not overridden by specific starter/test assertions):
       - Reject missing or malformed 'Authorization: Bearer <token>' headers with 401 and invalid/expired tokens with the exact status specified by the problem (401 or 403).
       - Verify token with 'jwt.verify(...)', attach decoded payload to 'req.user', and call 'next()'.
       - NEVER expose password/hash in responses and preserve all expected module exports.
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
  feedback = null,
  filePlan = null,
  attemptNumber = 1,
  terminalPreAnalysis = null,
  collaborationHistory = ''
}) {
  const parts = [];
  parts.push(`# PROBLEM: ${questionTitle || 'Coding Challenge'}`);

  const stageDirectives = {
    1: 'STAGE 1/5 (Initial Analysis & Solution): Thoroughly read every constraint, I/O format, example & terminal workflow requirement BEFORE writing code. Output the cleanest complete solution.',
    2: 'STAGE 2/5 (Error-Driven Fix): Analyze Attempt 1 exact terminal errors & failure category. Fix the proven root causes without guessing randomly.',
    3: 'STAGE 3/5 (Multi-AI Collaborator — Full History Synthesis): You have the ENTIRE history of Attempts 1–2 (original question, all prior submitted code, terminal errors & commands). Identify recurring mistakes across attempts and fix them systematically.',
    4: 'STAGE 4/5 (Deep Edge-Case & Boundary Audit): Scrutinize every subtle edge case, async error path, input/output shape, rounding rule, status code, and post-write execution command across Attempts 1–3.',
    5: 'STAGE 5/5 (Final High-Reliability Synthesis): Produce the highest-confidence solution integrating all evidence from Attempts 1–4. Double-check every test case requirement.'
  };
  parts.push(`## 🧠 PROBLEM-SOLVING STAGE: Attempt ${attemptNumber}/5\n${stageDirectives[Math.min(Math.max(attemptNumber || 1, 1), 5)]}`);

  if (terminalPreAnalysis) {
    const cmdsText = (terminalPreAnalysis.requiredPostCommands && terminalPreAnalysis.requiredPostCommands.length > 0)
      ? `YES — Post-write terminal commands detected: ${terminalPreAnalysis.requiredPostCommands.join(' && ')}`
      : (terminalPreAnalysis.requiresPostWriteCommands
          ? `MAYBE — ${terminalPreAnalysis.commandReasons?.join('; ') || 'Check build/migration commands cleanly.'}`
          : 'NO additional compilation/migration command detected beyond clean disk writes.');
    const termLines = [
      `- Execution / Pre-Submit Command Requirement: ${cmdsText}`,
      ...(terminalPreAnalysis.commandReasons || []).map(r => `- Note: ${r}`),
      ...(terminalPreAnalysis.submissionNotes || []).map(n => `- Submission Workflow: ${n}`),
      terminalPreAnalysis.hasPriorTerminalErrors
        ? `- ⚠️ Existing Error Observed in Terminal BEFORE Coding [${terminalPreAnalysis.preErrorCategory}]:\n\`\`\`\n${terminalPreAnalysis.preErrorSummary}\n\`\`\``
        : '- Initial Terminal State: Clean (no pre-existing build error trace).'
    ];
    parts.push(`## 🖥️ PRE-CODING TERMINAL & WORKFLOW ANALYSIS:\n${termLines.join('\n')}`);
  }

  if (activeFile) {
    parts.push(`## Target Active File in Editor: \`${activeFile}\``);
  }

  if (filePlan && Array.isArray(filePlan.targets) && filePlan.targets.length > 0) {
    const planLines = filePlan.targets.map(t =>
      `- [${t.mode === 'edit' ? 'MODIFY EXISTING' : 'CREATE NEW'}] \`${t.filePath}\` — ${t.reason}`
    );
    const protLine = (filePlan.protectedFiles && filePlan.protectedFiles.length > 0)
      ? `\n- PROTECTED (DO NOT OVERWRITE): ${filePlan.protectedFiles.join(', ')}`
      : '';
    parts.push(
      `## 🔒 LOCKED FILE MODIFICATION PLAN (${filePlan.architectureSummary || 'Verified Pre-Analysis'}):\n` +
      `You MUST edit/create ONLY the exact approved paths below in-place. NEVER invent duplicate/alternative files outside this list:\n` +
      planLines.join('\n') + protLine
    );
  }

  if (workspaceFiles && workspaceFiles.length > 0) {
    const rootIdx = referenceFiles?.['index.js'] || '';
    const isRootLoaderOnly = workspaceFiles.includes('index.js') && workspaceFiles.includes('src/index.js') &&
      (!rootIdx || (rootIdx.trim().length < 140 && /src\/index/i.test(rootIdx)));
    const fileLines = workspaceFiles.map(f => {
      if (f === 'index.js' && isRootLoaderOnly) {
        return `- ${f} [EXISTING ROOT LOADER for src/index.js — DO NOT overwrite, duplicate, or re-emit!]`;
      }
      if (f === activeFile) return `- ${f} [PRIMARY FILE TO EDIT IN-PLACE]`;
      return `- ${f} [EXISTING]`;
    });
    parts.push(
      `## Project Workspace Files (STRICT LOCATION LOCK — ZERO DUPLICATES):\n` +
      fileLines.join('\n') + `\n` +
      `- RULE: Always edit EXISTING files at their exact path above. NEVER create a duplicate sibling (e.g. if \`src/index.js\` exists, do NOT create another \`index.js\`; if \`src/middleware/validate.js\` exists, do NOT create \`src/validate.js\`). Only create missing files in the exact required folder.`
    );
  }

  const feedbackEmbeddedFiles = new Set();
  if (collaborationHistory && !String(feedback || '').includes('COMPLETE CHRONOLOGICAL ATTEMPT HISTORY')) {
    parts.push(
      `## 🤝 COMPLETE CHRONOLOGICAL ATTEMPT HISTORY (AI-TO-AI COLLABORATION):\n` +
      `Analyze every prior attempt below alongside the original question above before coding:\n\n` +
      collaborationHistory
    );
  }

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
        const mainStr = pkg.main ? `\n- **Entry Point (` + '`package.json` main)**: `' + pkg.main + '`' : '';
        parts.push(`## 📦 INSTALLED PACKAGES & SCRIPTS (\`package.json\` — STRICT CONTRACT):
- **Module System**: ${moduleType}
- **Installed Dependencies**: ${deps.length > 0 ? deps.join(', ') : 'None listed'}
- **Dev Dependencies**: ${devDeps.length > 0 ? devDeps.join(', ') : 'None listed'}${mainStr}
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
    if (compactDetails.length > 16000) {
      compactDetails = compactDetails.slice(0, 11000) + '\n...\n' + compactDetails.slice(-4500);
    }
    parts.push(`## Problem Description & Requirements:\n${compactDetails}`);
  }

  if (testCases && testCases.length > 0) {
    parts.push(`## Test Cases to Pass (All Must Pass):\n${testCases.map((tc, i) => `${i + 1}. ${tc}`).join('\n')}`);
  }

  const refKeys = Object.keys(referenceFiles || {});
  const activeAlreadyIncluded =
    feedbackEmbeddedFiles.has(activeFile) ||
    [...feedbackEmbeddedFiles].some(f => f.endsWith('/' + activeFile) || activeFile.endsWith('/' + f)) ||
    (!feedback && refKeys.some(k => referenceFiles[k] && (k === activeFile || k.endsWith('/' + activeFile) || activeFile.endsWith('/' + k))));
  if (currentCode && !activeAlreadyIncluded) {
    const codeHeader = feedback
      ? `## Previous Attempt Solution Code in \`${activeFile}\` (${language}):`
      : `## Current Starter Code in \`${activeFile}\` (${language}):`;
    parts.push(`${codeHeader}\n\`\`\`${language}\n${currentCode}\n\`\`\``);
  }

  const feedbackHasFullHistory = String(feedback || '').includes('COMPLETE CHRONOLOGICAL ATTEMPT HISTORY');
  if (collaborationHistory && !feedbackHasFullHistory) {
    parts.push(
      `## 🤝 COMPLETE CHRONOLOGICAL ATTEMPT HISTORY (ALL PREVIOUS ATTEMPTS 1..${Math.max(1, (attemptNumber || 1) - 1)}):\n` +
      `Review EVERY previous attempt's complete code and exact error messages below before writing a single line of code:\n\n` +
      collaborationHistory
    );
  }

  if (feedback) {
    parts.push(`## CRITICAL: PREVIOUS SUBMISSION FAILED — ONE-SHOT SIMULTANEOUS ERROR RESOLUTION REQUIRED
Previous submission(s) failed verification. Review the complete original problem above, EVERY previous attempt's complete code & errors, and the itemized diagnosis below carefully before writing the corrected solution.

${feedback}

### MANDATORY CUMULATIVE CORRECTION & SUBMISSION REQUIREMENTS (ATTEMPT ${attemptNumber}/5):
1. ROOT-CAUSE AUDIT ACROSS ALL ATTEMPTS: Identify why EVERY previous attempt (Attempts 1..${Math.max(1, (attemptNumber || 2) - 1)}) failed, locate recurring mistakes, and explicitly change what broke rather than repeating failed code.
2. SIMULTANEOUS FIX: Resolve EVERY single failing test case simultaneously in this output. Do NOT cherry-pick or leave partial edge cases broken.
3. EXACT CONTRACT COMPLIANCE: Match exact HTTP status codes (200, 201, 400, 401, 403, 404, 409), exact JSON property names/messages, exact exported function signatures, and database/environment configuration.
4. ZERO HANGS OR UNHANDLED REJECTIONS: Wrap async handlers in try/catch and guarantee every code path sends a complete response or properly exits/disconnects.
5. TERMINAL COMMANDS IF NEEDED: If build/compile/Prisma/seed/install commands must execute in terminal after writing files, include a separate \`\`\`bash // __commands__\`\`\` block.
6. COMPLETE EXECUTABLE OUTPUT: Output complete, runnable replacement code for EVERY modified/required file with \`// <filepath>\` on Line 1 (or \`<!-- <filepath> -->\` for HTML) and ZERO comments inside code.`);
  }

  const isPrismaTask = /prisma|schema\.prisma|seed\.js|one-to-one/i.test((questionTitle || '') + ' ' + (questionDetails || ''));
  if (isPrismaTask) {
    parts.push(`## MANDATORY PRISMA MULTI-FILE REQUIREMENTS:
This challenge REQUIRES complete Prisma + Node files in separate markdown code blocks derived strictly from the Problem Description above:
1. \`// prisma/schema.prisma\`: Define \`datasource db { provider = "postgresql" url = env("DATABASE_URL") }\`, \`generator client { provider = "prisma-client-js" }\`, and ALL models, field types, relations, and unique/FK attributes required by THIS question.
2. \`// src/seed.js\`: Instantiate \`new PrismaClient()\`, delete child records before parent records (e.g. \`deleteMany()\`) cleanly, insert ALL exact seed records required by THIS question, handle errors with \`process.exit(1)\`, and ALWAYS close with \`await prisma.$disconnect()\` in \`finally\`.
3. \`// src/index.js\`: Implement all required Express endpoints cleanly, export \`app\`, and start listening cleanly unless guarded by \`NODE_ENV !== 'test'\`.
4. \`\`\`bash // __commands__\`\`\`: Include \`npx prisma db push --skip-generate\`, \`npx prisma generate\`, and \`node src/seed.js\` when schema/seeding changed.
DO NOT OMIT \`prisma/schema.prisma\`!`);
  }

  parts.push(`## Operational Process Guidelines:
1. GIVE FULL QUESTION AND INITIAL CODE: Carefully inspect ALL tasks (Task 1, Task 2, Task 3, etc.), response JSON schemas, status codes, and starter files above.
2. EXACT FILE PATHS REQUIRED: Look at Project Workspace Files above and preserve EVERY exact nested relative path (e.g. \`// src/middleware/validate.js\`, \`// src/routes/auth.js\`, \`// src/index.js\`). NEVER strip parent folders like \`middleware/\` or invent a second copy \`src/validate.js\`.
3. WRITE COMPLETE CODE WITHOUT BREAKING EXISTING WORKING ROUTES: Preserve pre-implemented boilerplate routes (like existing \`/register\`) and exact \`require(...)\` paths (like \`require('./middleware/validate')\`). When specification defines an exact JSON payload (e.g. \`{ "message": "..." }\` or \`{ "token": ... }\` or \`{ "message": "...", "user": ... }\`), match those exact keys without adding unrequested extra fields.
4. ONE CODE BLOCK PER FILE: Output each modified/created file in its own distinct markdown code block with its exact workspace file path on Line 1 (e.g. \`// src/middleware/validate.js\`).
5. NO GENERIC LABELS OR COMMENTS: Never use "File 1", "1.js", conversational text, or comments inside code.`);

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
  const needsStaticHtml = /\.html?\b|create a .*folder|serving .*page|text\/html|sendFile/i.test(specSection);
  const hasRootIndex = /-\s*index\.js\b/i.test(specSection) && /-\s*src\/index\.js\b/i.test(specSection);

  const lines = [
    'You are a Senior Full-Stack Software Engineer. Write complete, bug-free, test-compliant solutions.',
    'RULES: Follow every requirement in Problem Description & Grading Test Files verbatim (every Task 1/2/3, exact status codes, exact JSON keys & messages).',
    'STRICT FILE LOCATION LOCK (ZERO DUPLICATES): Edit EXISTING files ONLY at their exact path listed in Project Workspace Files (e.g. // src/index.js or // src/middleware/validate.js). NEVER duplicate a file outside its folder (never invent root index.js when src/index.js is the app, never invent src/validate.js when src/middleware/validate.js exists), and DO NOT re-emit untouched bootstrapper/config files unless fixing a bug in them.',
    'OUTPUT ONLY REQUIRED NEW/EDITED FILES: If the problem explicitly asks to create new files/folders (e.g. HTML pages or modules), output them in their exact required path matching your code imports/reads. NEVER invent unrequested extra files.',
    'PORT & ENTRYPOINT: Inspect .env and root index.js vs src/index.js! Always load dotenv if installed or read process.env.PORT (so .env PORT=3000 works cleanly even if prompt prose uses an example port like 8080). Preserve starter wiring cleanly.',
    'NEVER invent uninstalled packages; strictly use packages in package.json or Node built-ins. Fix JSON SyntaxError with express error handler returning 400. Return res.status(...).json(...) on every branch so requests never hang or timeout.',
    'Output ONLY clean executable code (NO comments, NO explanations, NO "... rest of code") in markdown fenced code block(s) with exact workspace file path on line 1 (for HTML use <!-- path/file.html --> or // path/file.html).',
    'If setup/migration/build/seed commands must run in terminal after writing files, add a separate ```bash block starting with // __commands__ and list one shell command per line.',
    '2-space indentation only; no tabs.'
  ];
  if (needsPrisma) lines.push('PRISMA: Output prisma/schema.prisma, src/seed.js (deleteMany child-then-parent, await prisma.$disconnect() in finally), and src/index.js cleanly.');
  if (needsNativeHttp) lines.push('NODE HTTP: Set appropriate Content-Type (application/json or text/html); parse JSON safely (400 on invalid JSON); export server cleanly (module.exports = server; module.exports.server = server;). Return 404 on unknown routes.');
  if (needsStaticHtml) lines.push('STATIC HTML ROUTING: Output a separate code block for EVERY required .html file (matching the paths your server reads via fs.readFile/path.join(__dirname, ...)), set Content-Type text/html, return HTTP 404 for unknown routes, and ensure the server listens on process.env.PORT || <port from .env or 8080/3000> (do NOT skip listen() with NODE_ENV !== "test" when external HTTP tests connect directly to localhost:PORT unless starter already guards it for supertest).');
  if (hasRootIndex) lines.push('DUAL ENTRYPOINT (index.js + src/index.js): Leave untouched starter root index.js wrapper alone unless broken; put your full application implementation inside src/index.js ONLY without duplicating it at root!');
  if (needsJwt) lines.push('JWT: Follow exact secret (e.g. JWT_SECRET/SECRET), payload fields (e.g. { email } vs { userId }), expiry (1h vs 15m), auth error status codes (401/403), and protected route response specified by THIS problem & tests.');
  if (needsExpressAuth) lines.push('EXPRESS AUTH: Validate inputs strictly (400), check duplicate records via findFirst/findUnique before create, hash password with installed bcrypt/bcryptjs, omit password from JSON response.');
  if (isDebug || /PREVIOUS ATTEMPT|FAILED/i.test(p)) lines.push('DEBUG & AI COLLABORATION: Analyze the complete chronological attempt history (submitted code, categorized errors, commands executed & diffs). Never repeat a previously failed approach; produce an evidence-based fix resolving EVERY failing test simultaneously.');
  return lines.join('\n');
}

/** Shrink oversized markdown sections so high-priority requirements, Tasks & test specs never get blindly sliced off. */
function compactNonDebugPrompt(prompt, maxPromptChars) {
  const sections = prompt.split(/\n\n(?=## |# PROBLEM:)/);
  const shrinkEdge = (sec, limit) => {
    if (sec.length <= limit) return sec;
    const head = Math.max(250, Math.floor(limit * 0.52));
    const tail = Math.max(200, limit - head - 8);
    return sec.slice(0, head) + '\n...\n' + sec.slice(-tail);
  };
  const totalLen = () => sections.join('\n\n').length;

  // Strip narrative Objective/Scenario fluff from Problem Description first before touching Tasks/Testing specs
  for (let i = 0; i < sections.length && totalLen() > maxPromptChars; i++) {
    if (/^## Problem Description & Requirements:/i.test(sections[i])) {
      sections[i] = sections[i].replace(/\b(Objective|Scenario)\n[\s\S]*?(?=\n(?:Project Structure|Your Tasks|Task 1)\b)/i, '');
    }
  }

  // Progressively budget secondary sections to preserve Task 1..N specs & test cases
  const passLimits = [
    { match: /^## Operational Process Guidelines:/, limit: 380 },
    { match: /^## Project Workspace Files/, limit: 800 },
    { match: /^## Current Starter Code/, limit: 900 },
    { match: /^## Initial Workspace Files & Starter Code:/, limit: 1200 },
    { match: /^## EXACT GRADING TEST SUITE FILES/, limit: Math.max(1100, Math.floor(maxPromptChars * 0.28)) },
    { match: /^## Problem Description & Requirements:/, limit: Math.max(1500, Math.floor(maxPromptChars * 0.40)) }
  ];
  for (const { match, limit } of passLimits) {
    if (totalLen() <= maxPromptChars) break;
    for (let i = 0; i < sections.length; i++) {
      if (match.test(sections[i]) && sections[i].length > limit) {
        sections[i] = shrinkEdge(sections[i], limit);
      }
    }
  }
  const joined = sections.join('\n\n');
  if (joined.length <= maxPromptChars) return joined;
  return shrinkEdge(joined, maxPromptChars);
}

/** Smart priority-preserving compactor for strict Groq TPM quotas (never slices off debug errors, current code, or Task specs). */
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
        const collabMarkerIdx = debugPart.indexOf('COMPLETE CHRONOLOGICAL ATTEMPT HISTORY');
        if (codeMarkerIdx > 0) {
          const histLimit = Math.floor(debugBudget * 0.56);
          const topFailures = debugPart.slice(0, Math.min(codeMarkerIdx, histLimit));
          const codeBottom = debugPart.slice(codeMarkerIdx);
          const remForCode = debugBudget - topFailures.length - 12;
          debugPart = topFailures + '\n...\n' + codeBottom.slice(0, Math.max(800, remForCode));
        } else if (collabMarkerIdx > 0) {
          debugPart = debugPart.slice(0, debugBudget);
        } else {
          debugPart = debugPart.slice(0, debugBudget);
        }
      }

      const trimmedSpec = specPart.length > specBudget
        ? compactNonDebugPrompt(specPart, Math.max(900, specBudget - 8))
        : specPart;

      compactPrompt = trimmedSpec + '\n\n' + debugPart;
    } else {
      compactPrompt = compactNonDebugPrompt(compactPrompt, maxPromptChars);
    }
  }

  const estInputTokens = Math.ceil((sys.length + compactPrompt.length) / 3.0);
  const safeMaxTokens = Math.max(2800, Math.min(4600, Math.max(desiredMaxTokens, reservedOutputTokens), tpmLimit - estInputTokens - 300));
  return { sys, compactPrompt, safeMaxTokens };
}
