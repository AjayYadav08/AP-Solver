// content/content.js - Core Top-Frame Automation Driver for AP-Solver
(() => {
  if (window.top !== window) return; // Only run in top window
  if (!/(^|\.)newtonschool\.co$/i.test(location.hostname)) return; // Strictly Newton School portal only
  if (window.__apContentLoaded) return;
  window.__apContentLoaded = true;

  console.log('[AP-Solver] Content script initialized on top frame.');

  let ui = null;
  let cachedQuestion = null;
  let cachedEditor = null;
  let cachedGeneratedCode = '';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Helper: check element visibility
  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  // Find button by regex matching visible text
  function findButton(re) {
    const btns = [...document.querySelectorAll('button, div[role="button"], a[role="button"]')];
    return btns.find((b) => isVisible(b) && re.test(b.innerText.trim()) && !b.closest('#ap-solver-host'));
  }

  // --- Section 1: Question Scraper ---
  function getQuestionContainer() {
    // Find all containers containing core question markers
    const candidates = [...document.querySelectorAll('div, section, main')].filter((el) => {
      const text = el.innerText || '';
      return (
        isVisible(el) &&
        text.length > 80 &&
        /Requirements|Test Cases|Given Task Data|Implement the following|Method\s+Endpoint/i.test(text) &&
        !el.closest('#ap-solver-host') &&
        !el.querySelector('.monaco-editor')
      );
    });

    // Prefer containers on the left side of screen
    const leftCandidates = candidates.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.left < window.innerWidth * 0.55;
    });

    // Pick the most comprehensive container (longest meaningful text)
    const sorted = (leftCandidates.length ? leftCandidates : candidates).sort((a, b) => b.innerText.length - a.innerText.length);
    return sorted[0] || document.body;
  }

  function extractQuestion() {
    const qContainer = getQuestionContainer();
    const containerText = qContainer.innerText || '';
    const bodyText = document.body.innerText || '';

    // 1. Title Extraction
    let title = '';

    // Method A: Check top bar (e.g. "< Back | Build a Task Management API" or "Back \n Build a Task Management API")
    const topText = bodyText.slice(0, 2000);
    const backMatch = topText.match(/(?:<|\bBack\b)[^\w\n]*[|\n]\s*([^\n\r]+)/i);
    if (backMatch && backMatch[1]) {
      const clean = backMatch[1].split(/(?:Total XP|\s{4,}|\t)/i)[0].trim();
      if (clean.length > 3 && !/^(newton|playground|school|back|<)$/i.test(clean)) {
        title = clean;
      }
    }

    // Method B: Check prominent heading in left column
    if (!title) {
      const headings = [...document.querySelectorAll('h1, h2, h3, h4, [class*="title" i], [class*="header" i]')].filter((el) => {
        const r = el.getBoundingClientRect();
        const t = el.innerText.trim();
        return isVisible(el) && r.left < window.innerWidth * 0.55 && t.length > 3 &&
          !/^(QUESTION|Test Cases|Requirements|Newton School|Given Task Data|Submissions|ALL SUBMISSIONS|LATEST SUBMISSION)$/i.test(t);
      });
      if (headings.length > 0) {
        title = headings[0].innerText.trim();
      }
    }

    // Method C: Check lines between "QUESTION" and "Hard"/"Medium"/"Easy" or "0/60"
    if (!title) {
      const lines = (containerText || bodyText).split('\n').map((l) => l.trim()).filter(Boolean);
      const diffIdx = lines.findIndex((l) => /^(Easy|Medium|Hard)$/i.test(l) || /^\d+\s*\/\s*\d+/.test(l));
      if (diffIdx > 0) {
        for (let i = diffIdx - 1; i >= 0; i--) {
          const l = lines[i];
          if (l.length > 3 && !/^(QUESTION|Back|<)$/i.test(l) && !/newton school/i.test(l)) {
            title = l;
            break;
          }
        }
      }
    }

    // Filter out generic platform names
    if (!title || /^(newton school|playground)$/i.test(title)) {
      title = 'Build a Task Management API';
    }

    // 2. Extract Difficulty and Points
    let difficulty = 'Medium';
    let points = '0/60';
    const diffMatch = (containerText + ' ' + bodyText).match(/\b(Easy|Medium|Hard)\b/i);
    if (diffMatch) difficulty = diffMatch[1];
    const ptsMatch = (containerText + ' ' + bodyText).match(/(\d+\s*\/\s*\d+)\b/);
    if (ptsMatch) points = ptsMatch[1];

    // 3. Extract Test Cases
    const testCases = [];
    const searchTexts = [containerText, bodyText];
    for (const text of searchTexts) {
      const lines = text.split('\n').map((l) => l.trim());
      for (const line of lines) {
        const m = line.match(/^(\d+)[\.\)]\s+(.+)$/);
        if (m && m[2].length > 4) {
          const desc = m[2].trim();
          if (!/^(open|click|go to|download|step|navigate)\b/i.test(desc) || /test|return|reject|filter|accept|get|post|patch|put|delete|status|json|array|task/i.test(desc)) {
            if (!testCases.includes(desc)) {
              testCases.push(desc);
            }
          }
        }
      }
      if (testCases.length > 0) break;
    }

    // 4. Full Description
    const fullText = (containerText.length > 100 ? containerText : bodyText)
      .replace(/< Back.*?\n/g, '')
      .replace(/Total XP.*?\n/g, '')
      .replace(/Submit Solution/g, '')
      .trim();

    return {
      title,
      difficulty,
      points,
      testCases,
      details: fullText
    };
  }

  // Helper: safe extension message dispatcher with timeout and error handling
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
          resolve({ ok: false, error: 'Extension was reloaded. Please refresh the page.' });
          return;
        }

        chrome.runtime.sendMessage(msg, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, error: 'No response from background service worker' });
          }
        });
      } catch (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message || 'Extension error' });
      }
    });
  }

  // --- Section 2: Editor Interaction ---
  async function queryActiveEditor() {
    const resp = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 8000);

    if (resp && resp.ok && resp.code !== undefined) {
      let activeFile = resp.activeFile || 'src/index.js';
      if (!resp.activeFile && resp.uri) {
        const parts = resp.uri.split('/');
        activeFile = parts[parts.length - 1] || 'src/index.js';
      }
      return {
        code: resp.code,
        language: resp.language || 'javascript',
        activeFile,
        allFiles: resp.allFiles || [],
        referenceFiles: resp.referenceFiles || {},
        method: resp.method
      };
    }

    // Fallback: look for monaco in top frame
    const topViewLines = document.querySelector('.monaco-editor .view-lines');
    if (topViewLines) {
      const code = [...topViewLines.querySelectorAll('.view-line')].map((l) => l.textContent).join('\n');
      return {
        code,
        language: 'javascript',
        activeFile: 'src/index.js',
        allFiles: ['src/index.js'],
        referenceFiles: {},
        method: 'top-dom'
      };
    }

    return null;
  }

  async function writeCodeToEditor(newCode, filePath = null) {
    // Copy code to real clipboard first
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(newCode);
      }
    } catch(e) {}

    // Focus editor iframes from top frame to ensure active focus
    try {
      const iframes = [...document.querySelectorAll('iframe')];
      for (const ifr of iframes) {
        try { ifr.focus(); } catch(e) {}
      }
    } catch(e) {}

    const resp = await sendMsg({ op: 'AP_WRITE_EDITOR', data: { code: newCode, filePath } }, 20000);

    if (resp && resp.ok && resp.verified) {
      return { ok: true, verified: true, method: resp.method, filePath: resp.filePath || filePath };
    }

    // CRITICAL SAFETY GUARD: If filePath was specified, DO NOT fall back to top DOM!
    // Falling back to top DOM when target is orderManager.js will overwrite index.js!
    if (filePath) {
      console.warn(`[AP-Solver] Failed to write into target file "${filePath}":`, resp?.error || 'Target file not active');
      return { ok: false, error: resp?.error || `Could not open and write to "${filePath}"` };
    }

    // Fallback in top document ONLY if no specific targetFilePath was requested
    const editorDom = document.querySelector('.monaco-editor');
    const textarea = editorDom?.querySelector('textarea.inputarea');
    if (textarea) {
      textarea.focus();

      const isMac = /mac/i.test(navigator.platform);

      // 1. Move cursor to start of file: Cmd+Up / Ctrl+Home
      const topEvt = new KeyboardEvent('keydown', {
        key: isMac ? 'ArrowUp' : 'Home',
        code: isMac ? 'ArrowUp' : 'Home',
        keyCode: isMac ? 38 : 36,
        which: isMac ? 38 : 36,
        ctrlKey: !isMac,
        metaKey: isMac,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(topEvt);

      // 2. Select down to end: Cmd+Shift+Down / Ctrl+Shift+End
      const selectDownEvt = new KeyboardEvent('keydown', {
        key: isMac ? 'ArrowDown' : 'End',
        code: isMac ? 'ArrowDown' : 'End',
        keyCode: isMac ? 40 : 35,
        which: isMac ? 40 : 35,
        ctrlKey: !isMac,
        metaKey: isMac,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(selectDownEvt);

      // 3. Select all shortcuts
      const metaSelectAll = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        keyCode: 65,
        which: 65,
        ctrlKey: false,
        metaKey: true,
        bubbles: true,
        cancelable: true
      });
      const ctrlSelectAll = new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        keyCode: 65,
        which: 65,
        ctrlKey: true,
        metaKey: false,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(metaSelectAll);
      textarea.dispatchEvent(ctrlSelectAll);
      if (editorDom) {
        editorDom.dispatchEvent(metaSelectAll);
        editorDom.dispatchEvent(ctrlSelectAll);
      }
      document.execCommand('selectAll', false, null);

      // 4. Primary: Block Paste to avoid newline auto-indent staircase drift
      const dt = new DataTransfer();
      dt.setData('text/plain', newCode);

      // Try native clipboard paste
      try {
        document.execCommand('paste');
      } catch(e) {}

      // Dispatch synthetic ClipboardEvent paste
      try {
        const pasteEvt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        textarea.dispatchEvent(pasteEvt);
        if (editorDom) editorDom.dispatchEvent(pasteEvt);
      } catch(e) {}

      // Dispatch beforeinput with insertFromPaste
      try {
        textarea.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertFromPaste',
          data: newCode,
          dataTransfer: dt,
          bubbles: true,
          cancelable: true
        }));
      } catch(e) {}

      // Fallback only if paste was blocked and editor is empty
      await new Promise(r => setTimeout(r, 100));
      const linesCheck = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => l.textContent).join('\n');
      if (linesCheck.length < 50) {
        try {
          document.execCommand('insertText', false, newCode);
        } catch(e) {}
      }

      // Trigger Ctrl+S / Cmd+S
      const saveEvt = new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        keyCode: 83,
        which: 83,
        ctrlKey: !isMac,
        metaKey: isMac,
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(saveEvt);
      document.dispatchEvent(saveEvt);
      textarea.dispatchEvent(saveEvt);

      // Verify DOM
      const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => l.textContent).join('\n');
      const hasOld501 = /res\.statusCode\s*=\s*501/i.test(lines);
      const countHttp = (lines.match(/require\(['"](?:node:)?http['"]\)/g) || []).length;
      const verified = lines.length > 50 && !hasOld501 && countHttp <= 1;
      return { ok: true, verified, method: 'top-dom-wipeAndPaste' };
    }

    return { ok: !!resp?.ok, verified: !!resp?.verified, method: resp?.method || 'unknown' };
  }

  // --- Section 3: Submissions & Fast Grader Tracking ---
  function getSubmitButton() {
    return findButton(/^submit solution$/i) || findButton(/^submit$/i);
  }

  function readSubmissionResults() {
    // 1. Check if submission is in progress or evaluation is running
    const isRunning = /Running Test Cases|Checking Submission|evaluat(ing|e)|several minutes/i.test(document.body.innerText);

    // 2. Scan for all test case name elements in the left panel (x < window.innerWidth * 0.55)
    const leftElements = [...document.querySelectorAll('*')].filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.left < window.innerWidth * 0.55 && r.top > 40 && !el.closest('#ap-solver-host');
    });

    // Find leaf elements matching "^1. should ...", "^2. should ...", etc.
    const testNameElements = leftElements.filter((el) => {
      const text = el.innerText?.trim() || '';
      if (!/^\d+[\.\)]\s+[A-Za-z]/.test(text)) return false;
      if (text.length < 5 || text.length > 250) return false;
      // Exclude instructions or parent containers that hold multiple lines
      if (text.includes('\n') && (text.match(/\n/g) || []).length > 2) return false;
      // Leaf check: no child element should have the same starting number pattern
      const hasChildWithSame = [...el.children].some((c) => /^\d+[\.\)]\s+[A-Za-z]/.test(c.innerText?.trim() || ''));
      return !hasChildWithSame;
    });

    // Deduplicate by test number and clean name
    const uniqueTestElements = [];
    const seenKeys = new Set();
    for (const el of testNameElements) {
      const cleanName = el.innerText.trim().replace(/\s+(pass|fail|pending)$/i, '');
      const match = cleanName.match(/^(\d+)[\.\)]\s+(.+)$/);
      if (match) {
        const key = match[1] + '_' + match[2].slice(0, 30);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueTestElements.push({ el, num: parseInt(match[1], 10), name: cleanName });
        }
      }
    }

    uniqueTestElements.sort((a, b) => a.num - b.num);

    // 3. For each test element, inspect its row container for Pass (Green) vs Fail (Red) status
    const tests = uniqueTestElements.map(({ el, num, name }) => {
      // Find row container: closest tr, li, role=row, or parent flex container
      const row = el.closest('tr, li, [role="row"], [class*="row" i], [class*="item" i]') || el.parentElement || el;
      const searchElements = [
        ...row.querySelectorAll('svg, path, circle, span, div, i'),
        ...(el.nextElementSibling ? [el.nextElementSibling, ...el.nextElementSibling.querySelectorAll('*')] : [])
      ];

      let isGreen = false;
      let isRed = false;

      for (const node of searchElements) {
        const fill = (node.getAttribute?.('fill') || '').toLowerCase();
        const stroke = (node.getAttribute?.('stroke') || '').toLowerCase();
        const cls = (node.getAttribute?.('class') || '').toLowerCase();
        const style = (node.getAttribute?.('style') || '').toLowerCase();

        // Check green
        if (
          fill === '#009965' || fill.includes('green') || fill.includes('#10b981') || fill.includes('#22c55e') ||
          stroke === '#009965' || stroke.includes('green') ||
          cls.includes('green') || cls.includes('pass') || cls.includes('success') ||
          style.includes('green') || style.includes('#009965') || style.includes('rgb(0, 153')
        ) {
          isGreen = true;
        }

        // Check red
        if (
          fill === '#ef4444' || fill.includes('red') || fill.includes('#dc2626') || fill.includes('#e11d48') ||
          stroke === '#ef4444' || stroke.includes('red') ||
          cls.includes('red') || cls.includes('fail') || cls.includes('error') ||
          style.includes('red') || style.includes('#ef4444') || style.includes('rgb(239,')
        ) {
          isRed = true;
        }
      }

      // Computed style check as fallback
      if (!isGreen && !isRed) {
        const svgs = row.querySelectorAll('svg');
        for (const svg of svgs) {
          try {
            const cs = window.getComputedStyle(svg);
            const col = cs.color || '';
            const fill = cs.fill || '';
            if (col.includes('239,') || col.includes('220,') || fill.includes('239,') || fill.includes('220,')) isRed = true;
            if (col.includes('0, 153') || col.includes('16, 185') || fill.includes('0, 153') || fill.includes('16, 185')) isGreen = true;
          } catch (e) {}
        }
      }

      const status = isRed ? 'FAIL' : (isGreen ? 'PASS' : 'PENDING');
      return {
        num,
        name,
        status,
        pass: status === 'PASS',
        fail: status === 'FAIL',
        pending: status === 'PENDING'
      };
    });

    // 4. Extract timestamp / submission metadata ("kaab")
    let timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeElements = leftElements.filter((el) => {
      const t = el.innerText?.trim() || '';
      return /(?:ago|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b)/i.test(t) && t.length < 50;
    });
    if (timeElements.length > 0) {
      timestamp = timeElements[0].innerText.trim();
    }

    return {
      timestamp,
      isRunning,
      tests,
      passedCount: tests.filter((t) => t.pass).length,
      failedCount: tests.filter((t) => t.fail).length,
      totalCount: tests.length,
      failedTests: tests.filter((t) => !t.pass).map((t) => t.name),
      passedTests: tests.filter((t) => t.pass).map((t) => t.name)
    };
  }

  async function submitAndMonitor(timeoutMs = 45000) {
    const btn = getSubmitButton();
    if (!btn) throw new Error('"Submit Solution" button not found on page.');

    ui.addLog('Clicking "Submit Solution" button...', 'ok');
    btn.click();

    ui.setStatus('Evaluating Submission...', 'Grader running test cases...', 'running', true);

    // Switch to Submissions tab (Tab 2) so live test results are actively rendered
    await sleep(400);
    switchToSubmissionsTab();

    const start = Date.now();
    let sawRunning = false;
    let consecutivePassedChecks = 0;

    while (Date.now() - start < timeoutMs) {
      await sleep(300);

      const submitBtn = getSubmitButton();
      const submitBtnText = (submitBtn?.innerText || '').trim();
      const isBtnRunning = /Running Test Cases|Checking|Evaluating/i.test(submitBtnText) || submitBtn?.disabled;

      if (isBtnRunning) {
        sawRunning = true;
      }

      // Check Submissions Tab (Tab 2)
      const results = readSubmissionResults();
      if (results && results.totalCount > 0) {
        if (results.isRunning) {
          sawRunning = true;
          ui.setStatus('Grading in progress...', `${results.passedCount}/${results.totalCount} test cases passed so far...`, 'running', true);
        } else {
          // Check 1: 100% all passed!
          if (results.passedCount === results.totalCount && results.failedCount === 0) {
            consecutivePassedChecks++;
            if (consecutivePassedChecks >= 2 || !isBtnRunning) {
              ui.addLog(`⚡ Instant Exit: All ${results.passedCount}/${results.totalCount} test cases verified passed!`, 'ok');
              return {
                ok: true,
                passed: results.passedCount,
                total: results.totalCount,
                tests: results.tests,
                timestamp: results.timestamp,
                failedTests: [],
                passedTests: results.passedTests
              };
            }
          }

          // Check 2: All test cases have been evaluated and grader is no longer running
          if (sawRunning && !isBtnRunning && (results.passedCount + results.failedCount >= results.totalCount)) {
            const allPassed = results.passedCount === results.totalCount && results.failedCount === 0;
            ui.addLog(`⚡ Evaluation Completed in ${((Date.now() - start) / 1000).toFixed(1)}s: ${results.passedCount}/${results.totalCount} passed.`, allPassed ? 'ok' : 'warn');
            return {
              ok: allPassed,
              passed: results.passedCount,
              total: results.totalCount,
              tests: results.tests,
              timestamp: results.timestamp,
              failedTests: results.failedTests,
              passedTests: results.passedTests
            };
          }
        }
      }

      // Fast Exit Check 3: Once button finishes running, check Terminal Tab (Tab 3) immediately!
      if (sawRunning && !isBtnRunning) {
        await sleep(300);
        const terminalLog = await readTerminalOutput(1500);
        let passedCount = 0;
        let failedCount = 0;
        if (terminalLog) {
          const passMatch = terminalLog.match(/(\d+)\s+passing/i);
          const failMatch = terminalLog.match(/(\d+)\s+failing/i);
          passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
          failedCount = failMatch ? parseInt(failMatch[1], 10) : 0;

          if (passedCount > 0 && failedCount === 0) {
            return {
              ok: true,
              passed: passedCount,
              total: passedCount,
              tests: [],
              timestamp: new Date().toLocaleTimeString(),
              failedTests: [],
              passedTests: [],
              summary: 'All test cases passed in Mocha!'
            };
          }
        }

        // Return combined results from Tab 2 and Tab 3
        const finalSub = readSubmissionResults();
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

      // Check success banner in main text
      if (/Latest Submission is Successful|All test cases passed/i.test(document.body.innerText)) {
        return { ok: true, summary: 'All test cases passed successfully!' };
      }
    }

    return { ok: false, error: 'Submission evaluation timed out after 45s.' };
  }

  // --- High-Level User Actions ---
  async function handleReadContext() {
    ui.setStatus('Reading Question & Editor...', '', 'running', true);
    
    // 1. Read Question
    cachedQuestion = extractQuestion();

    // Check if Tab 2 (Submissions) already has test cases
    const subData = readSubmissionResults();
    if (subData && subData.tests && subData.tests.length > 0) {
      cachedQuestion.testCases = subData.tests.map(t => t.name);
      ui.addLog(`✓ Loaded ${subData.tests.length} exact test cases from Submissions tab (${subData.timestamp})!`, 'ok');
    } else {
      ui.addLog(`Extracted Question: "${cachedQuestion.title}" (${cachedQuestion.testCases.length} test cases)`, 'ok');
    }

    // 2. Read Editor
    cachedEditor = await queryActiveEditor();
    if (cachedEditor) {
      const fileCount = cachedEditor.allFiles?.length || 1;
      ui.addLog(`Editor detected: "${cachedEditor.activeFile}" (${cachedEditor.code.split('\n').length} lines, ${fileCount} file(s) in workspace)`, 'ok');

      // Check if question specifically specifies a different target code file (e.g. orderManager.js)
      if (cachedQuestion?.details) {
        const fileMatches = cachedQuestion.details.match(/([a-zA-Z0-9_\-]+\.(?:js|ts))/gi) || [];
        const knownFiles = cachedEditor.allFiles || [];
        for (const fm of fileMatches) {
          if (/package|prisma\.config|schema\.prisma|\.env|nodemon|readme|test/i.test(fm)) continue;
          const matchingKnown = knownFiles.find(kf => kf.endsWith(fm));
          if (matchingKnown && !cachedEditor.activeFile.endsWith(fm)) {
            ui.addLog(`ℹ️ Question specifically targets "${matchingKnown}". Updating active target.`, 'ok');
            cachedEditor.activeFile = matchingKnown;
            break;
          }
        }
      }
    } else {
      ui.addLog('Editor not detected yet. Make sure target file is open.', 'warn');
    }

    ui.updateProblemInfo({
      title: cachedQuestion.title,
      difficulty: cachedQuestion.difficulty,
      points: cachedQuestion.points,
      testCasesCount: cachedQuestion.testCases.length,
      activeFile: cachedEditor?.activeFile || 'None'
    });

    ui.setStatus('Context Loaded', `${cachedQuestion.testCases.length} test cases detected. Ready to generate.`, 'normal');
  }

  let cachedGeneratedFiles = [];

  async function handleGenerate(feedback = null) {
    if (!cachedQuestion) {
      cachedQuestion = extractQuestion();
    }
    if (!cachedEditor) {
      cachedEditor = await queryActiveEditor();
    }

    const provider = ui.options.provider || 'race';
    const providerName = provider === 'gemini' 
      ? 'Google Gemini (3.8 Flash)' 
      : provider === 'groq' 
        ? 'Groq AI (GPT OSS 120B)' 
        : provider === 'race'
          ? '⚡ Turbo Race (Groq vs Gemini Parallel)'
          : 'OpenAI';

    ui.setStatus(`Generating solution with ${providerName}...`, feedback ? 'Refining code based on failed test cases...' : 'Crafting 100% test-compliant code...', 'running', true);
    ui.addLog(`Calling AI solver (${providerName})...`);

    const promptData = {
      questionTitle: cachedQuestion.title,
      questionDetails: cachedQuestion.details,
      testCases: cachedQuestion.testCases,
      currentCode: cachedEditor?.code || '',
      activeFile: cachedEditor?.activeFile || 'src/index.js',
      workspaceFiles: cachedEditor?.allFiles || [],
      referenceFiles: cachedEditor?.referenceFiles || {},
      language: cachedEditor?.language || 'javascript',
      feedback
    };

    const resp = await sendMsg({
      op: 'AP_GENERATE',
      data: { promptData, settingsOverride: ui.options }
    }, 150000);

    if (!resp || !resp.ok) {
      const err = resp?.error || 'Unknown generation failure';
      ui.setStatus('Generation Failed', err, 'error');
      ui.addLog(`Error: ${err}`, 'bad');
      throw new Error(err);
    }

    cachedGeneratedCode = resp.result.code;
    cachedGeneratedFiles = resp.result.files || [{ filePath: cachedEditor?.activeFile || 'src/index.js', code: cachedGeneratedCode }];
    ui.setGeneratedCode(cachedGeneratedCode);
    ui.setGeneratedFiles(cachedGeneratedFiles);

    const winnerTag = resp.result.raceWinner ? ` [Won by ${resp.result.raceWinner} in ${resp.result.latencyMs}ms]` : '';
    const fileSummary = cachedGeneratedFiles.map(f => f.filePath).join(', ');
    ui.addLog(`✓ Solution generated by ${resp.result.model}${winnerTag} for [${fileSummary}]`, 'ok');
    ui.setStatus('Solution Generated', `${cachedGeneratedFiles.length} file(s) ready [${fileSummary}].`, 'success');

    return cachedGeneratedCode;
  }

  // --- Section 4: Left Rail Tabs & Terminal Execution Log Scraper ---
  function getLeftRailTabs() {
    // Find clickable tab items on the vertical left bar (x < 80px)
    const elements = [...document.querySelectorAll('button, [role="tab"], div, a, li, span')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!isVisible(el)) return false;
      if (r.left < 0 || r.left > 80) return false;
      if (r.top < 30 || r.top > 450) return false;
      if (r.width < 14 || r.height < 14) return false;
      if (r.width > 75 || r.height > 75) return false; // Leaf icon button, not the entire rail bar
      if (el.closest('#ap-solver-host')) return false;

      const text = el.innerText.trim();
      const hasIcon = !!el.querySelector('svg, i, [class*="icon" i], [class*="codicon" i]') || text === 'Q';
      const isRole = /tab|button/i.test(el.getAttribute('role') || el.tagName);
      return hasIcon || isRole || text.length === 1;
    });

    // Deduplicate elements located at similar vertical Y positions (within 15px)
    const uniqueTabs = [];
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      const existing = uniqueTabs.find((u) => Math.abs(u.getBoundingClientRect().top - r.top) < 15);
      if (!existing) {
        uniqueTabs.push(el);
      }
    }

    uniqueTabs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return uniqueTabs;
  }

  function clickRailTab(index) {
    const tabs = getLeftRailTabs();
    if (tabs.length > index) {
      const target = tabs[index];
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      target.click();
      return true;
    }
    return false;
  }

  function switchToQuestionTab() {
    // 1. Look for explicit button/tab with aria-label or title matching question
    const explicit = [...document.querySelectorAll('button, [role="tab"], div')].find((el) => {
      const r = el.getBoundingClientRect();
      const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').toLowerCase();
      return isVisible(el) && r.left < 90 && /question|problem/i.test(text);
    });
    if (explicit) {
      explicit.click();
      return true;
    }
    // 2. Tab index 0 on left rail
    return clickRailTab(0);
  }

  function switchToSubmissionsTab() {
    // 1. Look for explicit button/tab with aria-label or title matching submission
    const explicit = [...document.querySelectorAll('button, [role="tab"], div')].find((el) => {
      const r = el.getBoundingClientRect();
      const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').toLowerCase();
      return isVisible(el) && r.left < 90 && /submission|test\s*case/i.test(text);
    });
    if (explicit) {
      explicit.click();
      return true;
    }
    // 2. Tab index 1 on left rail
    return clickRailTab(1);
  }

  function switchToTerminalTab() {
    // 1. Look for explicit button/tab with aria-label or title matching terminal/log
    const explicit = [...document.querySelectorAll('button, [role="tab"], div')].find((el) => {
      const r = el.getBoundingClientRect();
      const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').toLowerCase();
      return isVisible(el) && r.left < 90 && /terminal|log|output|console|execution/i.test(text);
    });
    if (explicit) {
      explicit.click();
      return true;
    }
    // 2. Tab index 2 on left rail
    return clickRailTab(2);
  }

  async function readTerminalOutput(maxWaitMs = 6000) {
    switchToTerminalTab();
    await sleep(800);

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      // Find terminal output container in the left section (x < window.innerWidth * 0.55)
      const candidates = [...document.querySelectorAll('pre, code, .xterm-rows, [class*="terminal" i], [class*="console" i], div')].filter((el) => {
        const r = el.getBoundingClientRect();
        const text = el.innerText || '';
        return (
          isVisible(el) &&
          r.left < window.innerWidth * 0.55 &&
          r.width > 200 &&
          r.height > 80 &&
          !el.closest('#ap-solver-host') &&
          (/mocha|npm test|git clone|AssertionError|failing|passing|prisma|timeout|error|exit|node/i.test(text))
        );
      });

      if (candidates.length > 0) {
        // Sort by text length to find the root terminal container
        const longest = candidates.sort((a, b) => b.innerText.length - a.innerText.length)[0];
        const logText = longest.innerText.trim();
        if (logText.length > 80) {
          return logText;
        }
      }

      await sleep(500);
    }

    return '';
  }

  async function handleWriteCode() {
    if (!cachedGeneratedCode && (!cachedGeneratedFiles || cachedGeneratedFiles.length === 0)) {
      alert('No code generated yet. Please click "Solve".');
      return false;
    }

    const filesToWrite = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
      ? cachedGeneratedFiles
      : [{ filePath: cachedEditor?.activeFile || 'src/index.js', code: cachedGeneratedCode }];

    ui.setStatus(`Injecting solution into ${filesToWrite.length} file(s)...`, '', 'running', true);

    // Copy primary code to system clipboard
    try {
      await navigator.clipboard.writeText(filesToWrite[0].code);
    } catch (e) {}

    let allSucceeded = true;

    for (const f of filesToWrite) {
      ui.addLog(`Injecting clean code into "${f.filePath}"...`);
      const res = await writeCodeToEditor(f.code, f.filePath);
      if (res && res.ok) {
        ui.setFileStatus(f.filePath, 'injected');
        ui.addLog(`✓ Wiped & saved "${f.filePath}" (${f.code.split('\n').length} lines, ${res.method || 'saved'})!`, 'ok');
      } else {
        allSucceeded = false;
        ui.setFileStatus(f.filePath, 'error');
        ui.addLog(`⚠️ Automated injection into "${f.filePath}" failed. Code copied to clipboard.`, 'warn');
      }
      await sleep(300);
    }

    if (allSucceeded) {
      ui.setStatus('Code Injected & Verified', `${filesToWrite.length} file(s) saved to workspace.`, 'success');
      return true;
    }

    const firstFile = filesToWrite[0]?.filePath || 'target file';
    ui.addLog(`👉 Please click inside "${firstFile}", press Cmd+A, Cmd+V to replace, and Cmd+S to save.`, 'warn');
    ui.setStatus('Manual Replace Required', `Press Cmd+A then Cmd+V in "${firstFile}" to replace code.`, 'warn');
    return false;
  }

  async function handleSubmit() {
    try {
      const res = await submitAndMonitor();
      if (res.ok) {
        ui.addLog(`🎉 All test cases passed! (${res.passed || 'All'} passed)`, 'ok');
        ui.setStatus('Accepted 🎉', 'All test cases passed! Solution accepted.', 'success');
        return res;
      } else {
        ui.addLog(`Test failure: ${res.passed || 0}/${res.total || 0} passed`, 'bad');
        ui.setStatus('Test Cases Failed', `${res.failedTests?.length || 0} test(s) failed.`, 'error');
        return res;
      }
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

      // 1. Read keys directly from local storage
      let s = {};
      try {
        s = await chrome.storage.local.get(null);
      } catch (e) {
        const resp = await sendMsg({ op: 'AP_GET_SETTINGS' }, 4000);
        s = resp?.settings || {};
      }

      // Check if user has keys typed into the inline inputs right now
      const inpGemini = (document.querySelector('.ap-inp-gemini')?.value || '').trim();
      const inpGroq = (document.querySelector('.ap-inp-groq')?.value || '').trim();
      if (inpGemini && !s.geminiKey) {
        s.geminiKey = inpGemini;
        await chrome.storage.local.set({ geminiKey: inpGemini });
        ui.apiKeys.geminiKey = inpGemini;
      }
      if (inpGroq && !s.groqKey) {
        s.groqKey = inpGroq;
        await chrome.storage.local.set({ groqKey: inpGroq });
        ui.apiKeys.groqKey = inpGroq;
      }

      const hasKey = !!(s.geminiKey?.trim() || s.groqKey?.trim() || s.openaiKey?.trim());

      if (!hasKey) {
        ui.setRunning(false);
        ui.showSettings = true;
        ui.render();
        ui.setStatus('API Key Required', 'Please enter your Gemini or Groq key above and click "Save Keys".', 'warn');
        ui.addLog('Please enter your Gemini or Groq key in the settings box above.', 'warn');
        return;
      }

      ui.addLog('Starting automated solve flow...', 'ok');

      // 2. Read context from Tab 1
      switchToQuestionTab();
      await sleep(300);
      await handleReadContext();

      let maxAttempts = ui.options.autoRetry ? 5 : 1;
      let feedback = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          ui.addLog(`🔁 [Loop Attempt ${attempt}/${maxAttempts}] Retrying with Tab 2 & Tab 3 feedback...`, 'warn');
        }

        // 3. Generate clean complete replacement using multi-tab feedback
        ui.setStatus(`Attempt ${attempt}/${maxAttempts}: Generating Solution...`, feedback ? 'Refining solution using Tab 2 & Tab 3 failure traces...' : 'Generating initial test-compliant solution...', 'running', true);
        const code = await handleGenerate(feedback);

        // 4. Wipe editor completely and inject code
        ui.setStatus(`Attempt ${attempt}/${maxAttempts}: Injecting Solution...`, 'Wiping editor and writing clean solution...', 'running', true);
        const writeOk = await handleWriteCode();
        if (!writeOk) {
          const targetName = cachedEditor?.activeFile || 'target file';
          ui.addLog(`🛑 Automated submission paused because editor text was not yet replaced cleanly. Please paste the clean code into "${targetName}" and click Solve again to submit!`, 'bad');
          break; // NEVER SUBMIT 501 PLACEHOLDER CODE!
        }

        // 5. Submit solution and track Tab 2
        ui.setStatus(`Attempt ${attempt}/${maxAttempts}: Submitting Solution...`, 'Evaluating solution with test grader...', 'running', true);
        ui.addLog(`Submitting solution to test grader (Attempt ${attempt}/${maxAttempts})...`);
        await sleep(1500);
        const subRes = await handleSubmit();

        const timeStr = subRes?.timestamp || new Date().toLocaleTimeString();
        ui.addLog(`📊 [${timeStr}] Submission Results (Attempt ${attempt}): ${subRes?.passed || 0}/${subRes?.total || 0} passed`, subRes?.ok ? 'ok' : 'warn');

        if (subRes?.tests && subRes.tests.length > 0) {
          for (const t of subRes.tests) {
            if (t.fail) {
              ui.addLog(`   ❌ ${t.name}`, 'bad');
            } else if (t.pass) {
              ui.addLog(`   ✅ ${t.name}`, 'ok');
            }
          }
        }

        if (subRes && subRes.ok) {
          ui.addLog(`🎉 CHALLENGE SOLVED! All ${subRes.passed || 'all'} test cases passed on Attempt ${attempt} (${timeStr})!`, 'ok');
          ui.setStatus('Accepted 🎉', `All ${subRes.passed || 'all'} test cases passed at ${timeStr}!`, 'success');
          break;
        } else if (attempt < maxAttempts) {
          ui.addLog(`⚠️ Attempt ${attempt} finished at ${timeStr}: ${subRes?.passed || 0}/${subRes?.total || 0} test cases passed.`, 'warn');
          ui.addLog('Switching to Terminal (Tab 3) to scrape exact runtime & Mocha failure logs...', 'warn');

          const terminalOutput = await readTerminalOutput(5500);

          // Build rich combined feedback from BOTH Tab 2 (Failed tests) and Tab 3 (Terminal logs)
          const feedbackBlocks = [];
          feedbackBlocks.push(`=== PREVIOUS ATTEMPT ${attempt} FAILED (${subRes?.passed || 0}/${subRes?.total || 0} PASSED AT ${timeStr}) ===`);

          if (subRes?.failedTests && subRes.failedTests.length > 0) {
            feedbackBlocks.push(`FAILED TEST CASES (FROM TAB 2 - ALL SUBMISSIONS TABLE AT ${timeStr}):\n` + subRes.failedTests.map((t) => `- ❌ ${t}`).join('\n'));
          }

          if (terminalOutput && terminalOutput.length > 50) {
            feedbackBlocks.push(`TERMINAL & MOCHA ERROR TRACES (FROM TAB 3):\n\`\`\`\n${terminalOutput.slice(-3500)}\n\`\`\``);
          }

          feedbackBlocks.push(
            `CRITICAL DEBUGGING DIRECTIVES FOR NEXT ATTEMPT:\n` +
            `1. Fix every failed test case listed above from Tab 2.\n` +
            `2. If any timeouts occurred (e.g. "Timeout of 2000ms exceeded"), ensure EVERY route handler calls res.status(...).json(...) or res.send(...) so the request NEVER hangs.\n` +
            `3. For user authentication / Prisma / bcrypt:\n` +
            `   - Validate input: return 400 immediately if email or password is missing or empty string.\n` +
            `   - Check duplicate email: query database first (findUnique/findFirst); return 400 if user exists.\n` +
            `   - Hash password with bcrypt using EXACTLY salt rounds = 10 (await bcrypt.hash(password, 10)).\n` +
            `   - Persist user to PostgreSQL via Prisma (prisma.user.create).\n` +
            `   - NEVER return or expose the password or hash in the response (return user without password).\n` +
            `4. Return the COMPLETE replacement file with clean 2-space indentation.`
          );

          feedback = feedbackBlocks.join('\n\n');
          ui.addLog(`✓ Captured failure context from Tab 2 (${subRes?.failedTests?.length || 0} failed tests) & Tab 3 Terminal (${terminalOutput ? terminalOutput.split('\n').length : 0} log lines).`, 'ok');

          // Switch back to Tab 1 (Question) for the next iteration
          switchToQuestionTab();
          await sleep(1500);
          continue;
        } else {
          ui.addLog(`Reached max attempts (${maxAttempts}). You can click "Solve" to try again with updated feedback.`, 'warn');
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

  // --- Initialize UI ---
  async function init() {
    // Load stored settings directly or via safe message dispatcher
    let settings = {};
    try {
      if (chrome.storage?.local) {
        settings = await chrome.storage.local.get(null);
      }
    } catch (e) {
      console.warn('[AP-Solver] direct storage read fallback:', e);
    }
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
        } else {
          ui.setFileStatus(filePath, 'error');
          ui.addLog(`⚠️ Could not switch to "${filePath}". Please click "${filePath}" tab in VS Code and try again.`, 'warn');
          return false;
        }
      },
      onSubmit: handleSubmit,
      onOptionsChange: (newOpts) => {
        try {
          if (chrome.storage?.local) {
            chrome.storage.local.set(newOpts).catch(() => {});
          }
        } catch (e) {}
        sendMsg({ op: 'AP_SAVE_SETTINGS', data: newOpts }, 4000).catch(() => {});
      }
    });

    let activeProvider = settings.provider || 'groq';
    if (settings.geminiKey?.trim() && !settings.groqKey?.trim()) {
      activeProvider = 'gemini';
    } else if (settings.groqKey?.trim() && !settings.geminiKey?.trim()) {
      activeProvider = 'groq';
    }

    ui.setApiKeys({
      geminiKey: settings.geminiKey || '',
      groqKey: settings.groqKey || ''
    });

    ui.updateOptions({
      autoSubmit: settings.autoSubmit ?? true,
      autoRetry: settings.autoRetry ?? true,
      provider: activeProvider
    });

    // Polling scan: check every 800ms up to 12 times to catch SPA rendered question & test cases
    let scanCount = 0;
    const scanInterval = setInterval(() => {
      scanCount++;
      const q = extractQuestion();
      if (q && q.title && q.title !== 'Newton School') {
        ui.updateProblemInfo({
          title: q.title,
          difficulty: q.difficulty,
          points: q.points,
          testCasesCount: q.testCases.length
        });
        if (q.testCases.length > 0) {
          clearInterval(scanInterval);
        }
      }
      if (scanCount >= 12) {
        clearInterval(scanInterval);
      }
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
