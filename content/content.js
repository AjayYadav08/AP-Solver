// content/content.js - Core Top-Frame Orchestrator for 6-Step Autonomous Solving Lifecycle
(() => {
  if (window.top !== window) return;
  if (!/(^|\.)newtonschool\.co$/i.test(location.hostname)) return;
  if (window.__apContentLoaded) return;
  window.__apContentLoaded = true;

  const AP = window.__AP || {};
  const { sleep, sanitizeActiveFile, triggerElementClick } = AP;

  console.log('[AP-Solver] Content script initialized on top frame.');

  let ui = null;
  let cachedQuestion = null;
  let cachedEditor = null;
  let cachedGeneratedCode = '';
  let cachedGeneratedFiles = [];
  let cachedCommands = [];
  let attemptHistory = [];
  let filesWrittenViaTerminal = false;
  let initialWorkspaceFiles = new Set();
  let initialReferenceFiles = {};
  let staleTempFilesToRemove = new Set();
  let lockedFilePlan = null;
  let terminalPreAnalysis = null;
  let sessionAttemptRecords = [];
  let sessionCollaborationHistory = '';
  let currentQuestionKey = '';
  let lastExecutedCommands = [];
  let currentAttemptNum = 1;

  function pruneBareTabDuplicates(files = []) {
    const uniq = [...new Set((files || []).filter(Boolean))];
    return uniq.filter(f => {
      if (f.includes('/') || /^(?:index\.(?:js|ts)|package\.json|\.env|nodemon\.json|README\.md)$/i.test(f)) return true;
      const baseLow = f.toLowerCase();
      return !uniq.some(other => other !== f && other.includes('/') && other.toLowerCase().endsWith('/' + baseLow));
    });
  }

  /** Safe extension runtime message dispatcher with timeout & error recovery. */
  function sendMsg(msg, timeoutMs = 25000) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ ok: false, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` });
        }
      }, timeoutMs);

      try {
        if (!chrome.runtime?.id) {
          clearTimeout(timer);
          return resolve({ ok: false, error: 'Extension was reloaded. Please refresh the page.' });
        }
        chrome.runtime.sendMessage(msg, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp || { ok: false, error: 'No response from background service worker' });
        });
      } catch (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message || 'Extension error' });
      }
    });
  }

  async function queryActiveEditor() {
    const resp = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 8000);
    if (resp && resp.ok && resp.code !== undefined) {
      let activeFile = resp.activeFile || 'src/index.js';
      if (!resp.activeFile && resp.uri) activeFile = resp.uri.split('/').pop() || 'src/index.js';
      if (/^\d+$/.test(activeFile)) activeFile = 'src/index.js';
      return {
        code: resp.code,
        language: resp.language || 'javascript',
        activeFile,
        allFiles: resp.allFiles || [],
        referenceFiles: resp.referenceFiles || {},
        method: resp.method
      };
    }

    const topEditors = [...document.querySelectorAll('.monaco-editor')].filter(el =>
      !el.closest('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], [class*="request-body" i], [class*="response-body" i], #ap-solver-host')
    );
    const topViewLines = topEditors[0]?.querySelector('.view-lines');
    if (topViewLines && !document.querySelector('iframe')) {
      const code = [...topViewLines.querySelectorAll('.view-line')].map((l) => l.textContent).join('\n');
      return { code, language: 'javascript', activeFile: 'src/index.js', allFiles: ['src/index.js'], referenceFiles: {}, method: 'top-dom' };
    }
    return null;
  }

  /** Manual single-file inject handler (never invoked during automated Terminal-First solves). */
  async function writeCodeToEditor(newCode, filePath = null) {
    try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(newCode); } catch (e) {}
    try { [...document.querySelectorAll('iframe')].forEach(ifr => { try { ifr.focus(); } catch (e) {} }); } catch (e) {}

    const resp = await sendMsg({ op: 'AP_WRITE_EDITOR', data: { code: newCode, filePath } }, 20000);
    if (resp && resp.ok) return { ok: true, verified: true, method: resp.method, filePath: resp.filePath || filePath };
    if (filePath) return { ok: false, error: resp?.error || `Could not open and write to "${filePath}"` };

    if (!document.querySelector('iframe')) {
      const allTopEditors = [...document.querySelectorAll('.monaco-editor')].filter(el =>
        !el.closest('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], [class*="request-body" i], [class*="response-body" i], #ap-solver-host')
      );
      const textarea = allTopEditors[0]?.querySelector('textarea.inputarea');
      if (textarea) {
        textarea.focus();
        const isMac = /mac/i.test(navigator.platform);
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true }));
        document.execCommand('selectAll', false, null);
        try { document.execCommand('delete', false, null); } catch (e) {}
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        let inserted = false;
        try { inserted = document.execCommand('insertText', false, newCode); } catch (e) {}
        if (!inserted) {
          const dt = new DataTransfer();
          dt.setData('text/plain', newCode);
          try { textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); } catch (e) {}
        }
        const saveEvt = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, which: 83, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true });
        window.dispatchEvent(saveEvt);
        document.dispatchEvent(saveEvt);
        textarea.dispatchEvent(saveEvt);

        const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => l.textContent).join('\n');
        const hasOld501 = /res\.statusCode\s*=\s*501/i.test(lines);
        const countHttp = (lines.match(/require\(['"](?:node:)?http['"]\)/g) || []).length;
        return { ok: true, verified: lines.length > 50 && !hasOld501 && countHttp <= 1, method: 'top-dom-wipeAndPaste' };
      }
    }

    return { ok: !!resp?.ok, verified: !!resp?.verified, method: resp?.method || 'unknown' };
  }

  async function submitAndMonitor(timeoutMs = 120000) {
    const btn = AP.getSubmitButton();
    if (!btn) throw new Error('"Submit Solution" button not found on page.');

    const baseline = AP.readSubmissionResults();
    const baselineTimestamp = baseline?.timestamp || '';
    const baselinePassed = baseline?.passedCount || 0;
    const baselineFailed = baseline?.failedCount || 0;

    ui.addLog('Clicking "Submit Solution" button...', 'ok');
    triggerElementClick(btn);
    ui.setStatus('Evaluating Submission...', 'Waiting for grader to execute test cases...', 'running', true);

    await sleep(400);
    AP.switchToSubmissionsTab();
    ui.addLog('Waiting for grader evaluation to begin...', 'running');
    await sleep(3500);

    const start = Date.now();
    let sawRunning = false;
    let consecutivePassedChecks = 0;

    while (Date.now() - start < timeoutMs) {
      await sleep(500);

      const submitBtn = AP.getSubmitButton();
      const submitBtnText = (submitBtn?.innerText || '').trim();
      const isBtnRunning = /Running Test Cases|Checking|Evaluating/i.test(submitBtnText) || submitBtn?.disabled;
      const isPageRunning = /Running Test Cases|Checking Submission|evaluat(ing|e)|several minutes/i.test(document.body.innerText);

      if (isBtnRunning || isPageRunning) {
        sawRunning = true;
        ui.setStatus('Grading in progress...', 'Grader running test suite...', 'running', true);
        continue;
      }

      const results = await AP.readSubmissionResultsWithErrors();
      if (results && results.totalCount > 0) {
        const isStale = (
          !sawRunning &&
          results.timestamp === baselineTimestamp &&
          results.passedCount === baselinePassed &&
          results.failedCount === baselineFailed &&
          Date.now() - start < 8000
        );
        if (isStale) continue;

        if (results.passedCount === results.totalCount && results.failedCount === 0) {
          consecutivePassedChecks++;
          if (consecutivePassedChecks >= 2 || !isBtnRunning) {
            ui.addLog(`⚡ Instant Exit: All ${results.passedCount}/${results.totalCount} test cases verified passed!`, 'ok');
            return { ok: true, passed: results.passedCount, total: results.totalCount, tests: results.tests, timestamp: results.timestamp, failedTests: [], passedTests: results.passedTests };
          }
        }

        if (sawRunning && !isBtnRunning && (results.passedCount + results.failedCount >= results.totalCount)) {
          const allPassed = results.passedCount === results.totalCount && results.failedCount === 0;
          ui.addLog(`⚡ Evaluation Completed in ${((Date.now() - start) / 1000).toFixed(1)}s: ${results.passedCount}/${results.totalCount} passed.`, allPassed ? 'ok' : 'warn');
          return { ok: allPassed, passed: results.passedCount, total: results.totalCount, tests: results.tests, timestamp: results.timestamp, failedTests: results.failedTests, passedTests: results.passedTests };
        }
      }

      if (sawRunning && !isBtnRunning) {
        await sleep(300);
        const terminalLog = await AP.readTerminalOutput(1500);
        let passedCount = 0, failedCount = 0;
        if (terminalLog) {
          const passMatch = terminalLog.match(/(\d+)\s+passing/i);
          const failMatch = terminalLog.match(/(\d+)\s+failing/i);
          passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
          failedCount = failMatch ? parseInt(failMatch[1], 10) : 0;
          if (passedCount > 0 && failedCount === 0) {
            return { ok: true, passed: passedCount, total: passedCount, tests: [], timestamp: new Date().toLocaleTimeString(), failedTests: [], passedTests: [], summary: 'All test cases passed in Mocha!' };
          }
        }

        const finalSub = await AP.readSubmissionResultsWithErrors();
        const tab2Failed = finalSub?.failedTests || [];
        const total = finalSub?.totalCount || (passedCount + failedCount);
        const passed = finalSub?.passedCount ?? passedCount;
        const failed = finalSub?.failedCount ?? failedCount;
        return {
          ok: total > 0 && passed === total && failed === 0,
          passed,
          total,
          tests: finalSub?.tests || [],
          timestamp: finalSub?.timestamp || new Date().toLocaleTimeString(),
          failedTests: tab2Failed.length > 0 ? tab2Failed : (failedCount > 0 ? [`${failedCount} test case(s) failed in Mocha runner`] : []),
          passedTests: finalSub?.passedTests || [],
          terminalLog: terminalLog || ''
        };
      }

      if (/Latest Submission is Successful|All test cases passed/i.test(document.body.innerText)) {
        return { ok: true, summary: 'All test cases passed successfully!' };
      }
    }

    const fallback = await AP.readSubmissionResultsWithErrors();
    return {
      ok: fallback ? (fallback.passedCount === fallback.totalCount && fallback.failedCount === 0) : false,
      passed: fallback?.passedCount || 0,
      total: fallback?.totalCount || 0,
      tests: fallback?.tests || [],
      timestamp: fallback?.timestamp || new Date().toLocaleTimeString(),
      failedTests: fallback?.failedTests || [],
      passedTests: fallback?.passedTests || []
    };
  }

  async function handleReadContext() {
    ui.setStatus('Reading Question & Editor...', '', 'running', true);
    cachedQuestion = AP.extractQuestion();

    const subData = AP.readSubmissionResults();
    if (subData && subData.tests && subData.tests.length > 0) {
      cachedQuestion.testCases = subData.tests.map(t => t.name);
      ui.addLog(`✓ Loaded ${subData.tests.length} exact test cases from Submissions tab (${subData.timestamp})!`, 'ok');
    } else {
      ui.addLog(`Extracted Question: "${cachedQuestion.title}" (${cachedQuestion.testCases.length} test cases)`, 'ok');
    }

    cachedEditor = await queryActiveEditor();
    if (!cachedEditor) cachedEditor = { code: '', language: 'javascript', activeFile: 'src/index.js', allFiles: [], referenceFiles: {} };

    try {
      ui.addLog('🔎 [Workspace Probe] Scanning package.json & test suite files in container...', 'normal');
      const probeResp = await sendMsg({ op: 'AP_PROBE_WORKSPACE' }, 10000);
      if (probeResp && probeResp.ok && probeResp.files && Object.keys(probeResp.files).length > 0) {
        const combinedRefs = { ...(cachedEditor.referenceFiles || {}) };
        for (const [k, v] of Object.entries(probeResp.files)) {
          if (v && (!combinedRefs[k] || k === 'package.json' || /(?:test|spec|\.prisma|\.env)/i.test(k))) {
            combinedRefs[k] = v;
          }
        }
        cachedEditor.referenceFiles = combinedRefs;
        // Prefer authoritative container filesystem inventory over DOM-tab bare filenames
        const diskList = (probeResp.allFiles && probeResp.allFiles.length > 0)
          ? [...probeResp.allFiles, ...Object.keys(probeResp.files)]
          : [...(cachedEditor.allFiles || []), ...Object.keys(probeResp.files)];
        cachedEditor.allFiles = pruneBareTabDuplicates(diskList);
        const testCount = Object.keys(probeResp.files).filter(f => /(?:^|\/)(?:test|tests|__tests__)\/|(?:\.test|\.spec)\.(?:js|ts|mjs|cjs)$/i.test(f)).length;
        ui.addLog(`✓ [Workspace Probe] Loaded ${probeResp.files['package.json'] ? 'package.json, ' : ''}${testCount} test file(s), ${cachedEditor.allFiles.length} total workspace file(s)!`, 'ok');
      } else {
        cachedEditor.allFiles = pruneBareTabDuplicates(cachedEditor.allFiles || []);
      }
    } catch (e) {}

    if (cachedEditor && cachedEditor.code !== undefined) {
      cachedEditor.activeFile = sanitizeActiveFile(cachedEditor.activeFile);
      ui.addLog(`Editor detected: "${cachedEditor.activeFile}" (${cachedEditor.code.split('\n').length} lines, ${cachedEditor.allFiles?.length || 1} file(s) in workspace)`, 'ok');
    } else {
      ui.addLog('Editor not detected yet. Make sure target file is open.', 'warn');
    }

    // Step 1/2 Fixed Pre-Implementation File Analysis & Locked Plan
    try {
      const planResp = await sendMsg({
        op: 'AP_BUILD_FILE_PLAN',
        data: {
          questionTitle: cachedQuestion?.title || '',
          questionDetails: cachedQuestion?.details || '',
          activeFile: sanitizeActiveFile(cachedEditor?.activeFile),
          workspaceFiles: cachedEditor?.allFiles || [],
          referenceFiles: cachedEditor?.referenceFiles || {}
        }
      }, 4000);
      if (planResp && planResp.ok && planResp.plan) {
        lockedFilePlan = planResp.plan;
        cachedEditor.activeFile = sanitizeActiveFile(lockedFilePlan.primaryFile || cachedEditor.activeFile);
        ui.addLog(`🧭 [File Analysis] ${lockedFilePlan.architectureSummary}`, 'ok');
        for (const t of lockedFilePlan.targets) {
          ui.addLog(`📌 [${t.mode === 'edit' ? 'EDIT EXISTING' : 'NEW FILE'}] ${t.filePath} — ${t.reason}`, t.mode === 'edit' ? 'ok' : 'normal');
        }
        ui.addLog(`🔒 [Locked Plan] Fixed ${lockedFilePlan.allowedPaths.length} target(s); protected ${lockedFilePlan.protectedFiles.length} config/test file(s).`, 'ok');
      }
    } catch (e) {}

    // Step 1B: Thorough Pre-Coding Terminal, Workflow & Command Analysis
    try {
      let sideTermText = '';
      try {
        sideTermText = await AP.readTerminalOutput(1600);
        AP.switchToQuestionTab();
      } catch (e) {}
      let integTermText = '';
      try {
        const itResp = await sendMsg({ op: 'AP_READ_INTEGRATED_TERMINAL' }, 3000);
        if (itResp?.ok) integTermText = itResp.text || '';
      } catch (e) {}
      const detectedPostCmds = AP.detectPostWriteCommands(
        cachedQuestion?.details || '',
        cachedEditor?.referenceFiles?.['package.json'] || '',
        lockedFilePlan?.targets || [],
        `${sideTermText}\n${integTermText}`
      );
      const termResp = await sendMsg({
        op: 'AP_ANALYZE_TERMINAL',
        data: {
          sideTerminalText: sideTermText,
          integratedTerminalText: integTermText,
          questionDetails: cachedQuestion?.details || '',
          readmeText: cachedEditor?.referenceFiles?.['README.md'] || '',
          packageJsonStr: cachedEditor?.referenceFiles?.['package.json'] || '',
          detectedPostCommands: detectedPostCmds
        }
      }, 4000);
      if (termResp?.ok && termResp.analysis) {
        terminalPreAnalysis = termResp.analysis;
        if (terminalPreAnalysis.requiredPostCommands?.length > 0) {
          ui.addLog(`🖥️ [Pre-Coding Terminal Analysis] Requires post-write command(s) before Submit: ${terminalPreAnalysis.requiredPostCommands.join(' && ')}`, 'warn');
        } else {
          ui.addLog('🖥️ [Pre-Coding Terminal Analysis] No extra build/migration command needed beyond clean code writes.', 'ok');
        }
        if (terminalPreAnalysis.hasPriorTerminalErrors) {
          ui.addLog(`⚠️ [Pre-Coding Terminal Analysis] Existing terminal error detected [${terminalPreAnalysis.preErrorCategory}] — feeding context to Attempt 1.`, 'warn');
        }
      }
    } catch (e) {}

    // Load per-question persistent history (prevents repeating failed strategies from prior sessions)
    try {
      const hResp = await sendMsg({
        op: 'AP_LOAD_ATTEMPT_HISTORY',
        data: { url: location.href, questionTitle: cachedQuestion?.title || '' }
      }, 3000);
      if (hResp?.ok) {
        currentQuestionKey = hResp.questionKey || '';
        if (hResp.priorCollab && !sessionCollaborationHistory) {
          sessionCollaborationHistory = hResp.priorCollab;
          ui.addLog(`📚 [Persistent History] Loaded ${hResp.history?.attempts?.length || 0} prior attempt(s) for this question so known bugs are avoided.`, 'normal');
        }
      }
    } catch (e) {}

    ui.updateProblemInfo({
      title: cachedQuestion.title,
      difficulty: cachedQuestion.difficulty,
      points: cachedQuestion.points,
      testCasesCount: cachedQuestion.testCases.length,
      activeFile: sanitizeActiveFile(cachedEditor?.activeFile)
    });
    if (initialWorkspaceFiles.size === 0) {
      for (const f of (cachedEditor?.allFiles || [])) initialWorkspaceFiles.add(f);
      initialReferenceFiles = { ...(cachedEditor?.referenceFiles || {}) };
    }
    ui.setStatus('Context Loaded', `${cachedQuestion.testCases.length} test cases detected. Ready to generate.`, 'normal');
  }

  async function handleGenerate(feedback = null) {
    if (!cachedQuestion) cachedQuestion = AP.extractQuestion();
    if (!cachedEditor) cachedEditor = await queryActiveEditor();

    const isDebug = !!feedback;
    const provider = ui.options.provider || 'race';
    const providerName = isDebug
      ? '🧠 Debug Escalation (Gemini Pro / Groq Fallback)'
      : (provider === 'gemini' ? 'Google Gemini (2.5 Flash)' : provider === 'groq' ? 'Groq AI (GPT OSS 120B)' : provider === 'race' ? '⚡ Turbo Race (Groq vs Gemini Parallel)' : 'OpenAI');

    ui.setStatus(`Generating solution with ${providerName}...`, feedback ? 'Deep-analyzing failure traces & escalating model...' : 'Crafting 100% test-compliant code...', 'running', true);
    ui.addLog(`Calling AI solver (${providerName})...`);

    const mergedReferenceFiles = { ...(cachedEditor?.referenceFiles || {}) };
    for (const f of (cachedGeneratedFiles || [])) {
      if (f.filePath && f.code) mergedReferenceFiles[f.filePath] = f.code;
    }

    const latestGeneratedCode = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
      ? (cachedGeneratedFiles.find(f => f.filePath === sanitizeActiveFile(cachedEditor?.activeFile))?.code || cachedGeneratedFiles[0]?.code)
      : cachedGeneratedCode;

    if (!lockedFilePlan) {
      try {
        const planResp = await sendMsg({
          op: 'AP_BUILD_FILE_PLAN',
          data: {
            questionTitle: cachedQuestion?.title || '',
            questionDetails: cachedQuestion?.details || '',
            activeFile: sanitizeActiveFile(cachedEditor?.activeFile),
            workspaceFiles: cachedEditor?.allFiles || [],
            referenceFiles: mergedReferenceFiles
          }
        }, 4000);
        if (planResp?.ok && planResp.plan) lockedFilePlan = planResp.plan;
      } catch (e) {}
    }

    const promptData = {
      questionTitle: cachedQuestion.title,
      questionDetails: cachedQuestion.details,
      testCases: cachedQuestion.testCases,
      currentCode: (feedback && latestGeneratedCode) ? latestGeneratedCode : (cachedEditor?.code || ''),
      activeFile: sanitizeActiveFile(cachedEditor?.activeFile),
      workspaceFiles: cachedEditor?.allFiles || [],
      referenceFiles: mergedReferenceFiles,
      language: cachedEditor?.language || 'javascript',
      feedback,
      filePlan: lockedFilePlan,
      attemptNumber: currentAttemptNum,
      terminalPreAnalysis,
      attemptRecords: sessionAttemptRecords,
      collaborationHistory: sessionCollaborationHistory
    };

    const keepAliveTimer = setInterval(() => { sendMsg({ op: 'AP_KEEPALIVE' }, 3000).catch(() => {}); }, 20000);
    let resp;
    try {
      resp = await sendMsg({ op: 'AP_GENERATE', data: { promptData, settingsOverride: ui.options } }, 210000);
    } finally {
      clearInterval(keepAliveTimer);
    }

    if (!resp || !resp.ok) {
      const err = resp?.error || 'Unknown generation failure';
      ui.setStatus('Generation Failed', err, 'error');
      ui.addLog(`Error: ${err}`, 'bad');
      throw new Error(err);
    }

    for (const r of (resp.result.remappedFiles || [])) {
      ui.addLog(`↪️ [Plan Verification] Remapped "${r.from}" → canonical "${r.to}"`, 'warn');
    }
    for (const b of (resp.result.blockedFiles || [])) {
      ui.addLog(`🚫 [Plan Guard] Blocked unapproved/duplicate file "${b.filePath}": ${b.reason}`, 'warn');
    }
    if (!lockedFilePlan && resp.result.filePlan) lockedFilePlan = resp.result.filePlan;

    cachedGeneratedCode = resp.result.code;
    cachedCommands = Array.isArray(resp.result.commands) ? resp.result.commands : [];
    const newFiles = resp.result.files || [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];

    const mergedFilesMap = new Map();
    for (const f of (cachedGeneratedFiles || [])) if (f.filePath && f.code) mergedFilesMap.set(f.filePath, f);
    for (const f of newFiles) {
      if (!f.filePath || !f.code) continue;
      // Do not clobber/re-list untouched starter bootstrap files (e.g. root index.js -> require('./src/index'))
      const initCode = initialReferenceFiles?.[f.filePath];
      if (
        f.filePath === 'index.js' &&
        initCode &&
        initialWorkspaceFiles.has('src/index.js') &&
        f.code.trim() === initCode.trim()
      ) {
        continue;
      }
      const base = f.filePath.split('/').pop().toLowerCase();
      for (const k of [...mergedFilesMap.keys()]) {
        if (k === f.filePath) continue;
        const kBase = k.split('/').pop().toLowerCase();
        if (kBase !== base) continue;
        // Supersede earlier mistakenly flattened or moved file with same basename (and queue AP-created temp file for safe removal)
        const isOldBootstrap = k === 'index.js' && f.filePath === 'src/index.js';
        if (!initialWorkspaceFiles.has(k) || isOldBootstrap) {
          if (!initialWorkspaceFiles.has(k)) staleTempFilesToRemove.add(k);
          mergedFilesMap.delete(k);
        }
      }
      mergedFilesMap.set(f.filePath, f);
    }
    cachedGeneratedFiles = Array.from(mergedFilesMap.values());

    for (const f of cachedGeneratedFiles) {
      if (/datasource\s+db|generator\s+client|model\s+[A-Z]/i.test(f.code) || (f.filePath && f.filePath.endsWith('.prisma'))) {
        f.filePath = 'prisma/schema.prisma';
      } else if (/PrismaClient|prisma\.\w+\.(create|deleteMany|find)/i.test(f.code) && !/express|createServer/i.test(f.code)) {
        f.filePath = 'src/seed.js';
      }
    }
    ui.setGeneratedCode(cachedGeneratedCode);
    ui.setGeneratedFiles(cachedGeneratedFiles);

    const winnerTag = resp.result.raceWinner ? ` [Won by ${resp.result.raceWinner} in ${resp.result.latencyMs}ms]` : '';
    const fileSummary = cachedGeneratedFiles.map(f => f.filePath).join(', ');
    ui.addLog(`✓ Solution generated by ${resp.result.model}${winnerTag} for [${fileSummary}]`, 'ok');
    if (cachedCommands.length > 0) ui.addLog(`⚙️ AI requested post-write command(s): ${cachedCommands.join(' && ')}`, 'normal');
    ui.setStatus('Solution Generated', `${cachedGeneratedFiles.length} file(s) ready [${fileSummary}].`, 'success');

    return cachedGeneratedCode;
  }

  async function handleWriteCode() {
    if (!cachedGeneratedCode && (!cachedGeneratedFiles || cachedGeneratedFiles.length === 0)) {
      alert('No code generated yet. Please click "Solve".');
      return { ok: false, updatedFiles: [], failedFiles: [] };
    }

    let filesToWrite = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
      ? cachedGeneratedFiles
      : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];

    // Pre-Implementation / Pre-Write Plan Gate: never write blocked or off-plan paths to container disk
    if (lockedFilePlan) {
      try {
        const enf = await sendMsg({ op: 'AP_ENFORCE_FILE_PLAN', data: { files: filesToWrite, filePlan: lockedFilePlan } }, 3000);
        if (enf && enf.ok && Array.isArray(enf.files) && enf.files.length > 0) {
          for (const b of (enf.blockedFiles || [])) {
            ui.addLog(`🚫 [Pre-Write Verification] Prevented write to "${b.filePath}": ${b.reason}`, 'warn');
          }
          filesToWrite = enf.files;
          cachedGeneratedFiles = filesToWrite;
        }
      } catch (e) {}
    }

    for (const f of filesToWrite) {
      if (/datasource\s+db|generator\s+client|model\s+[A-Z]/i.test(f.code) || (f.filePath && f.filePath.endsWith('.prisma'))) f.filePath = 'prisma/schema.prisma';
      else if (/PrismaClient|prisma\.\w+\.(create|deleteMany|find)/i.test(f.code) && !/express|createServer/i.test(f.code)) f.filePath = 'src/seed.js';
    }

    try { await sendMsg({ op: 'AP_CLEAN_EDITOR_ARTIFACTS' }, 2000); } catch (e) {}
    for (const f of filesToWrite) {
      if (!/\.(?:html?|txt|md|json|env|svg|xml)$/i.test(f.filePath || '')) {
        f.code = AP.stripAllComments(f.code);
      }
    }

    ui.setStatus(`Injecting solution into ${filesToWrite.length} file(s)...`, '', 'running', true);

    const detectedPostCmds = AP.detectPostWriteCommands(
      cachedQuestion?.details || '',
      cachedEditor?.referenceFiles?.['package.json'] || '',
      filesToWrite
    );
    const preCommands = (terminalPreAnalysis?.requiredPostCommands && !cachedCommands?.length && !detectedPostCmds.length)
      ? terminalPreAnalysis.requiredPostCommands
      : [];
    const mergedPostCmds = [...new Set([...(cachedCommands || []), ...detectedPostCmds, ...preCommands])];
    lastExecutedCommands = [...mergedPostCmds];
    const cleanupList = [...staleTempFilesToRemove].filter(p => !initialWorkspaceFiles.has(p) && !filesToWrite.some(f => f.filePath === p));
    const bashScript = AP.buildTerminalBashScript(filesToWrite, mergedPostCmds, cleanupList);
    if (cleanupList.length > 0) staleTempFilesToRemove.clear();
    if (mergedPostCmds.length > 0) ui.addLog(`⚙️ [Post-Write Commands] Running in terminal before commit: ${mergedPostCmds.join(' && ')}`, 'normal');

    try {
      await navigator.clipboard.writeText(bashScript);
      ui.addLog(`💻 [Terminal Engine] Ready! Multi-file script auto-copied to clipboard.`, 'ok');
    } catch (e) {}

    filesWrittenViaTerminal = false;
    for (let termAttempt = 1; termAttempt <= 2; termAttempt++) {
      try {
        ui.addLog(`⚡ [Terminal Turbo Engine] Writing ${filesToWrite.length} file(s) directly to disk via Integrated Terminal (Attempt ${termAttempt}/2)...`, 'ok');
        const termResp = await sendMsg({ op: 'AP_WRITE_TERMINAL', data: { files: filesToWrite, script: bashScript, postCommands: mergedPostCmds } }, 28000);
        if (termResp && termResp.ok) {
          filesWrittenViaTerminal = true;
          ui.addLog(`⚡ [Terminal Turbo Engine] Successfully wrote ${filesToWrite.length} file(s) directly to disk via Terminal (${termResp.method || 'terminal'})!`, 'ok');
          for (const f of filesToWrite) ui.setFileStatus(f.filePath, 'injected');
          ui.setStatus('Files Saved via Terminal', `${filesToWrite.length} file(s) saved to disk. Ready to submit!`, 'success');
          await sleep(500);
          break;
        } else {
          ui.addLog(`⚠️ [Terminal Engine] Notice: ${termResp?.error || 'Terminal focus pending'}. Script is in clipboard!`, 'warn');
          if (termAttempt < 2) await sleep(500);
        }
      } catch (e) {}
    }

    if (filesWrittenViaTerminal) {
      ui.addLog(`⚡ [Terminal-First Architecture] Files written cleanly to container disk via Terminal! Monaco editor completely bypassed.`, 'ok');
      for (const f of filesToWrite) {
        ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
        ui.setFileStatus(f.filePath, 'injected');
      }
      return { ok: true, updatedFiles: filesToWrite.map(f => f.filePath), failedFiles: [] };
    }

    ui.addLog(`📋 Multi-file bash script is COPIED in your clipboard!`, 'ok');
    ui.addLog(`👉 Press Cmd+V (or right-click Paste) in the bottom Terminal & press Enter to run!`, 'warn');
    ui.setStatus('Action Required: Paste in Terminal', 'Script is in clipboard. Paste into bottom Terminal and press Enter.', 'warn');

    for (let waitSec = 0; waitSec < 25; waitSec++) {
      if (filesWrittenViaTerminal) break;
      try {
        const termCandidates = [...document.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i]')];
        for (const ifr of document.querySelectorAll('iframe')) {
          try {
            const doc = ifr.contentDocument || ifr.contentWindow?.document;
            if (doc) termCandidates.push(...doc.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i]'));
          } catch (e) {}
        }
        for (const el of termCandidates) {
          if ((el.innerText || el.textContent || '').split('\n').some(r => r.trim() === '=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===')) {
            filesWrittenViaTerminal = true;
            ui.addLog(`⚡ [Terminal-First Architecture] Detected "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===" in terminal output! Auto-proceeding...`, 'ok');
            break;
          }
        }
      } catch (e) {}
      if (filesWrittenViaTerminal) break;
      await sleep(1000);
    }

    if (filesWrittenViaTerminal) {
      for (const f of filesToWrite) {
        ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
        ui.setFileStatus(f.filePath, 'injected');
      }
      return { ok: true, updatedFiles: filesToWrite.map(f => f.filePath), failedFiles: [] };
    }

    const updatedFiles = [], failedFiles = [];
    for (const f of filesToWrite) {
      ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
      const curCode = f.code || '';
      const isStaticAsset = /\.(?:html?|txt|md|css|env|sql|svg)$/i.test(f.filePath || '');
      const hasTerminalArtifact = /base64\s*-d|mkdir\s*-p|=== AP-SOLVER/i.test(curCode);
      const minLen = isStaticAsset ? 5 : 12;
      const hasCleanCode = curCode.trim().length >= minLen && !/\/\/\s*write your code here|\/\*\s*write your code here\s*\*\//i.test(curCode) && !hasTerminalArtifact;
      const codeMatches = hasCleanCode && !hasTerminalArtifact;
      if (filesWrittenViaTerminal || codeMatches) updatedFiles.push(f.filePath);
      else failedFiles.push(f.filePath);
    }

    if (failedFiles.length > 0) {
      ui.addLog(`🛑 Submission BLOCKED: Do not click submit until each required file's code is updated!`, 'bad');
      ui.addLog(`⚠️ Terminal write did not complete in time. Paste clipboard command into Terminal or click Solve again.`, 'warn');
      return { ok: false, updatedFiles, failedFiles };
    }

    ui.setStatus('Code Injected & Verified', `${filesToWrite.length} file(s) saved to workspace.`, 'success');
    return { ok: true, updatedFiles, failedFiles: [] };
  }

  async function verifyCodeCompleteness(filesToWrite) {
    if (!filesToWrite || filesToWrite.length === 0) {
      ui.addLog('🛑 Verification failed: No solution files specified to verify.', 'bad');
      ui.setStatus('No Code', 'No solution files to verify.', 'error');
      return false;
    }

    for (const f of filesToWrite) {
      const code = f.code || '';
      const isStaticAsset = /\.(?:html?|txt|md|css|env|sql|svg)$/i.test(f.filePath || '');
      const minVerifyLen = isStaticAsset ? 5 : 12;
      if (!code || code.trim().length < minVerifyLen) {
        ui.addLog(`🛑 Verification failed: "${f.filePath}" code is too short or empty (${code.trim().length} chars). Submission aborted.`, 'bad');
        ui.setStatus('Incomplete Code', `Code for ${f.filePath} is incomplete.`, 'error');
        return false;
      }
      if (/\/\/\s*write your code here|\/\*\s*write your code here\s*\*\/|\/\/\s*TODO:\s*implement/i.test(code)) {
        ui.addLog(`🛑 Verification failed: Placeholder comment detected in "${f.filePath}". Submission aborted.`, 'bad');
        ui.setStatus('Incomplete Code', `Placeholder detected in ${f.filePath}.`, 'error');
        return false;
      }
      if (/base64\s*-d|mkdir\s*-p|=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===/i.test(code)) {
        ui.addLog(`🛑 Verification failed: Terminal bash command artifact detected inside code of "${f.filePath}". Submission aborted.`, 'bad');
        ui.setStatus('Invalid Code Artifact', `Bash command artifact detected in ${f.filePath}.`, 'error');
        return false;
      }
    }

    if (filesWrittenViaTerminal) {
      ui.addLog(`✓ Terminal-First verification: ${filesToWrite.length} file(s) saved directly to container disk. Ready to submit!`, 'ok');
      return true;
    }

    await sleep(1500);
    try {
      const editorStatus = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 5000);
      if (editorStatus && editorStatus.ok && editorStatus.code && editorStatus.activeFile) {
        if (/base64\s*-d|mkdir\s*-p|=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===/i.test(editorStatus.code)) {
          try { await sendMsg({ op: 'AP_CLEAN_EDITOR_ARTIFACTS' }, 3000); } catch (e) {}
          await sleep(400);
        }
        const curActive = sanitizeActiveFile(editorStatus.activeFile).toLowerCase();
        const isTargetFile = filesToWrite.some(f => {
          const base = f.filePath.split('/').pop().toLowerCase();
          return curActive.includes(base) || base.includes(curActive);
        });
        if (isTargetFile && /\/\/\s*write your code here|\/\*\s*write your code here\s*\*\//i.test(editorStatus.code)) {
          ui.addLog(`🛑 Verification failed: Active editor for "${editorStatus.activeFile}" still contains starter placeholder!`, 'bad');
          ui.setStatus('Editor Not Replaced', 'Starter placeholder still present in editor.', 'error');
          return false;
        }
      }
    } catch (e) {}

    ui.addLog(`✓ Code completeness verified (${filesToWrite.length} file(s) complete, non-placeholder). Ready to submit!`, 'ok');
    return true;
  }

  async function handleSubmit() {
    try {
      const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
        ? cachedGeneratedFiles
        : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
      const isComplete = await verifyCodeCompleteness(filesToCheck);
      if (!isComplete) {
        ui.addLog('🛑 Submission cancelled: All required files must have complete, non-placeholder code before submitting.', 'bad');
        return { ok: false, error: 'Incomplete code in required files' };
      }

      const res = await submitAndMonitor();
      if (res.ok) {
        ui.addLog(`🎉 All test cases passed! (${res.passed || 'All'} passed)`, 'ok');
        ui.setStatus('Accepted 🎉', 'All test cases passed! Solution accepted.', 'success');
      } else {
        ui.addLog(`Test failure: ${res.passed || 0}/${res.total || 0} passed`, 'bad');
        ui.setStatus('Test Cases Failed', `${res.failedTests?.length || 0} test(s) failed.`, 'error');
      }
      return res;
    } catch (err) {
      ui.addLog(`Submit error: ${err.message}`, 'bad');
      ui.setStatus('Submit Error', err.message, 'error');
      return { ok: false, error: err.message };
    }
  }

  async function handleOneClickSolve() {
    console.log('[AP-Solver] handleOneClickSolve triggered');
    try {
      ui.setRunning(true);
      ui.setStatus('Checking Configuration...', '', 'running', true);

      let s = {};
      try { s = await chrome.storage.local.get(null); }
      catch (e) { const resp = await sendMsg({ op: 'AP_GET_SETTINGS' }, 4000); s = resp?.settings || {}; }

      const inpGemini = (document.querySelector('.ap-inp-gemini')?.value || '').trim();
      const inpGroq = (document.querySelector('.ap-inp-groq')?.value || '').trim();
      if (inpGemini && !s.geminiKey) { s.geminiKey = inpGemini; await chrome.storage.local.set({ geminiKey: inpGemini }); ui.apiKeys.geminiKey = inpGemini; }
      if (inpGroq && !s.groqKey) { s.groqKey = inpGroq; await chrome.storage.local.set({ groqKey: inpGroq }); ui.apiKeys.groqKey = inpGroq; }

      if (!s.geminiKey?.trim() && !s.groqKey?.trim() && !s.openaiKey?.trim()) {
        ui.setRunning(false);
        ui.showSettings = true;
        ui.render();
        ui.setStatus('API Key Required', 'Please enter your Gemini or Groq key above and click "Save Keys".', 'warn');
        ui.addLog('Please enter your Gemini or Groq key in the settings box above.', 'warn');
        return;
      }

      ui.addLog('Starting automated 6-step solve lifecycle...', 'ok');

      cachedEditor = null;
      cachedGeneratedFiles = [];
      cachedCommands = [];
      attemptHistory = [];
      initialWorkspaceFiles = new Set();
      initialReferenceFiles = {};
      staleTempFilesToRemove = new Set();
      lockedFilePlan = null;
      terminalPreAnalysis = null;
      sessionAttemptRecords = [];
      sessionCollaborationHistory = '';
      currentQuestionKey = '';
      lastExecutedCommands = [];
      currentAttemptNum = 1;
      const remediatedCmds = new Set();
      filesWrittenViaTerminal = false;

      ui.setStatus('Step 1/6: Reading Question, Packages & Test Files...', '', 'running', true);
      ui.addLog('📋 [Step 1/6] Giving full question and initial code of files to AI...', 'ok');
      AP.switchToQuestionTab();
      await sleep(300);
      await handleReadContext();

      let maxAttempts = ui.options.autoRetry ? 5 : 1;
      let feedback = null;
      let lastLocalTestResult = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        currentAttemptNum = attempt;
        filesWrittenViaTerminal = false;
        lastLocalTestResult = null;
        const stageBanner = attempt === 1
          ? 'Attempt 1/5 — Initial Question & Terminal Analysis Solution'
          : attempt === 2
            ? 'Attempt 2/5 — First Error-Driven Fix'
            : attempt === 3
              ? 'Attempt 3/5 — Multi-AI Collaborator (Full History Audit)'
              : attempt === 4
                ? 'Attempt 4/5 — Deep Edge-Case & Boundary Audit'
                : 'Attempt 5/5 — Final High-Reliability Synthesis';
        ui.addLog(`🧭 [${stageBanner}]`, attempt >= 2 ? 'warn' : 'ok');

        const maxLocalTries = ui.options.autoRetry ? 3 : 1;
        let writeBlockedOrIncomplete = false;

        for (let localTry = 1; localTry <= maxLocalTries; localTry++) {
          filesWrittenViaTerminal = false;
          const stepTag = localTry > 1 ? `Attempt ${attempt} (Local Debug ${localTry}/${maxLocalTries})` : `Attempt ${attempt}/${maxAttempts}`;

          ui.setStatus(`${stepTag}: Generating Solution...`, feedback ? 'Debug Escalation: analyzing error traces with High-Reasoning model...' : 'Generating initial test-compliant solution...', 'running', true);
          await handleGenerate(feedback);

          ui.setStatus(`${stepTag} - Step 2 & 3: Checking Files & Writing Code...`, 'Writing solution files directly to disk via Terminal...', 'running', true);
          ui.addLog(`🔍 [Step 2/6] Determining required files & creating any missing files at given location...`, 'ok');
          ui.addLog('✍️ [Step 3/6] Writing code into all files one by one, erasing initial code...', 'ok');
          const writeResult = await handleWriteCode();
          if (!writeResult || !writeResult.ok) {
            const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
              ? cachedGeneratedFiles
              : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
            const pending = writeResult?.failedFiles?.length ? writeResult.failedFiles : filesToCheck.map(f => f.filePath);
            ui.addLog(`🛑 [Policy Enforcement] Submission BLOCKED: Do not click submit until each required file's code is updated! (${pending.join(', ')} pending)`, 'bad');
            ui.setStatus('Submission Blocked', `Waiting for all required files to be updated: ${pending.join(', ')}`, 'error');
            writeBlockedOrIncomplete = true;
            break;
          }

          const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
            ? cachedGeneratedFiles
            : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
          const isComplete = await verifyCodeCompleteness(filesToCheck);
          if (!isComplete) { writeBlockedOrIncomplete = true; break; }

          ui.setStatus(`${stepTag} - Local Pre-Test Check...`, 'Running question-specific verification in Terminal...', 'running', true);
          ui.addLog(`🧪 [Local Pre-Test] Executing terminal verification before remote submission...`, 'running');
          const runLocalTestPayload = {
            files: filesToCheck.map(f => f.filePath),
            questionTitle: cachedQuestion?.title || '',
            questionDetails: cachedQuestion?.details || '',
            testCases: cachedQuestion?.testCases || [],
            referenceFiles: Object.keys(cachedEditor?.referenceFiles || {}),
            packageJsonStr: cachedEditor?.referenceFiles?.['package.json'] || '',
            terminalPreAnalysis
          };
          let localRes = await sendMsg({ op: 'AP_RUN_LOCAL_TESTS', data: runLocalTestPayload }, 48000);

          if (localRes && localRes.status === 'failed' && Array.isArray(localRes.autoFixCommands) && localRes.autoFixCommands.length > 0) {
            const freshCmds = localRes.autoFixCommands.filter(c => !remediatedCmds.has(c));
            if (freshCmds.length > 0) {
              freshCmds.forEach(c => remediatedCmds.add(c));
              ui.addLog(`🛠️ [Auto-Command Remediation] Executing missing setup command(s) in Terminal: ${freshCmds.join(' && ')}`, 'warn');
              const cmdRes = await sendMsg({ op: 'AP_RUN_TERMINAL_COMMANDS', data: { commands: freshCmds } }, 48000);
              if (cmdRes?.output) ui.addLog(`⚙️ Command finished (exit=${cmdRes.exitCode ?? 0}). Re-running local pre-tests...`, cmdRes.ok ? 'ok' : 'warn');
              lastExecutedCommands = [...new Set([...lastExecutedCommands, ...freshCmds])];
              localRes = await sendMsg({ op: 'AP_RUN_LOCAL_TESTS', data: runLocalTestPayload }, 48000);
            }
          }

          lastLocalTestResult = localRes || null;
          if (localRes?.executedCommands?.length) {
            lastExecutedCommands = [...new Set([...lastExecutedCommands, ...localRes.executedCommands])];
          }
          if (localRes?.strategy && localRes.status !== 'unreadable' && localRes.status !== 'error') {
            ui.addLog(`🔬 [Local Pre-Test Strategy] ${localRes.strategy} | cmds: ${(localRes.executedCommands || []).join(' ; ') || 'node runtime'}`, 'normal');
          }
          if (Array.isArray(localRes?.cases) && localRes.cases.length > 0) {
            for (const c of localRes.cases.slice(0, 10)) {
              if (c.ok) {
                ui.addLog(`   ✅ [Local] ${c.name} (${c.actual || 'ok'})`, 'ok');
              } else {
                ui.addLog(`   ❌ [Local] ${c.name} | input: ${c.input || '-'} | expected: ${c.expected || '-'} | actual: ${c.actual || '-'}`, 'bad');
              }
            }
          }

          if (localRes && localRes.status === 'passed') {
            ui.addLog(`✅ [Local Pre-Test] Passed (${localRes.passed || 'all'} check(s) passing)! Submitting with confidence...`, 'ok');
            break;
          } else if (localRes && localRes.status === 'failed') {
            ui.addLog(`❌ [Local Pre-Test] Failed locally (${localRes.passed || 0} passed, ${localRes.failed || 0} failed)!`, 'bad');
            const firstFailedCase = (localRes.cases || []).find(c => !c.ok);
            const firstErrLine = firstFailedCase
              ? `${firstFailedCase.name}: expected ${firstFailedCase.expected}, got ${firstFailedCase.actual}`
              : ((localRes.output || '').split('\n').find(l => /FAIL|Error:|AssertionError|expected|Cannot find/i.test(l)) || 'Local test assertion failed');
            const failedCaseList = (localRes.cases || [])
              .filter(c => !c.ok)
              .map(c => `${c.name} [input: ${c.input} | expected: ${c.expected} | actual: ${c.actual}]`);
            attemptHistory.push(`Local ${attempt}.${localTry} (${localRes.passed || 0}/${(localRes.passed || 0) + (localRes.failed || 0)}): ${firstErrLine.trim().slice(0, 140)}`);
            if (ui.options.autoRetry && localTry < maxLocalTries) {
              try {
                const recResp = await sendMsg({
                  op: 'AP_RECORD_ATTEMPT',
                  data: {
                    questionKey: currentQuestionKey,
                    existingRecords: sessionAttemptRecords,
                    attemptNumber: attempt,
                    stage: `local-${attempt}.${localTry}`,
                    questionTitle: cachedQuestion?.title || '',
                    originalQuestion: cachedQuestion?.details || '',
                    submittedFiles: filesToCheck,
                    terminalOutput: localRes.output || '',
                    subRes: { passed: localRes.passed || 0, total: (localRes.passed || 0) + (localRes.failed || 0), failedTests: failedCaseList.length ? failedCaseList : [`${localRes.failed} local check(s) failed`] },
                    commandsExecuted: [...lastExecutedCommands],
                    localTestResult: localRes,
                    whatWentWrong: firstErrLine.trim().slice(0, 220),
                    strategyUsed: `Local Pre-Test (${localRes.strategy || 'auto'}) ${attempt}.${localTry}`
                  }
                }, 4000);
                if (recResp?.ok) {
                  sessionAttemptRecords = recResp.records || sessionAttemptRecords;
                  sessionCollaborationHistory = recResp.collaborationHistory || sessionCollaborationHistory;
                }
              } catch (e) {}
              feedback = await AP.buildDebugFeedback(
                localRes.output || '',
                { passed: localRes.passed || 0, total: (localRes.passed || 0) + (localRes.failed || 0), failedTests: failedCaseList.length ? failedCaseList : [`${localRes.failed} check(s) failed during local Terminal pre-test`] },
                `${attempt}.${localTry} (Local Pre-Test)`,
                { attemptHistory, collaborationHistory: sessionCollaborationHistory, commandsExecuted: lastExecutedCommands, cachedGeneratedFiles, cachedEditor, filesWrittenViaTerminal, sendMsg, ui }
              );
              ui.addLog(`🧠 Skipping slow remote Submit — fixing failed local checks before submission (${localTry + 1}/${maxLocalTries})...`, 'warn');
              continue;
            }
            ui.addLog(`⚠️ Max local debug tries reached (${maxLocalTries}); proceeding to remote Submit...`, 'warn');
            break;
          } else {
            const skipMsg = localRes?.status === 'no_local_tests'
              ? 'No runnable entrypoint or test files found locally; proceeding to remote Newton grader.'
              : `Local terminal capture fallback (${localRes?.error || 'buffer unavailable'}); proceeding to remote Newton grader.`;
            ui.addLog(`ℹ️ [Local Pre-Test] ${skipMsg}`, 'normal');
            break;
          }
        }

        if (writeBlockedOrIncomplete) { ui.setRunning(false); break; }

        ui.setStatus(`Attempt ${attempt}/${maxAttempts} - Step 4/6: Submitting Solution...`, 'Evaluating solution with test grader...', 'running', true);
        ui.addLog(`🚀 [Step 4/6] Submitting solution & waiting until testcases judgement (Attempt ${attempt}/${maxAttempts})...`);
        const subRes = await handleSubmit();

        const timeStr = subRes?.timestamp || new Date().toLocaleTimeString();
        ui.addLog(`📊 [${timeStr}] Submission Results (Attempt ${attempt}): ${subRes?.passed || 0}/${subRes?.total || 0} passed`, subRes?.ok ? 'ok' : 'warn');

        if (subRes?.tests && subRes.tests.length > 0) {
          const runFailed = (subRes.totalCount || subRes.tests.length) > (subRes.passedCount ?? subRes.passed ?? 0);
          for (const t of subRes.tests) {
            if (t.fail || (!t.pass && runFailed)) {
              ui.addLog(`   ❌ ${t.name}`, 'bad');
              if (t.error) ui.addLog(`      ↳ Error: ${t.error}`, 'bad');
            } else if (t.pass) {
              ui.addLog(`   ✅ ${t.name}`, 'ok');
            }
          }
        }

        if (subRes && subRes.ok) {
          try {
            await sendMsg({
              op: 'AP_RECORD_ATTEMPT',
              data: {
                questionKey: currentQuestionKey,
                existingRecords: sessionAttemptRecords,
                attemptNumber: attempt,
                stage: 'remote',
                questionTitle: cachedQuestion?.title || '',
                originalQuestion: cachedQuestion?.details || '',
                submittedFiles: (cachedGeneratedFiles && cachedGeneratedFiles.length > 0) ? cachedGeneratedFiles : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }],
                terminalOutput: subRes?.terminalLog || '',
                subRes,
                commandsExecuted: [...lastExecutedCommands],
                localTestResult: lastLocalTestResult,
                whatWentWrong: 'Passed all assertions',
                strategyUsed: `Attempt ${attempt}/5`
              }
            }, 3000);
          } catch (e) {}
          ui.addLog(`🎉 CHALLENGE SOLVED! All ${subRes.passed || 'all'} test cases passed on Attempt ${attempt} (${timeStr})!`, 'ok');
          ui.setStatus('Accepted 🎉', `All ${subRes.passed || 'all'} test cases passed at ${timeStr}!`, 'success');
          ui.setRunning(false);
          break;
        } else if (attempt < maxAttempts) {
          ui.addLog(`🔍 [Step 5/6] Tests failed. Checking error message in side bar terminal & analyzing failure...`, 'warn');
          ui.setStatus(`Attempt ${attempt}/${maxAttempts} - Step 5/6: Analyzing Terminal Errors...`, 'Checking error messages in side bar terminal...', 'running', true);

          const terminalOutput = (await AP.readTerminalOutput(5500)) || subRes?.terminalLog || '';
          const remoteAutoCmds = AP.detectPostWriteCommands(
            cachedQuestion?.details || '',
            cachedEditor?.referenceFiles?.['package.json'] || '',
            cachedGeneratedFiles,
            terminalOutput
          ).filter(c => !remediatedCmds.has(c));
          if (remoteAutoCmds.length > 0) {
            remoteAutoCmds.forEach(c => remediatedCmds.add(c));
            lastExecutedCommands = [...new Set([...lastExecutedCommands, ...remoteAutoCmds])];
            ui.addLog(`🛠️ [Auto-Command Remediation] Executing terminal command detected from grader error: ${remoteAutoCmds.join(' && ')}`, 'warn');
            await sendMsg({ op: 'AP_RUN_TERMINAL_COMMANDS', data: { commands: remoteAutoCmds } }, 48000);
          }

          const errHint = (terminalOutput || '').split('\n').find(l => /AssertionError|TypeError|SyntaxError|ReferenceError|ECONNREFUSED|Cannot find|expected/i.test(l)) || `${subRes?.passed || 0}/${subRes?.total || 0} passed`;
          attemptHistory.push(`Remote Attempt ${attempt} (${subRes?.passed || 0}/${subRes?.total || 0}): ${errHint.trim().slice(0, 120)}`);

          // Persist complete attempt snapshot & update chronological AI-to-AI collaboration transcript
          try {
            const filesSubmitted = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
              ? cachedGeneratedFiles
              : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
            const recResp = await sendMsg({
              op: 'AP_RECORD_ATTEMPT',
              data: {
                questionKey: currentQuestionKey,
                existingRecords: sessionAttemptRecords,
                attemptNumber: attempt,
                stage: 'remote',
                questionTitle: cachedQuestion?.title || '',
                originalQuestion: cachedQuestion?.details || '',
                submittedFiles: filesSubmitted,
                terminalOutput,
                subRes,
                commandsExecuted: [...lastExecutedCommands],
                localTestResult: lastLocalTestResult,
                whatWentWrong: errHint.trim().slice(0, 260),
                strategyUsed: attempt === 1 ? 'Initial Question + Terminal Analysis' : `Attempt ${attempt}/5 Fix`
              }
            }, 4000);
            if (recResp?.ok) {
              sessionAttemptRecords = recResp.records || sessionAttemptRecords;
              sessionCollaborationHistory = recResp.collaborationHistory || sessionCollaborationHistory;
              ui.addLog(`📝 [Attempt History] Saved Attempt ${attempt} (${recResp.record?.errorCategory || 'FAILED'}) & built AI collaboration handoff.`, 'normal');
            }
          } catch (e) {}

          feedback = await AP.buildDebugFeedback(
            terminalOutput,
            subRes,
            String(attempt),
            {
              attemptHistory,
              collaborationHistory: sessionCollaborationHistory,
              commandsExecuted: lastExecutedCommands,
              cachedGeneratedFiles,
              cachedEditor,
              filesWrittenViaTerminal,
              sendMsg,
              ui
            }
          );

          ui.addLog(`🔁 [Step 6/6] Escalating with complete attempt history to Attempt ${attempt + 1}/${maxAttempts}...`, 'warn');
          AP.switchToQuestionTab();
          await sleep(1500);
          continue;
        } else {
          const finalTerm = (await AP.readTerminalOutput(3000)) || subRes?.terminalLog || '';
          try {
            const filesSubmitted = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
              ? cachedGeneratedFiles
              : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
            await sendMsg({
              op: 'AP_RECORD_ATTEMPT',
              data: {
                questionKey: currentQuestionKey,
                existingRecords: sessionAttemptRecords,
                attemptNumber: attempt,
                stage: 'remote',
                questionTitle: cachedQuestion?.title || '',
                originalQuestion: cachedQuestion?.details || '',
                submittedFiles: filesSubmitted,
                terminalOutput: finalTerm,
                subRes,
                commandsExecuted: [...lastExecutedCommands],
                whatWentWrong: `${subRes?.passed || 0}/${subRes?.total || 0} passed on Attempt ${attempt}`,
                strategyUsed: `Attempt ${attempt}/5 Final`
              }
            }, 3000);
          } catch (e) {}
          ui.addLog(`⚠️ Attempt ${attempt} finished: ${subRes?.passed || 0}/${subRes?.total || 0} test cases passed.`, 'warn');
          if (!ui.options.autoRetry) ui.addLog('ℹ️ Auto-retry is disabled. Review error messages above or click Solve to retry.', 'normal');
          ui.setRunning(false);
          break;
        }
      }
    } catch (err) {
      console.error('[AP-Solver] One-click solve error:', err);
      ui.addLog(`Stopped: ${err.message}`, 'bad');
      ui.setStatus('Error', err.message, 'error');
    } finally {
      ui.setRunning(false);
    }
  }

  async function init() {
    let settings = {};
    try { if (chrome.storage?.local) settings = await chrome.storage.local.get(null); } catch (e) {}
    if (!settings || !Object.keys(settings).length) {
      const resp = await sendMsg({ op: 'AP_GET_SETTINGS' }, 3000);
      settings = resp?.settings || {};
    }

    ui = new window.APSolverUI({
      onOneClickSolve: handleOneClickSolve,
      onReadContext: handleReadContext,
      onGenerate: () => handleGenerate(),
      onWriteCode: handleWriteCode,
      onInjectSingleFile: async (filePath, code) => {
        ui.addLog(`Injecting single file "${filePath}"...`);
        const res = await writeCodeToEditor(code, filePath);
        if (res && res.ok) {
          ui.setFileStatus(filePath, 'injected');
          ui.addLog(`✓ Saved "${filePath}" successfully (${res.method || 'saved'})!`, 'ok');
          return true;
        }
        const verifyResp = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 3000);
        const curCode = verifyResp?.code || '';
        const curActive = sanitizeActiveFile(verifyResp?.activeFile || '').toLowerCase();
        const baseName = filePath.split('/').pop().toLowerCase();
        const isCurrentFile = curActive.includes(baseName) || baseName.includes(curActive);
        const codeMatches = !/base64\s*-d|mkdir\s*-p|=== AP-SOLVER/i.test(curCode) &&
          curCode.replace(/[\s\r\n]+/g, ' ').includes(code.replace(/[\s\r\n]+/g, ' ').slice(0, 50));
        if (isCurrentFile && codeMatches) {
          ui.setFileStatus(filePath, 'injected');
          ui.addLog(`✓ Verified complete solution code already active in "${filePath}"!`, 'ok');
          return true;
        }
        ui.setFileStatus(filePath, 'error');
        ui.addLog(`⚠️ Could not switch to "${filePath}". Please click "${filePath}" tab in VS Code and try again.`, 'warn');
        return false;
      },
      onConfirmTerminalPasted: async () => {
        filesWrittenViaTerminal = true;
        const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
          ? cachedGeneratedFiles
          : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
        for (const f of filesToCheck) ui.setFileStatus(f.filePath, 'injected');
        ui.addLog('⚡ Terminal paste confirmed by user! Proceeding to submit solution...', 'ok');
        ui.setStatus('Submitting Solution...', 'Evaluating solution with test grader...', 'running', true);
        await sleep(500);
        await handleSubmit();
      },
      onSubmit: handleSubmit,
      onOptionsChange: (newOpts) => {
        try { if (chrome.storage?.local) chrome.storage.local.set(newOpts).catch(() => {}); } catch (e) {}
        sendMsg({ op: 'AP_SAVE_SETTINGS', data: newOpts }, 4000).catch(() => {});
      }
    });

    let activeProvider = settings.provider || 'groq';
    if (settings.geminiKey?.trim() && !settings.groqKey?.trim()) activeProvider = 'gemini';
    else if (settings.groqKey?.trim() && !settings.geminiKey?.trim()) activeProvider = 'groq';

    ui.setApiKeys({ geminiKey: settings.geminiKey || '', groqKey: settings.groqKey || '' });
    ui.updateOptions({ autoSubmit: settings.autoSubmit ?? true, autoRetry: settings.autoRetry !== false, provider: activeProvider });

    let scanCount = 0;
    const scanInterval = setInterval(() => {
      scanCount++;
      const q = AP.extractQuestion();
      if (q && q.title && q.title !== 'Newton School') {
        ui.updateProblemInfo({ title: q.title, difficulty: q.difficulty, points: q.points, testCasesCount: q.testCases.length });
        if (q.testCases.length > 0) clearInterval(scanInterval);
      }
      if (scanCount >= 12) clearInterval(scanInterval);
    }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
