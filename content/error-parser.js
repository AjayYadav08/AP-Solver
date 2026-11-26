// content/error-parser.js - Deep error diagnosis, Mocha/Jest/ANSI/PENDING log parser & debug feedback builder
(() => {
  if (window.top !== window) return;
  if (!/(^|\.)newtonschool\.co$/i.test(location.hostname)) return;

  const AP = (window.__AP = window.__AP || {});

  function diagnoseErrorMessage(errText, title = '', diffText = '') {
    const combined = `${errText || ''} ${diffText || ''}`;
    if (/Cannot find module\s+['"]([^'"]+)['"]/i.test(combined)) {
      const m = combined.match(/Cannot find module\s+['"]([^'"]+)['"]/i);
      return `Missing Dependency: Module "${m[1]}" is NOT installed! Check package.json dependencies (e.g. use 'bcryptjs' instead of 'bcrypt' if listed) and ONLY import installed packages or Node built-ins.`;
    }
    if (/PrismaClientKnownRequestError|P2002|Unique constraint failed/i.test(combined)) {
      return `Prisma Unique Constraint Failure: Query database (findFirst/findUnique) BEFORE calling create(), and return 400/409 if the record already exists.`;
    }
    if (/P2025|Record to .* does not exist|Foreign key constraint/i.test(combined)) {
      return `Prisma Missing Record / FK Error: Verify record exists first (return 404 if null) and confirm relation/deleteMany cascade order.`;
    }
    if (/EADDRINUSE|address already in use/i.test(combined)) {
      return `Port Conflict (EADDRINUSE): Guard server startup with 'if (process.env.NODE_ENV !== "test") { app.listen(...); }' and ensure 'module.exports = app;' is exported cleanly.`;
    }
    if (/expected\s+(\d+)\s+to equal\s+(\d+)/i.test(combined) || /-(\d+)\s*\+(\d+)/.test(combined)) {
      const m = combined.match(/expected\s+(\d+)\s+to equal\s+(\d+)/i) || combined.match(/-(\d+)\s*\+(\d+)/);
      if (m) {
        return `HTTP Status mismatch: Test expects HTTP ${m[2]}, but endpoint returned HTTP ${m[1]}. Return res.status(${m[2]}).json(...) for this condition.`;
      }
      return `HTTP Status code mismatch. Check status code sent in response.`;
    }
    if (/timeout of\s+\d+ms exceeded|Async callback was not invoked/i.test(combined)) {
      return `Unhandled Async Timeout: Request hung. Ensure EVERY branch (if, else, catch) uses 'return res.status(...).json(...)' or 'res.send(...)', and all DB/Prisma operations are awaited.`;
    }
    if (/SyntaxError.*JSON|Unexpected token/i.test(combined)) {
      return `JSON SyntaxError / Parse Failure: Add Express malformed-JSON error handler '(err, req, res, next) => ... return res.status(400)...' and check module syntax vs package.json.`;
    }
    if (/Cannot read propert|is not defined|TypeError|ReferenceError/i.test(combined)) {
      return `Runtime / Type Error: Variable, request body, or Prisma model accessed incorrectly. Check req.body || {}, imports, Prisma model casing, and null guards.`;
    }
    if (/to deeply equal|to have property|toEqual|toMatchObject/i.test(combined) || (diffText && diffText.length > 0)) {
      return `Response Body Mismatch: Returned JSON keys/values differ from assertion. Include { error: msg, message: msg } on error responses unless exact single key is required, and omit password fields cleanly.`;
    }
    const codeMatch = (title || '').match(/(?:return|status|code)\s+(\d{3})|(\d{3})\s+status/i);
    if (codeMatch) {
      const expCode = codeMatch[1] || codeMatch[2];
      return `Status code requirement: Test explicitly expects HTTP ${expCode}. Ensure endpoint returns res.status(${expCode}).json(...) under these conditions.`;
    }
    return 'Verify route handler logic against test assertion.';
  }

  function parseAndStructureFailures(terminalOutput, subRes) {
    const analysisItems = [];
    const seenErrors = new Set();

    if (terminalOutput) {
      const cleanTerm = terminalOutput
        .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r\n?/g, '\n');

      // 1. Mocha failure blocks
      const mochaFailureRegex = /(?:^|\n)\s*(\d+)\)\s+([^\n]+?)(?=\n)([\s\S]*?)(?=(?:\n\s*\d+\)\s+\S|\n\s*(?:\d+\s+failing|\d+\s+passing)|(?![\s\S])))/g;
      let match;
      while ((match = mochaFailureRegex.exec(cleanTerm)) !== null) {
        const num = match[1];
        let title = match[2].replace(/:\s*$/, '').trim();
        const block = match[3].trim();
        if (!block) continue;
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0 || /^\d+\)\s+/.test(lines[0])) continue;

        if (lines.length > 1 && /:\s*$/.test(lines[0]) && !/^(?:AssertionError|TypeError|ReferenceError|SyntaxError|Error:|PrismaClient|at\s+)/i.test(lines[0])) {
          title = `${title} › ${lines.shift().replace(/:\s*$/, '').trim()}`;
        }

        const errLine = lines.find(l => /AssertionError|TypeError|ReferenceError|SyntaxError|PrismaClient|Cannot find module|Error:|timeout of|expected\s+/i.test(l)) || lines[0] || 'Assertion Failure';
        const diffLines = lines.filter(l => /^[+-]\s|expected\s+|actual\s+|to equal|to deeply equal/i.test(l));
        const diffText = diffLines.slice(0, 4).join('\n');
        const stackLine = lines.find(l => /^at\s+.+\((.+:\d+:\d+)\)/.test(l) || /^at\s+.+:\d+:\d+/.test(l)) || '';

        seenErrors.add(title.toLowerCase());
        analysisItems.push({ num, title, error: errLine, diff: diffText || null, stack: stackLine || null, diagnosis: diagnoseErrorMessage(errLine, title, diffText) });
      }

      // 2. Jest failure blocks
      const jestFailureRegex = /(?:^|\n)\s*●\s+([^\n]+)\n([\s\S]*?)(?=(?:\n\s*●\s+|\n\s*(?:Test Suites:|Ran all test suites)|(?![\s\S])))/g;
      while ((match = jestFailureRegex.exec(cleanTerm)) !== null) {
        const title = match[1].trim();
        const block = match[2].trim();
        const key = title.toLowerCase();
        if (seenErrors.has(key)) continue;
        seenErrors.add(key);

        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        const errLine = lines.find(l => /expect\(|Expected:|Received:|Error:|Cannot find module|TypeError/i.test(l)) || lines[0] || 'Jest Assertion Failure';
        const diffLines = lines.filter(l => /Expected:|Received:|^[+-]\s/i.test(l));
        const diffText = diffLines.slice(0, 4).join('\n');
        const stackLine = lines.find(l => /^at\s+.+:\d+:\d+/.test(l)) || '';

        analysisItems.push({ num: analysisItems.length + 1, title, error: errLine, diff: diffText || null, stack: stackLine || null, diagnosis: diagnoseErrorMessage(errLine, title, diffText) });
      }

      // 3. Fallback line-based error extractor
      if (analysisItems.length === 0) {
        const rawLines = cleanTerm.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < rawLines.length && analysisItems.length < 5; i++) {
          const line = rawLines[i];
          if (/^(?:AssertionError|SyntaxError|ReferenceError|TypeError|RangeError|PrismaClient\w*Error|Error:|Uncaught|FAIL\b|[✕✗×✖]\s+)/i.test(line) ||
              /Cannot find module|EADDRINUSE|ECONNREFUSED|Response timeout|timeout of \d+ms exceeded|expected .+ to |Exit code [1-9]|Command failed/i.test(line)) {
            const snippet = rawLines.slice(i, Math.min(rawLines.length, i + 4)).join(' | ');
            const sig = snippet.slice(0, 120).toLowerCase();
            if (!seenErrors.has(sig)) {
              seenErrors.add(sig);
              const titleGuess = (i > 0 && rawLines[i - 1].length > 4 && rawLines[i - 1].length < 140 && !/^at\s+/.test(rawLines[i - 1]))
                ? rawLines[i - 1].replace(/[:\-]\s*$/, '')
                : 'Runtime / Test Failure';
              analysisItems.push({
                num: analysisItems.length + 1,
                title: titleGuess,
                error: snippet,
                diff: null,
                stack: rawLines.slice(i, Math.min(rawLines.length, i + 8)).find(l => /^at\s+/.test(l)) || null,
                diagnosis: diagnoseErrorMessage(snippet, titleGuess, snippet)
              });
            }
          }
        }
        // 4. Last-resort terminal tail extractor when logs exist without standard error headers
        if (analysisItems.length === 0 && rawLines.length > 0 && subRes && (subRes.passed || 0) < (subRes.total || 1)) {
          const meaningful = rawLines.filter(l => !/^(?:Cloning into|Already up to date|npm notice|npm warn|>|\+)/i.test(l));
          const tailExcerpt = (meaningful.length > 0 ? meaningful : rawLines).slice(-12).join(' | ').slice(0, 500);
          if (tailExcerpt.length > 15) {
            analysisItems.push({ num: 1, title: 'Grader / Container Execution Failure', error: tailExcerpt, diff: null, stack: null, diagnosis: diagnoseErrorMessage(tailExcerpt, '', '') });
          }
        }
      }
    }

    if (subRes?.tests && subRes.tests.length > 0) {
      const hasFailedRun = (subRes.totalCount || subRes.tests.length) > (subRes.passedCount ?? subRes.passed ?? 0);
      const failItems = subRes.tests.filter(t => t.fail || (!t.pass && hasFailedRun));
      for (const fi of failItems) {
        const key = fi.name.toLowerCase();
        if (![...seenErrors].some(k => key.includes(k) || k.includes(key))) {
          let autoDiag = diagnoseErrorMessage(fi.error || '', fi.name, '');
          if (/duplicate|already exists/i.test(fi.name)) autoDiag += ` Query database to check if record already exists before creating.`;
          if (/token|auth|header/i.test(fi.name)) autoDiag += ` Check authorization header validation and JWT verification.`;
          analysisItems.push({ num: analysisItems.length + 1, title: fi.name, error: fi.error || 'Test assertion failed in evaluation', diff: null, stack: null, diagnosis: autoDiag });
        }
      }
    } else if (subRes?.failedTests && subRes.failedTests.length > 0) {
      for (const ft of subRes.failedTests) {
        const key = ft.toLowerCase();
        if (![...seenErrors].some(k => key.includes(k) || k.includes(key))) {
          let autoDiag = diagnoseErrorMessage('', ft, '');
          if (/duplicate|already exists/i.test(ft)) autoDiag += ` Query database to check if record already exists before creating.`;
          analysisItems.push({ num: analysisItems.length + 1, title: ft, error: 'Test assertion failed', diff: null, stack: null, diagnosis: autoDiag });
        }
      }
    }

    return analysisItems;
  }

  // Shared helper: Builds comprehensive debugging prompt from terminal traces, test failures, and current solution files
  async function buildDebugFeedback(terminalOutput, subRes, attemptLabel = '1', ctx = {}) {
    const {
      attemptHistory = [],
      cachedGeneratedFiles = [],
      cachedEditor = null,
      filesWrittenViaTerminal = false,
      sendMsg = null,
      ui = null
    } = ctx;

    const timeStr = subRes?.timestamp || new Date().toLocaleTimeString();
    const failureItems = parseAndStructureFailures(terminalOutput, subRes);

    const feedbackBlocks = [];
    feedbackBlocks.push(`=== PREVIOUS ATTEMPT ${attemptLabel} FAILED (${subRes?.passed || 0}/${subRes?.total || 0} PASSED AT ${timeStr}) ===`);

    if (attemptHistory.length > 0) {
      feedbackBlocks.push(
        `⚠️ PREVIOUS ATTEMPTS HISTORY (DO NOT REPEAT FAILED APPROACHES):\n` +
        attemptHistory.slice(-5).map(h => `- ${h}`).join('\n')
      );
    }

    if (failureItems.length > 0) {
      const seenErrSigs = new Map();
      const compactItems = [];
      for (const item of failureItems) {
        const sig = `${(item.error || '').slice(0, 80)}|${(item.diagnosis || '').slice(0, 80)}`;
        if (seenErrSigs.has(sig)) {
          seenErrSigs.get(sig).alsoTests.push(`#${item.num} "${item.title}"`);
        } else {
          const entry = { ...item, alsoTests: [] };
          seenErrSigs.set(sig, entry);
          compactItems.push(entry);
        }
      }
      const detailedText = compactItems.slice(0, 6).map(item => (
        `🔴 FAILURE #${item.num}: "${item.title}"` +
        (item.alsoTests.length > 0 ? ` (also affects ${item.alsoTests.length} other test(s): ${item.alsoTests.slice(0, 4).join(', ')})` : '') + `\n` +
        `   - Exact Error: ${item.error}\n` +
        (item.diff ? `   - Diff / Assertion: ${item.diff}\n` : '') +
        (item.stack ? `   - Source Location: ${item.stack}\n` : '') +
        `   - Root Cause & Required Fix: ${item.diagnosis}`
      )).join('\n\n');
      const remainingItems = compactItems.slice(6).map(item => `#${item.num} "${item.title}" (${item.error.slice(0, 80)})`);
      feedbackBlocks.push(
        `🚨 COMPLETE ITEMIZED BREAKDOWN OF ALL ${failureItems.length} FAILING TESTS:\n` +
        `You MUST simultaneously fix EVERY SINGLE test failure listed below in one shot. Do NOT leave any test unresolved:\n\n` +
        detailedText +
        (remainingItems.length > 0 ? `\n\n📌 ADDITIONAL FAILING TESTS TO RESOLVE SIMULTANEOUSLY:\n- ${remainingItems.join('\n- ')}` : '')
      );
    } else if (subRes?.tests && subRes.tests.length > 0) {
      const hasFailedRun = (subRes.totalCount || subRes.tests.length) > (subRes.passedCount ?? subRes.passed ?? 0);
      for (const item of subRes.tests.filter(t => t.fail || (!t.pass && hasFailedRun))) {
        feedbackBlocks.push(`FAILED TEST: ${item.name}${item.error ? `\nERROR: ${item.error}` : ''}`);
      }
    } else if (subRes?.failedTests && subRes.failedTests.length > 0) {
      feedbackBlocks.push(`FAILED TEST CASES (FROM TAB 2 - ALL SUBMISSIONS TABLE AT ${timeStr}):\n` + subRes.failedTests.map((t) => `- ❌ ${t}`).join('\n'));
    }

    if (terminalOutput && terminalOutput.length > 25) {
      const totalLinesCount = terminalOutput.split('\n').length;
      const npmIdx = terminalOutput.search(/(?:^|\n)(?:>\s+\S+.*test|>\s*mocha|>\s*jest|\s*\d+\s+(?:passing|failing)|(?:AssertionError|TypeError|SyntaxError|ReferenceError|PrismaClient):)/m);
      if (npmIdx > 200) terminalOutput = terminalOutput.slice(npmIdx);
      terminalOutput = terminalOutput
        .split('\n')
        .filter(l => !/^\s*at\s+.*(?:node_modules\/|node:internal\/)/.test(l))
        .join('\n');
      const cleanTermTrace = terminalOutput.length > 14000 ? terminalOutput.slice(-14000) : terminalOutput;
      feedbackBlocks.push(`SIDE BAR TERMINAL & MOCHA ERROR TRACES (FROM TAB 3):\n\`\`\`\n${cleanTermTrace}\n\`\`\``);
      ui?.addLog(`📄 Captured error logs (${totalLinesCount} lines, ${failureItems.length} parsed failure(s)).`, 'ok');
    }

    // Gather CURRENT CODE of ALL workspace files — NEVER overwrite terminal-written solution with stale Monaco code!
    const currentFilesMap = new Map();
    for (const f of (cachedGeneratedFiles || [])) {
      if (f.filePath && f.code) currentFilesMap.set(f.filePath, f.code);
    }
    if (cachedEditor?.referenceFiles) {
      for (const [fname, content] of Object.entries(cachedEditor.referenceFiles)) {
        if (content && !currentFilesMap.has(fname)) currentFilesMap.set(fname, content);
      }
    }
    try {
      const latestEd = sendMsg ? await sendMsg({ op: 'AP_QUERY_EDITOR' }, 3000) : null;
      if (latestEd?.referenceFiles) {
        for (const [fname, content] of Object.entries(latestEd.referenceFiles)) {
          if (content && !currentFilesMap.has(fname)) currentFilesMap.set(fname, content);
        }
      }
      if (!filesWrittenViaTerminal && latestEd?.activeFile && latestEd?.code) {
        const act = AP.sanitizeActiveFile(latestEd.activeFile);
        if (!currentFilesMap.has(act)) currentFilesMap.set(act, latestEd.code);
      }
    } catch (e) {}

    if (currentFilesMap.size > 0) {
      const fileEntries = [];
      for (const [fname, code] of currentFilesMap.entries()) {
        const ext = fname.split('.').pop().toLowerCase();
        const lang = ext === 'json' ? 'json' : (ext === 'prisma' ? 'prisma' : (ext === 'ts' ? 'typescript' : 'javascript'));
        fileEntries.push(`### File: \`${fname}\`\n\`\`\`${lang}\n${code}\n\`\`\``);
      }
      feedbackBlocks.push(
        `=== CURRENT CODE OF ALL WORKSPACE FILES (SRC) AT TIME OF FAILURE ===\n` +
        `The test failed with the following exact code currently in the files. Inspect these files thoroughly, identify the root bugs, and return the complete corrected replacement for any file that needs fixing:\n\n` +
        fileEntries.join('\n\n')
      );
      ui?.addLog(`📂 Attached current code of ${currentFilesMap.size} workspace file(s) to AI debug prompt.`, 'ok');
    }

    feedbackBlocks.push(
      `🔥 MANDATORY ONE-SHOT COMPREHENSIVE DEBUGGING DIRECTIVES:\n` +
      `1. SIMULTANEOUS RESOLUTION: You MUST resolve EVERY single failed test case #1 through #${Math.max(failureItems.length, 1)} in this single output. Do NOT cherry-pick or fix only one error.\n` +
      `2. EXAMINE CURRENT CODE & TEST FILES: Cross-reference each failure with the CURRENT CODE of all files above and any discovered grading test files.\n` +
      `3. STATUS CODE, DUAL ERROR BODY & SYNTAX HANDLER PRECISION:\n` +
      `   - Return { error: msg, message: msg } on error responses unless exact single-key object equality is tested.\n` +
      `   - Validate inputs upfront -> res.status(400). Creation routes -> res.status(201). Not found -> res.status(404). Duplicates -> res.status(400/409).\n` +
      `   - Include Express JSON SyntaxError middleware so malformed payloads return 400.\n` +
      `4. PREVENT TIMEOUTS: Ensure EVERY route handler wraps async work in try/catch and calls 'return res.status(...).json(...)' in EVERY code branch.\n` +
      `5. INSTALLED PACKAGES ONLY: Use ONLY dependencies listed in package.json (e.g. bcryptjs vs bcrypt) and match CommonJS vs ESM.\n` +
      `6. POST-WRITE COMMANDS: If running a setup/build/migration/seed/install command is needed after writing code, emit a \`\`\`bash // __commands__\`\`\` block.\n` +
      `7. MULTI-FILE OUTPUT & ZERO COMMENTS: Output EVERY updated file cleanly with exact filepath on Line 1 and zero comments.`
    );

    return feedbackBlocks.join('\n\n');
  }

  Object.assign(AP, { diagnoseErrorMessage, parseAndStructureFailures, buildDebugFeedback });
})();
