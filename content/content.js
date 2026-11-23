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

    if (resp && resp.ok && resp.code) {
      let activeFile = 'index.js';
      if (resp.uri) {
        const parts = resp.uri.split('/');
        activeFile = parts[parts.length - 1] || 'index.js';
      }
      return {
        code: resp.code,
        language: resp.language || 'javascript',
        activeFile,
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
        activeFile: 'index.js',
        method: 'top-dom'
      };
    }

    return null;
  }

  async function writeCodeToEditor(newCode) {
    // Copy code to real clipboard first
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(newCode);
      }
    } catch(e) {}

    const resp = await sendMsg({ op: 'AP_WRITE_EDITOR', data: { code: newCode } }, 15000);

    if (resp && resp.ok && resp.verified) {
      return { ok: true, verified: true, method: resp.method };
    }

    // Fallback in top document if editor is in top frame with multi-tier Select All & Wipe
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

      // 4. Wipe selected text
      const backspaceEvt = new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(backspaceEvt);
      textarea.value = '';

      // 5. Paste clean code
      const dt = new DataTransfer();
      dt.setData('text/plain', newCode);
      const pasteEvt = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(pasteEvt);
      if (editorDom) editorDom.dispatchEvent(pasteEvt);

      try {
        document.execCommand('insertText', false, newCode);
      } catch(e) {}

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

  // --- Section 3: Submissions & Grader Tracking ---
  function getSubmitButton() {
    return findButton(/^submit solution$/i) || findButton(/^submit$/i);
  }

  function readSubmissionResults() {
    const subPanels = [...document.querySelectorAll('div, section')].filter((el) => {
      const text = el.innerText || '';
      return isVisible(el) && /ALL SUBMISSIONS|LATEST SUBMISSION|TEST CASE NAME/i.test(text);
    });

    if (!subPanels.length) return null;

    const panel = subPanels.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    const text = panel.innerText;

    // Is it still running?
    const isRunning = /Running Test Cases|Checking Submission|evaluat(ing|e)|several minutes/i.test(text);

    // Extract test statuses
    const rows = [...panel.querySelectorAll('div, tr, li')].filter((r) => {
      const t = r.innerText.trim();
      return /^\d+\.\s+/.test(t) && t.length > 5 && isVisible(r);
    });

    const tests = rows.map((row) => {
      const name = row.innerText.trim();
      // Check for green tick SVG or pass class
      const hasGreenTick = !!row.querySelector('path[fill="#009965"], path[fill*="green"], svg.pass, .text-green-500');
      const hasRedCross = !!row.querySelector('path[fill="#ef4444"], path[fill*="red"], svg.fail, .text-red-500');
      return {
        name,
        pass: hasGreenTick,
        fail: hasRedCross,
        pending: !hasGreenTick && !hasRedCross
      };
    });

    return {
      text,
      isRunning,
      tests,
      passedCount: tests.filter((t) => t.pass).length,
      failedCount: tests.filter((t) => t.fail).length,
      totalCount: tests.length
    };
  }

  async function submitAndMonitor(timeoutMs = 90000) {
    const btn = getSubmitButton();
    if (!btn) throw new Error('"Submit Solution" button not found on page.');

    ui.addLog('Clicking "Submit Solution" button...', 'ok');
    btn.click();

    ui.setStatus('Evaluating Submission...', 'Waiting for test grader to run all test cases...', 'running', true);

    const start = Date.now();
    let sawRunning = false;

    while (Date.now() - start < timeoutMs) {
      await sleep(1500);

      const submitBtnText = (getSubmitButton()?.innerText || '').trim();
      if (/Running Test Cases/i.test(submitBtnText)) {
        sawRunning = true;
      }

      const results = readSubmissionResults();
      if (results) {
        if (results.isRunning) {
          sawRunning = true;
          ui.setStatus('Grading in progress...', `${results.passedCount}/${results.totalCount || 'All'} test cases passed so far...`, 'running', true);
          continue;
        }

        if (sawRunning && !results.isRunning && results.totalCount > 0) {
          // Finished
          const allPassed = results.passedCount === results.totalCount;
          return {
            ok: allPassed,
            passed: results.passedCount,
            total: results.totalCount,
            failedTests: results.tests.filter((t) => !t.pass).map((t) => t.name)
          };
        }
      }

      // Check success banner in main text
      if (/Latest Submission is Successful|All test cases passed/i.test(document.body.innerText)) {
        return { ok: true, summary: 'All test cases passed successfully!' };
      }
    }

    return { ok: false, error: 'Grading timed out after 90 seconds. Please check results manually.' };
  }

  // --- High-Level User Actions ---
  async function handleReadContext() {
    ui.setStatus('Reading Question & Editor...', '', 'running', true);
    
    // 1. Read Question
    cachedQuestion = extractQuestion();
    ui.addLog(`Extracted Question: "${cachedQuestion.title}" (${cachedQuestion.testCases.length} test cases)`, 'ok');

    // 2. Read Editor
    cachedEditor = await queryActiveEditor();
    if (cachedEditor) {
      ui.addLog(`Editor detected: "${cachedEditor.activeFile}" (${cachedEditor.code.split('\n').length} lines)`, 'ok');
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

  async function handleGenerate(feedback = null) {
    if (!cachedQuestion) {
      cachedQuestion = extractQuestion();
    }
    if (!cachedEditor) {
      cachedEditor = await queryActiveEditor();
    }

    const provider = ui.options.provider || 'groq';
    const providerName = provider === 'gemini' ? 'Google Gemini (3.8 Flash)' : provider === 'groq' ? 'Groq AI (GPT OSS 120B)' : 'OpenAI';

    ui.setStatus(`Generating solution with ${providerName}...`, feedback ? 'Refining code based on failed test cases...' : 'Crafting 100% test-compliant code...', 'running', true);
    ui.addLog(`Calling AI solver (${providerName})...`);

    const promptData = {
      questionTitle: cachedQuestion.title,
      questionDetails: cachedQuestion.details,
      testCases: cachedQuestion.testCases,
      currentCode: cachedEditor?.code || '',
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
    ui.setGeneratedCode(cachedGeneratedCode);
    ui.addLog(`✓ Solution generated by ${resp.result.model} (${cachedGeneratedCode.split('\n').length} lines)`, 'ok');
    ui.setStatus('Solution Generated', `${cachedGeneratedCode.split('\n').length} lines ready to inject.`, 'success');

    return cachedGeneratedCode;
  }

  // --- Section 4: Left Rail Tabs & Terminal Execution Log Scraper ---
  function getLeftRailTabs() {
    // Find clickable tab items on the vertical left bar (x < 80px)
    const elements = [...document.querySelectorAll('button, [role="tab"], div, a, li')].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        isVisible(el) &&
        r.left >= 0 &&
        r.left < 80 &&
        r.top > 30 &&
        r.top < 400 &&
        r.width >= 16 &&
        r.height >= 16 &&
        !el.closest('#ap-solver-host') &&
        (el.querySelector('svg') || el.innerText.trim() === 'Q' || /tab/i.test(el.getAttribute('role') || ''))
      );
    });

    // Deduplicate elements located at similar vertical Y positions
    const uniqueTabs = [];
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      const existing = uniqueTabs.find((u) => Math.abs(u.getBoundingClientRect().top - r.top) < 10);
      if (!existing) {
        uniqueTabs.push(el);
      }
    }

    uniqueTabs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return uniqueTabs;
  }

  function switchToQuestionTab() {
    const tabs = getLeftRailTabs();
    if (tabs.length >= 1) {
      tabs[0].click();
      return true;
    }
    return false;
  }

  function switchToSubmissionsTab() {
    const tabs = getLeftRailTabs();
    if (tabs.length >= 2) {
      tabs[1].click();
      return true;
    }
    return false;
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

    // 2. 3rd tab on the left rail (Tab index 2: Question -> Submissions -> Terminal)
    const tabs = getLeftRailTabs();
    if (tabs.length >= 3) {
      tabs[2].click();
      return true;
    }
    return false;
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
          (/mocha|npm test|git clone|AssertionError|failing|passing/i.test(text) ||
           /Build a Task Management API|node-20|timeout/i.test(text))
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
    if (!cachedGeneratedCode) {
      alert('No code generated yet. Please click "Solve".');
      return false;
    }

    ui.setStatus('Wiping old code and injecting solution into editor...', '', 'running', true);

    // Guaranteed: copy generated code to system clipboard
    try {
      await navigator.clipboard.writeText(cachedGeneratedCode);
    } catch (e) {}

    const res = await writeCodeToEditor(cachedGeneratedCode);

    // Wait a brief moment for editor to render
    await sleep(800);

    // Verification check: ensure starter code is 100% GONE
    const verifyResp = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 5000);
    const editorText = verifyResp?.code || '';
    const topLines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => l.textContent).join('\n');
    const effectiveText = editorText.length > 50 ? editorText : topLines;

    const hasOld501 = /res\.statusCode\s*=\s*501/i.test(effectiveText);
    const countHttp = (effectiveText.match(/require\(['"](?:node:)?http['"]\)/g) || []).length;
    const isCleanReplacement = effectiveText.length > 80 && !hasOld501 && countHttp <= 1;

    if (isCleanReplacement || res?.verified) {
      ui.addLog(`✓ Editor completely wiped & clean solution injected (${res?.method || 'verified'})!`, 'ok');
      ui.setStatus('Code Injected & Verified', 'Starter code cleared. Solution saved to disk.', 'success');
      return true;
    }

    // If verification failed:
    ui.addLog('⚠️ Could not automatically wipe existing starter code in iframe.', 'bad');
    ui.addLog('📋 Clean solution code has been copied to your clipboard!', 'ok');
    ui.addLog('👉 Please click inside index.js, press Cmd+A (or Ctrl+A), then Cmd+V to replace all, and Cmd+S to save.', 'warn');
    ui.setStatus('Manual Replace Required', 'Press Cmd+A then Cmd+V in index.js to replace starter code.', 'warn');
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

      // 2. Read context
      await handleReadContext();

      let maxAttempts = ui.options.autoRetry ? 3 : 1;
      let feedback = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          ui.addLog(`🔁 Auto-Retry Attempt ${attempt}/${maxAttempts}...`, 'warn');
        }

        // 3. Generate clean complete replacement
        const code = await handleGenerate(feedback);

        // 4. Wipe editor completely and inject code
        const writeOk = await handleWriteCode();
        if (!writeOk) {
          ui.addLog('🛑 Automated submission paused because editor text was not yet replaced cleanly. Please paste the clean code into index.js and click Solve again to submit!', 'bad');
          break; // NEVER SUBMIT 501 PLACEHOLDER CODE!
        }

        // 5. Submit solution
        ui.addLog('Submitting solution to test grader...');
        await sleep(1500);
        const subRes = await handleSubmit();

        if (subRes && subRes.ok) {
          ui.addLog(`🎉 Challenge completed successfully on attempt ${attempt}!`, 'ok');
          break;
        } else if (attempt < maxAttempts) {
          ui.addLog('Checking Test Execution Terminal (Tab 3) for failure logs...', 'warn');
          const terminalOutput = await readTerminalOutput(5000);

          if (terminalOutput && terminalOutput.length > 100) {
            ui.addLog(`✓ Captured failure logs from Terminal (${terminalOutput.split('\n').length} lines). Passing to AI...`, 'ok');
            feedback = `CRITICAL TEST FAILURE TRACE FROM TERMINAL:\n` +
              `\`\`\`\n${terminalOutput.slice(-3500)}\n\`\`\`\n` +
              `The Mocha test runner failed on the above tests. Fix every assertion error, status code, and response format. Ensure complete code replacement.`;
          } else if (subRes?.failedTests?.length) {
            feedback = `The following test cases failed on this attempt:\n` +
              subRes.failedTests.map((t) => `- ${t}`).join('\n') +
              `\nPlease re-analyze the logic and fix every failing requirement.`;
          }

          // Switch back to question tab for next round
          switchToQuestionTab();
          await sleep(2000);
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
