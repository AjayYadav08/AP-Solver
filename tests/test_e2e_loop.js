// tests/test_e2e_loop.js - True end-to-end 5-attempt cumulative correction loop, local runner & terminal verification test
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { readRepoFile, assert, installChromeMock } from './helpers.js';
import {
  analyzeFileModificationPlan,
  enforceFilePlan,
  analyzePreCodingTerminal,
  summarizeCodeChanges,
  buildAttemptRecord,
  formatFullCollaborationHistory,
  saveQuestionAttemptHistory,
  loadQuestionAttemptHistory,
  buildLocalTestSpec,
  buildBase64TerminalScript,
  generateSolution
} from '../utils/llm.js';
import { buildLocalTestRunnerScript } from '../background/workspace.js';

/** Execute generated local test runner inside an isolated temp directory and decode GZ telemetry. */
function execLocalRunner(filesMap, spec) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-e2e-'));
  try {
    for (const [rel, content] of Object.entries(filesMap)) {
      const full = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    const script = buildLocalTestRunnerScript(Object.keys(filesMap), spec);
    const res = spawnSync('node', ['-e', script], { cwd: tmpDir, encoding: 'utf8', timeout: 15000 });
    const raw = (res.stdout || '') + '\n' + (res.stderr || '');
    const m = raw.match(/===AP_LTEST_START===\s*GZ:([A-Za-z0-9+/=\s]+?)\s*===AP_LTEST_END===/);
    assert(Boolean(m), 'Local test runner failed to emit payload:\n' + raw);
    return JSON.parse(zlib.gunzipSync(Buffer.from(m[1].replace(/\s+/g, ''), 'base64')).toString('utf8'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function runE2ELoopTests() {
  console.log('🔁 [Suite 4/4] Running End-to-End 5-Attempt Cumulative Loop & Local Runner tests...');
  installChromeMock();
  const memStore = {};
  globalThis.chrome.storage = {
    local: {
      get: async (keys) => {
        if (!keys) return { ...memStore };
        const arr = Array.isArray(keys) ? keys : [keys];
        const res = {};
        for (const k of arr) if (k in memStore) res[k] = memStore[k];
        return res;
      },
      set: async (obj) => { Object.assign(memStore, obj); }
    }
  };

  const questionTitle = 'Login API with Protected Middleware';
  const questionDetails = [
    'Implement POST /login endpoint in src/index.js: Receive email and password from body. If either is missing, return a 400 status.',
    'Implement GET /protected using src/middleware/validate.js authenticateToken middleware: reject missing Authorization token with 401.',
    'Undefined routes must return 404. Run `npm run build` after changes if needed.'
  ].join('\n');
  const pkgStr = JSON.stringify({ main: 'src/index.js', scripts: { test: 'mocha __tests__' }, dependencies: {} });
  const workspaceFiles = ['package.json', 'src/index.js', 'src/middleware/validate.js'];

  // 1. Pre-coding file plan & terminal workflow analysis
  const filePlan = analyzeFileModificationPlan({
    questionTitle,
    questionDetails,
    activeFile: 'src/index.js',
    workspaceFiles,
    referenceFiles: {
      'package.json': pkgStr,
      'src/index.js': 'const http = require("http");\nconst auth = require("./middleware/validate");\n',
      'src/middleware/validate.js': 'function authenticateToken(req, res, next) { next(); }\nmodule.exports = { authenticateToken };'
    }
  });
  assert(
    filePlan.allowedPaths.includes('src/index.js') && filePlan.allowedPaths.includes('src/middleware/validate.js'),
    'E2E file plan missing required targets: ' + JSON.stringify(filePlan.allowedPaths)
  );

  const preTerm = analyzePreCodingTerminal({
    questionDetails,
    packageJsonStr: pkgStr,
    detectedPostCommands: ['npm run build']
  });
  assert(preTerm.requiredPostCommands.includes('npm run build'), 'E2E terminal analysis missed required post command');

  const bashCmd = buildBase64TerminalScript([{ filePath: 'src/index.js', code: 'console.log(1);' }], ['npm run build']);
  assert(bashCmd.includes('cd /app/code') && bashCmd.includes('git rev-parse --show-toplevel'), 'Terminal script missing root directory anchor');

  const localSpec = buildLocalTestSpec({
    questionTitle,
    questionDetails,
    testCases: ['POST /login missing credentials returns 400', 'GET /protected returns 401 without token'],
    filesToWrite: ['src/index.js', 'src/middleware/validate.js'],
    packageJsonStr: pkgStr
  });

  // 2. Simulate full 5-attempt loop with realistic large code per attempt & verify cumulative prompts
  const parserSrc = readRepoFile('content/error-parser.js');
  const dStart = parserSrc.indexOf('  function diagnoseErrorMessage(');
  const tailStart = parserSrc.indexOf('  Object.assign(AP,');
  const runErrTools = new Function(
    'terminalOutput',
    'subRes',
    'attemptLabel',
    'ctx',
    `${parserSrc.slice(dStart, tailStart)}\nreturn { parsed: parseAndStructureFailures(terminalOutput, subRes), feedbackPromise: buildDebugFeedback(terminalOutput, subRes, attemptLabel, ctx) };`
  );

  const capturedPrompts = [];
  const makeAttemptCode = (attemptIdx) => {
    const padComment = `const markerAttempt${attemptIdx} = "${'x'.repeat(1200)}_END_${attemptIdx}";`;
    if (attemptIdx < 5) {
      return {
        idx: `const http = require('http');\nconst { authenticateToken } = require('./middleware/validate');\n${padComment}\nconst srv = http.createServer((req, res) => {\n  if (req.url === '/login') { res.writeHead(${attemptIdx === 1 ? 200 : 404}, {'Content-Type':'application/json'}); return res.end('{}'); }\n  if (req.url === '/protected') return authenticateToken(req, res, () => { res.writeHead(200); res.end('ok'); });\n  res.writeHead(404); res.end('not found');\n});\nsrv.listen(3000);`,
        mw: `function authenticateToken(req, res, next) {\n  const markerMw${attemptIdx} = "${'m'.repeat(450)}_${attemptIdx}";\n  return next();\n}\nmodule.exports = { authenticateToken };`
      };
    }
    return {
      idx: `const http = require('http');\nconst { authenticateToken } = require('./middleware/validate');\nconst srv = http.createServer((req, res) => {\n  if (req.url === '/login' && req.method === 'POST') {\n    let raw = '';\n    req.on('data', c => raw += c);\n    req.on('end', () => {\n      try {\n        const b = JSON.parse(raw || '{}');\n        if (!b.email || !b.password) { res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ message: 'Email and password are required' })); }\n        res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ token: 'tok' }));\n      } catch (e) {\n        res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ error: 'Invalid JSON' }));\n      }\n    });\n    return;\n  }\n  if (req.url === '/protected' && req.method === 'GET') return authenticateToken(req, res, () => { res.writeHead(200); res.end('ok'); });\n  res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'Not found' }));\n});\nif (process.env.NODE_ENV !== 'test') srv.listen(process.env.PORT || 3000);\nmodule.exports = { server: srv };`,
      mw: `function authenticateToken(req, res, next) {\n  const h = req.headers && req.headers.authorization;\n  if (!h || !h.startsWith('Bearer ')) { res.writeHead(401, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ message: 'Unauthorized' })); }\n  return next();\n}\nmodule.exports = { authenticateToken };`
    };
  };

  const origFetch = globalThis.fetch;
  let synthIdx = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const userText = body.contents ? body.contents[0].parts[0].text : body.messages.map(m => m.content).join('\n');
      capturedPrompts.push({ attempt: synthIdx + 1, text: userText });
      synthIdx++;
      const c = makeAttemptCode(synthIdx);
      const reply = [
        '```javascript', '// src/index.js', c.idx, '```',
        '```javascript', '// src/middleware/validate.js', c.mw, '```'
      ].join('\n');
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] }) };
    };

    const records = [];
    // Simulate a local pre-fix check BEFORE Attempt 1 to ensure local entries never evict remote attempts 1..5
    const localPreRec = buildAttemptRecord({
      attemptNumber: 1,
      stage: 'local-1.1',
      questionTitle,
      submittedFiles: [{ filePath: 'src/index.js', code: 'const localBrokenBeforeSubmit = true;' }],
      terminalOutput: 'Local HTTP 400 failed',
      subRes: { passed: 1, total: 3, failedTests: ['POST /login with empty body'] },
      localTestResult: { strategy: 'http_routes', status: 'failed', passed: 1, failed: 1, executedCommands: ['node --check src/index.js'], cases: [] }
    });
    records.push(localPreRec);

    let feedback = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
      const gen = await generateSolution({
        questionTitle,
        questionDetails,
        testCases: ['POST /login 400 on missing fields', 'GET /protected 401 without token'],
        activeFile: 'src/index.js',
        workspaceFiles,
        referenceFiles: { 'package.json': pkgStr },
        filePlan,
        terminalPreAnalysis: preTerm,
        attemptNumber: attempt,
        attemptRecords: records,
        feedback
      }, { provider: 'gemini', geminiKey: 'test-key' });

      const enforced = enforceFilePlan(gen.files, filePlan);
      assert(enforced.files.length === 2, `Attempt ${attempt} should keep both canonical files`);

      const filesMap = { 'package.json': pkgStr };
      for (const f of enforced.files) filesMap[f.filePath] = f.code;

      const localRun = execLocalRunner(filesMap, localSpec);
      if (attempt === 1) {
        // Attempt 1 local check must catch actual broken POST /login 200 & GET /protected 200
        assert(localRun.exitCode === 1 && localRun.failed >= 2, 'Local component failed to catch broken Attempt 1 routes: ' + JSON.stringify(localRun));
      }

      if (attempt < 5) {
        const errTrace = [
          `  1) POST /login missing credentials:`,
          `     AssertionError: expected ${attempt === 1 ? 200 : 404} to equal 400 (ATTEMPT_${attempt}_UNIQUE_ERR_${attempt * 111})`,
          `  2) GET /protected without token:`,
          `     AssertionError: expected 200 to equal 401 (AUTH_ERR_ATTEMPT_${attempt})`
        ].join('\n');
        const subRes = {
          passed: 0,
          total: 2,
          failedTests: [`POST /login missing fields (A${attempt})`, `GET /protected without token (A${attempt})`],
          tests: [
            { name: `1. POST /login missing fields (A${attempt})`, pass: false, fail: true, error: `ATTEMPT_${attempt}_UNIQUE_ERR_${attempt * 111}` },
            { name: `2. GET /protected without token (A${attempt})`, pass: false, fail: true, error: `AUTH_ERR_ATTEMPT_${attempt}` }
          ]
        };

        if (records.length > 0) {
          records[records.length - 1].whatChangedNext = summarizeCodeChanges(records[records.length - 1].submittedFiles, enforced.files);
        }
        records.push(buildAttemptRecord({
          attemptNumber: attempt,
          stage: 'remote',
          questionTitle,
          submittedFiles: enforced.files,
          terminalOutput: errTrace,
          subRes,
          commandsExecuted: ['npm run build'],
          localTestResult: localRun,
          whatWentWrong: `Attempt ${attempt} failed status assertions`
        }));
        await saveQuestionAttemptHistory('ap_attempt_history_v1:e2e_login', {
          questionTitle,
          originalQuestion: questionDetails,
          solved: false,
          attempts: records
        });
        const collab = formatFullCollaborationHistory(records, { maxTotalChars: 90000 });
        const errOut = runErrTools(errTrace, subRes, String(attempt), {
          collaborationHistory: collab,
          commandsExecuted: ['npm run build'],
          cachedGeneratedFiles: enforced.files
        });
        assert(errOut.parsed.length >= 2, `Error parser failed on Attempt ${attempt}`);
        feedback = await errOut.feedbackPromise;
      } else {
        // Attempt 5 passes real local HTTP & export execution cleanly!
        assert(
          localRun.exitCode === 0 && localRun.failed === 0 && localRun.passed >= 4,
          'Attempt 5 real Node HTTP verification failed: ' + JSON.stringify(localRun)
        );
      }
    }

    // 3. Assert Attempt 2, 3, 4, 5 prompts cumulatively include Original Question + COMPLETE code & errors of ALL previous attempts
    assert(capturedPrompts.length === 5, `Must execute exactly 5 attempts, got ${capturedPrompts.length}`);

    for (let targetAttempt = 2; targetAttempt <= 5; targetAttempt++) {
      const promptText = capturedPrompts[targetAttempt - 1].text;
      assert(promptText.includes('Implement POST /login endpoint in src/index.js'), `Attempt ${targetAttempt} missing original question`);
      for (let prev = 1; prev < targetAttempt; prev++) {
        assert(
          promptText.includes(`markerAttempt${prev} =`) && promptText.includes(`_END_${prev}`),
          `Attempt ${targetAttempt} lost COMPLETE index.js code from Attempt ${prev}`
        );
        assert(
          promptText.includes(`markerMw${prev} =`),
          `Attempt ${targetAttempt} lost COMPLETE middleware code from Attempt ${prev}`
        );
        assert(
          promptText.includes(`ATTEMPT_${prev}_UNIQUE_ERR_${prev * 111}`) && promptText.includes(`AUTH_ERR_ATTEMPT_${prev}`),
          `Attempt ${targetAttempt} lost error message from Attempt ${prev}`
        );
      }
    }

    // 4. Verify persistent storage never evicted remote attempts due to local pre-check record
    const persisted = await loadQuestionAttemptHistory('ap_attempt_history_v1:e2e_login');
    const savedRemoteNums = persisted.attempts.filter(r => r.stage === 'remote').map(r => r.attemptNumber);
    assert(
      savedRemoteNums.join(',') === '1,2,3,4',
      'Persistent history lost remote attempt(s): ' + JSON.stringify(savedRemoteNums)
    );
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('   ✓ Full E2E 5-attempt cumulative correction loop, complete history preservation & live Node verification passed!');
}
