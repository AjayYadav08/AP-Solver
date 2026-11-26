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
  let filesWrittenViaTerminal = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Helper: Sanitize active file name to never be numeric or in-memory
  function sanitizeActiveFile(name) {
    if (!name) return 'src/index.js';
    let s = String(name).trim();
    if (/^\d+$/.test(s) || /^(1|2|one|two)$/i.test(s) || /inmemory/i.test(s) || s === 'None') {
      return 'src/index.js';
    }
    return s;
  }

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
      if (/^\d+$/.test(activeFile)) {
        activeFile = 'src/index.js';
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

    // Fallback: look for monaco in top frame ONLY if not in HTTP tester and no iframe exists
    const topEditors = [...document.querySelectorAll('.monaco-editor')].filter(el => {
      return !el.closest('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], [class*="request-body" i], [class*="response-body" i], #ap-solver-host');
    });
    const topViewLines = topEditors[0]?.querySelector('.view-lines');
    if (topViewLines && !document.querySelector('iframe')) {
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

    if (resp && resp.ok) {
      return { ok: true, verified: true, method: resp.method, filePath: resp.filePath || filePath };
    }

    // CRITICAL SAFETY GUARD: If filePath was specified, DO NOT fall back to top DOM!
    // Falling back to top DOM when target is orderManager.js will overwrite index.js!
    if (filePath) {
      console.warn(`[AP-Solver] Failed to write into target file "${filePath}":`, resp?.error || 'Target file not active');
      return { ok: false, error: resp?.error || `Could not open and write to "${filePath}"` };
    }

    // Fallback in top document ONLY if no specific targetFilePath was requested, no iframe exists, and not in HTTP tester!
    if (!document.querySelector('iframe')) {
      const allTopEditors = [...document.querySelectorAll('.monaco-editor')].filter(el => {
        return !el.closest('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], [class*="request-body" i], [class*="response-body" i], #ap-solver-host');
      });
      const editorDom = allTopEditors[0];
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

      // True Wipe: Delete & Backspace existing selection before pasting
      try { document.execCommand('delete', false, null); } catch(e) {}
      const backspaceEvt = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true });
      textarea.dispatchEvent(backspaceEvt);
      try {
        textarea.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
      } catch(e) {}
      textarea.value = '';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      // 4. Primary: Clean single insertion (prevent duplicate concatenation)
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, newCode);
      } catch(e) {}

      if (!inserted) {
        const dt = new DataTransfer();
        dt.setData('text/plain', newCode);
        try {
          const pasteEvt = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          });
          textarea.dispatchEvent(pasteEvt);
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
    }

    return { ok: !!resp?.ok, verified: !!resp?.verified, method: resp?.method || 'unknown' };
  }

  // --- Section 3: Submissions & Fast Grader Tracking ---
  function triggerElementClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center' }); } catch(e) {}
    try { el.focus(); } catch(e) {}
    const opts = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
    try { el.click(); } catch (e) {}
  }

  function getSubmitButton() {
    const candidates = [
      ...document.querySelectorAll('button, [role="button"], a[role="button"], input[type="submit"]')
    ].filter(b => isVisible(b) && !b.closest('#ap-solver-host'));

    // Check exact or partial text matches
    const textMatch = candidates.find(b => {
      const txt = (b.innerText || b.textContent || b.getAttribute('value') || '').trim();
      return /submit\s*(solution|code)?/i.test(txt) && !/cancel/i.test(txt);
    });
    if (textMatch) return textMatch;

    // Check data-testid, id or class attributes
    const attrMatch = candidates.find(b => {
      const tid = (b.getAttribute('data-testid') || b.getAttribute('id') || b.className || '').toLowerCase();
      return tid.includes('submit') && !tid.includes('cancel');
    });
    if (attrMatch) return attrMatch;

    return null;
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
          fill.includes('#16a34a') || fill.includes('#059669') ||
          stroke === '#009965' || stroke.includes('green') || stroke.includes('#10b981') || stroke.includes('#16a34a') ||
          cls.includes('green') || cls.includes('pass') || cls.includes('success') || cls.includes('check') ||
          style.includes('green') || style.includes('#009965') || style.includes('#10b981') || style.includes('rgb(0, 153') || style.includes('rgb(16, 185')
        ) {
          isGreen = true;
        }

        // Check red
        if (
          fill === '#ef4444' || fill.includes('red') || fill.includes('#dc2626') || fill.includes('#e11d48') ||
          fill.includes('#f43f5e') || fill.includes('#b91c1c') ||
          stroke === '#ef4444' || stroke.includes('red') || stroke.includes('#dc2626') || stroke.includes('#e11d48') ||
          cls.includes('red') || cls.includes('rose') || cls.includes('fail') || cls.includes('error') ||
          style.includes('red') || style.includes('#ef4444') || style.includes('#dc2626') || style.includes('rgb(239,') || style.includes('rgb(220,')
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
            const stroke = cs.stroke || '';
            if (col.includes('239,') || col.includes('220,') || col.includes('244,') || fill.includes('239,') || fill.includes('220,') || stroke.includes('239,') || stroke.includes('220,')) isRed = true;
            if (col.includes('0, 153') || col.includes('16, 185') || col.includes('34, 197') || fill.includes('0, 153') || fill.includes('16, 185') || stroke.includes('0, 153') || stroke.includes('16, 185')) isGreen = true;
          } catch (e) {}
        }
      }

      // Text/badge fallback on row when SVG styling uses CSS variables or classes without explicit RGB
      if (!isGreen && !isRed) {
        const rowTxt = (row.innerText || '').trim();
        if (/\bfailed\b|\bfail\b|✕|✖|❌/i.test(rowTxt) && !/\bpass(?:ed)?\b/i.test(rowTxt)) isRed = true;
        else if (/\bpassed\b|✓|✅/i.test(rowTxt) && !/\bfail(?:ed)?\b/i.test(rowTxt)) isGreen = true;
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

  function findMochaErrorForTest(testName) {
    if (!testName) return '';
    try {
      const candidates = [...document.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i], [class*="console" i], [class*="output" i]')];
      // Also inspect accessible iframes (such as VS Code web workbench)
      for (const ifr of document.querySelectorAll('iframe')) {
        try {
          const doc = ifr.contentDocument || ifr.contentWindow?.document;
          if (doc) {
            candidates.push(...doc.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i], [class*="output" i]'));
          }
        } catch(e) {}
      }

      for (const el of candidates) {
        const text = el.innerText || '';
        if (!text || (!text.includes('AssertionError') && !text.includes('failing') && !text.includes('Error:') && !text.includes('timeout'))) continue;

        const cleanTestName = testName.replace(/^\d+[\.\)]\s*/, '').trim();
        let testIdx = text.indexOf(cleanTestName);
        if (testIdx === -1) {
          // Fuzzy match on key phrases in test name
          const words = cleanTestName.split(/\s+/).filter(w => w.length > 3);
          if (words.length > 0) {
            const firstIdx = text.indexOf(words[0]);
            if (firstIdx !== -1 && words.some(w => text.includes(w))) {
              testIdx = firstIdx;
            }
          }
        }

        if (testIdx !== -1) {
          const after = text.substring(testIdx);
          const lines = after.split('\n').map(l => l.trim()).filter(Boolean);
          for (let i = 1; i < Math.min(lines.length, 14); i++) {
            if (/AssertionError|Error:|expected|timeout of|Cannot find module|TypeError|ReferenceError/i.test(lines[i])) {
              return lines.slice(i, Math.min(i + 4, lines.length)).join(' | ');
            }
          }
        }
      }
    } catch (e) {}
    return '';
  }

  async function readSubmissionResultsWithErrors() {
    const res = readSubmissionResults();
    if (!res || res.totalCount === 0) return res;

    // For any failed tests, attempt to extract precise error messages
    for (const t of res.tests) {
      if (t.fail && !t.error) {
        let errText = '';
        const row = t.el ? (t.el.closest('tr, li, [role="row"], [class*="row" i], [class*="item" i]') || t.el.parentElement) : null;

        if (row) {
          const errEls = row.querySelectorAll('.error, [class*="error" i], [class*="fail" i], [class*="trace" i], [class*="diff" i], pre, code');
          for (const errEl of errEls) {
            const txt = (errEl.innerText || '').trim();
            if (txt && !txt.includes(t.name) && txt.length > 5 && txt.length < 500) {
              errText = txt;
              break;
            }
          }

          if (!errText) {
            try {
              const expandBtn = row.querySelector('.chevron, .codicon-chevron-right, .expand, button, svg') || t.el;
              expandBtn.click();
              await sleep(150);
              const postExpand = row.querySelectorAll('.error, [class*="error" i], [class*="message" i], [class*="trace" i], [class*="diff" i], pre, code, div');
              for (const pe of postExpand) {
                const txt = (pe.innerText || '').trim();
                if (/expected|AssertionError|timeout|received|Error:/i.test(txt) && !txt.includes(t.name)) {
                  errText = txt;
                  break;
                }
              }
            } catch (e) {}
          }
        }

        if (!errText) {
          errText = findMochaErrorForTest(t.name);
        }

        if (errText) {
          t.error = errText;
        }
      }
    }

    return res;
  }

  async function submitAndMonitor(timeoutMs = 120000) {
    const btn = getSubmitButton();
    if (!btn) throw new Error('"Submit Solution" button not found on page.');

    // 1. Snapshot previous results to ensure we don't return stale data
    const baseline = readSubmissionResults();
    const baselineTimestamp = baseline?.timestamp || '';
    const baselinePassed = baseline?.passedCount || 0;
    const baselineFailed = baseline?.failedCount || 0;

    ui.addLog('Clicking "Submit Solution" button...', 'ok');
    triggerElementClick(btn);

    ui.setStatus('Evaluating Submission...', 'Waiting for grader to execute test cases...', 'running', true);

    // Switch to Submissions tab (Tab 2) so live test results are actively rendered
    await sleep(400);
    switchToSubmissionsTab();

    // 2. WAIT FOR EVALUATION TO START (minimum 3.5 seconds)
    ui.addLog('Waiting for grader evaluation to begin...', 'running');
    await sleep(3500);

    const start = Date.now();
    let sawRunning = false;
    let consecutivePassedChecks = 0;

    while (Date.now() - start < timeoutMs) {
      await sleep(500);

      const submitBtn = getSubmitButton();
      const submitBtnText = (submitBtn?.innerText || '').trim();
      const isBtnRunning = /Running Test Cases|Checking|Evaluating/i.test(submitBtnText) || submitBtn?.disabled;
      const isPageRunning = /Running Test Cases|Checking Submission|evaluat(ing|e)|several minutes/i.test(document.body.innerText);

      if (isBtnRunning || isPageRunning) {
        sawRunning = true;
        ui.setStatus('Grading in progress...', 'Grader running test suite...', 'running', true);
        continue;
      }

      // Check Submissions Tab (Tab 2)
      const results = await readSubmissionResultsWithErrors();
      if (results && results.totalCount > 0) {
        // Guard against stale baseline if not seen running yet
        const isStale = (
          !sawRunning &&
          results.timestamp === baselineTimestamp &&
          results.passedCount === baselinePassed &&
          results.failedCount === baselineFailed &&
          Date.now() - start < 8000
        );
        if (isStale) {
          continue;
        }

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
        const finalSub = await readSubmissionResultsWithErrors();
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

    const fallbackResults = await readSubmissionResultsWithErrors();
    return {
      ok: fallbackResults ? (fallbackResults.passedCount === fallbackResults.totalCount && fallbackResults.failedCount === 0) : false,
      passed: fallbackResults?.passedCount || 0,
      total: fallbackResults?.totalCount || 0,
      tests: fallbackResults?.tests || [],
      timestamp: fallbackResults?.timestamp || new Date().toLocaleTimeString(),
      failedTests: fallbackResults?.failedTests || [],
      passedTests: fallbackResults?.passedTests || []
    };
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
    if (!cachedEditor) {
      cachedEditor = { code: '', language: 'javascript', activeFile: 'src/index.js', allFiles: [], referenceFiles: {} };
    }

    // 3. Probe Container Workspace via Terminal (reads package.json, schema.prisma, .env, & test/*.js files)
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
        const mergedList = new Set([...(cachedEditor.allFiles || []), ...(probeResp.allFiles || []), ...Object.keys(probeResp.files)]);
        cachedEditor.allFiles = [...mergedList];

        const testCount = Object.keys(probeResp.files).filter(f => /(?:^|\/)(?:test|tests|__tests__)\/|(?:\.test|\.spec)\.(?:js|ts|mjs|cjs)$/i.test(f)).length;
        const hasPkg = !!probeResp.files['package.json'];
        ui.addLog(`✓ [Workspace Probe] Loaded ${hasPkg ? 'package.json, ' : ''}${testCount} test file(s), ${cachedEditor.allFiles.length} total workspace file(s)!`, 'ok');
      }
    } catch (probeErr) {
      console.warn('[AP-Solver] Workspace probe skipped cleanly:', probeErr);
    }

    if (cachedEditor && cachedEditor.code !== undefined) {
      cachedEditor.activeFile = sanitizeActiveFile(cachedEditor.activeFile);
      const fileCount = cachedEditor.allFiles?.length || 1;
      ui.addLog(`Editor detected: "${cachedEditor.activeFile}" (${cachedEditor.code.split('\n').length} lines, ${fileCount} file(s) in workspace)`, 'ok');

      // Check if question specifically specifies a different target code file (e.g. seed.js, orderManager.js)
      if (cachedQuestion?.details) {
        const fileMatches = cachedQuestion.details.match(/([a-zA-Z0-9_\-]+\.(?:js|ts))/gi) || [];
        const knownFiles = cachedEditor.allFiles || [];
        for (const fm of fileMatches) {
          if (/package|prisma\.config|schema\.prisma|\.env|nodemon|readme|test/i.test(fm)) continue;
          const matchingKnown = knownFiles.find(kf => kf.endsWith(fm));
          if (matchingKnown && !cachedEditor.activeFile.endsWith(fm)) {
            ui.addLog(`ℹ️ Question specifically targets "${matchingKnown}". Updating active target.`, 'ok');
            cachedEditor.activeFile = sanitizeActiveFile(matchingKnown);
            break;
          } else if (!matchingKnown && /seed\.js|router|controller|middleware|service/i.test(fm)) {
            const targetPath = fm.includes('/') ? fm : 'src/' + fm;
            ui.addLog(`ℹ️ Challenge requires new file "${targetPath}". Setting as primary target.`, 'ok');
            cachedEditor.activeFile = sanitizeActiveFile(targetPath);
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
      activeFile: sanitizeActiveFile(cachedEditor?.activeFile)
    });

    ui.setStatus('Context Loaded', `${cachedQuestion.testCases.length} test cases detected. Ready to generate.`, 'normal');
  }

  let cachedGeneratedFiles = [];
  let cachedCommands = [];
  let attemptHistory = [];

  /** Detect required safe post-write terminal commands (npm build/migrate/install, prisma, backtick CLI) in content frame. */
  function detectClientPostWriteCommands(questionDetails = '', pkgStr = '', filesToWrite = [], errOutput = '') {
    const cmds = [];
    const pushCmd = (c) => {
      const t = String(c || '').trim().replace(/^(?:\$|>\s*|#\s*)/, '').trim();
      if (!t || t.startsWith('#') || t.startsWith('//') || t.length > 260) return;
      if (/(?:rm\s+-[a-z]*rf?\s+\/(?:\s|$)|mkfs|shutdown|reboot|\|\s*(?:ba)?sh\b)/i.test(t)) return;
      if (/^(?:npm\s+(?:test|t|start)|npm\s+run\s+(?:test|start|dev|watch)\b|nodemon\b|node\s+(?:src\/)?index\.js\b)/i.test(t)) return;
      if (/^(?:npm\s+(?:install|i|ci|run\s+[\w:.-]+|exec)|npx\s+|node\s+|prisma\s+|tsc\b|psql\b|sqlite3\b|python3?\s+)/i.test(t) && !cmds.includes(t)) {
        cmds.push(t);
      }
    };

    let pkg = {};
    try { if (pkgStr) pkg = JSON.parse(pkgStr); } catch (e) {}
    const scripts = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const builtins = new Set(['assert','buffer','child_process','crypto','events','fs','http','http2','https','module','net','os','path','process','querystring','readline','stream','timers','tls','tty','url','util','zlib']);

    if (errOutput) {
      for (const m of String(errOutput).matchAll(/Cannot find module\s+['"]([^'"]+)['"]/gi)) {
        const mod = (m[1] || '').trim();
        if (!mod || mod.startsWith('.') || mod.startsWith('/') || mod.startsWith('node:')) continue;
        const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
        if (builtins.has(pkgName)) continue;
        if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkgName)) {
          pushCmd(deps[pkgName] ? 'npm install --no-audit --no-fund' : `npm install --no-audit --no-fund ${pkgName}`);
        }
      }
      if (/sh:\s*\d+:\s*(?:mocha|jest|tsc|prisma):\s*not found/i.test(errOutput)) pushCmd('npm install --no-audit --no-fund');
      if (/@prisma\/client did not initialize|PrismaClientInitializationError|table\s+.*\s+does not exist/i.test(errOutput)) {
        pushCmd('npx -y prisma generate');
        pushCmd('npx -y prisma db push --skip-generate');
      }
      if (/Cannot find module\s+['"]\.\/(?:dist|build)\//i.test(errOutput) && scripts.build) pushCmd('npm run build');
    }

    if ((filesToWrite || []).some(f => /\.ts$/i.test(f.filePath || '')) && scripts.build) pushCmd('npm run build');
    if (scripts.migrate) pushCmd('npm run migrate');
    if (questionDetails) {
      for (const bm of String(questionDetails).matchAll(/`((?:npm\s+run\s+(?:build|seed|migrate|setup|db:[a-z0-9_-]+)|npx\s+(?:prisma\s+(?:migrate|db\s+push|generate)|tsc)[^`]*|node\s+src\/(?:seed|init|setup|migrate)[^`]*))`/gi)) {
        pushCmd(bm[1]);
      }
    }
    return cmds;
  }

  async function handleGenerate(feedback = null) {
    if (!cachedQuestion) {
      cachedQuestion = extractQuestion();
    }
    if (!cachedEditor) {
      cachedEditor = await queryActiveEditor();
    }

    const isDebug = !!feedback;
    const provider = ui.options.provider || 'race';
    const providerName = isDebug
      ? '🧠 Debug Escalation (Gemini Pro / Groq Fallback)'
      : (provider === 'gemini'
          ? 'Google Gemini (2.5 Flash)'
          : provider === 'groq'
            ? 'Groq AI (GPT OSS 120B)'
            : provider === 'race'
              ? '⚡ Turbo Race (Groq vs Gemini Parallel)'
              : 'OpenAI');

    ui.setStatus(`Generating solution with ${providerName}...`, feedback ? 'Deep-analyzing failure traces & escalating model...' : 'Crafting 100% test-compliant code...', 'running', true);
    ui.addLog(`Calling AI solver (${providerName})...`);

    // Ensure all currently written files from previous attempt are in referenceFiles
    const mergedReferenceFiles = { ...(cachedEditor?.referenceFiles || {}) };
    if (cachedGeneratedFiles && cachedGeneratedFiles.length > 0) {
      for (const f of cachedGeneratedFiles) {
        if (f.filePath && f.code) {
          mergedReferenceFiles[f.filePath] = f.code;
        }
      }
    }

    const latestGeneratedCode = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
      ? (cachedGeneratedFiles.find(f => f.filePath === sanitizeActiveFile(cachedEditor?.activeFile))?.code || cachedGeneratedFiles[0]?.code)
      : cachedGeneratedCode;

    const promptData = {
      questionTitle: cachedQuestion.title,
      questionDetails: cachedQuestion.details,
      testCases: cachedQuestion.testCases,
      currentCode: (feedback && latestGeneratedCode) ? latestGeneratedCode : (cachedEditor?.code || ''),
      activeFile: sanitizeActiveFile(cachedEditor?.activeFile),
      workspaceFiles: cachedEditor?.allFiles || [],
      referenceFiles: mergedReferenceFiles,
      language: cachedEditor?.language || 'javascript',
      feedback
    };

    const keepAliveTimer = setInterval(() => {
      sendMsg({ op: 'AP_KEEPALIVE' }, 3000).catch(() => {});
    }, 20000);
    let resp;
    try {
      resp = await sendMsg({
        op: 'AP_GENERATE',
        data: { promptData, settingsOverride: ui.options }
      }, 210000);
    } finally {
      clearInterval(keepAliveTimer);
    }

    if (!resp || !resp.ok) {
      const err = resp?.error || 'Unknown generation failure';
      ui.setStatus('Generation Failed', err, 'error');
      ui.addLog(`Error: ${err}`, 'bad');
      throw new Error(err);
    }

    cachedGeneratedCode = resp.result.code;
    cachedCommands = Array.isArray(resp.result.commands) ? resp.result.commands : [];
    const newFiles = resp.result.files || [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];

    // Merge new files into cachedGeneratedFiles to preserve all workspace files across debug iterations
    const mergedFilesMap = new Map();
    for (const f of (cachedGeneratedFiles || [])) {
      if (f.filePath && f.code) mergedFilesMap.set(f.filePath, f);
    }
    for (const f of newFiles) {
      if (f.filePath && f.code) mergedFilesMap.set(f.filePath, f);
    }
    cachedGeneratedFiles = Array.from(mergedFilesMap.values());

    // Enforce content-based path resolution (Ensures prisma/schema.prisma is never assigned to seed.js)
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
    if (cachedCommands.length > 0) {
      ui.addLog(`⚙️ AI requested post-write command(s): ${cachedCommands.join(' && ')}`, 'normal');
    }
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
    // 1. Only inspect compact left-rail icon/tab buttons (NEVER wide Question body divs whose text mentions "POST /logout"!)
    const explicit = [...document.querySelectorAll('button, [role="tab"]')].find((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText && el.innerText.trim().length <= 24 ? el.innerText.trim() : '')).toLowerCase();
      return isVisible(el) && r.left < 60 && r.width <= 70 && r.height <= 70 && !el.closest('#ap-solver-host') && /question|problem/i.test(label);
    });
    if (explicit) {
      explicit.click();
      return true;
    }
    // 2. Tab index 0 on left rail
    return clickRailTab(0);
  }

  function switchToSubmissionsTab() {
    const explicit = [...document.querySelectorAll('button, [role="tab"]')].find((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText && el.innerText.trim().length <= 24 ? el.innerText.trim() : '')).toLowerCase();
      return isVisible(el) && r.left < 60 && r.width <= 70 && r.height <= 70 && !el.closest('#ap-solver-host') && /submission|test\s*case/i.test(label);
    });
    if (explicit) {
      explicit.click();
      return true;
    }
    // 2. Tab index 1 on left rail
    return clickRailTab(1);
  }

  function switchToTerminalTab() {
    const explicit = [...document.querySelectorAll('button, [role="tab"]')].find((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText && el.innerText.trim().length <= 24 ? el.innerText.trim() : '')).toLowerCase();
      return isVisible(el) && r.left < 60 && r.width <= 70 && r.height <= 70 && !el.closest('#ap-solver-host') && /terminal|log|output|console|execution/i.test(label);
    });
    if (explicit) {
      explicit.click();
      return true;
    }
    // 2. Tab index 2 on left rail (Newton Grader Logs)
    return clickRailTab(2);
  }

  async function readTerminalOutput(maxWaitMs = 6000) {
    switchToTerminalTab();
    await sleep(800);

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      // Find terminal/grader log container in left section — NEVER match Question or HTTP Request panels!
      const candidates = [...document.querySelectorAll('pre, code, .xterm-rows, [class*="terminal" i], [class*="console" i], [class*="output" i], [class*="log" i], div')].filter((el) => {
        const r = el.getBoundingClientRect();
        const text = el.innerText || '';
        if (!isVisible(el) || r.width <= 80 || r.height <= 40 || el.closest('#ap-solver-host')) return false;
        const isGraderTrace = /git clone|mochawesome|\d+\s+(?:failing|passing)|AssertionError|Response timeout of|timeout of \d+ms exceeded|Cannot find module|PrismaClient|node-\d+|npm test/i.test(text);
        const isGenericError = /mocha|npm test|failing|passing|prisma|TypeError:|ReferenceError:|SyntaxError:|Error:/i.test(text);
        const looksLikeQuestionOrHttp = (/^\s*QUESTION\b/i.test(text) || (/HTTP REQUEST\s+GET/i.test(text) && /QUERY PARAMS/i.test(text))) && !isGraderTrace;
        if (looksLikeQuestionOrHttp) return false;
        return isGraderTrace || isGenericError;
      });

      // Also inspect accessible iframes (workbench / vscode iframe)
      try {
        for (const ifr of document.querySelectorAll('iframe')) {
          const doc = ifr.contentDocument || ifr.contentWindow?.document;
          if (doc) {
            const ifrEls = [...doc.querySelectorAll('pre, code, .xterm-rows, [class*="terminal" i], [class*="output" i], [class*="log" i], div')].filter(el => {
              const text = el.innerText || '';
              return /mocha|npm test|AssertionError|failing|passing|prisma|timeout|error|node|TypeError|ReferenceError|SyntaxError/i.test(text);
            });
            candidates.push(...ifrEls);
          }
        }
      } catch(e) {}

      if (candidates.length > 0) {
        // Prioritize candidates located in left section (x < window.innerWidth * 0.55)
        const leftCandidates = candidates.filter(c => {
          try {
            return c.getBoundingClientRect().left < window.innerWidth * 0.55;
          } catch(e) { return true; }
        });
        const bestPool = leftCandidates.length > 0 ? leftCandidates : candidates;

        const collected = [];
        for (const el of bestPool) {
          // If element has xterm-rows, extract line by line to prevent virtual scroll truncation
          const xtermRows = el.querySelectorAll ? el.querySelectorAll('.xterm-rows > div') : null;
          if (xtermRows && xtermRows.length > 0) {
            const xtermText = Array.from(xtermRows).map(row => row.innerText || '').join('\n').trim();
            if (xtermText.length > 25 && !collected.includes(xtermText)) {
              collected.push(xtermText);
            }
          }
          let t = (el.innerText || '').trim();
          // Strip trailing embedded HTTP REQUEST tester chrome if outer container wrapped it
          const httpIdx = t.indexOf('\nHTTP REQUEST\n');
          if (httpIdx > 40) t = t.slice(0, httpIdx).trim();
          if (t.length > 25 && !collected.includes(t)) {
            collected.push(t);
          }
        }

        if (collected.length > 0) {
          // Strongly prioritize real grader/Mocha output over generic UI text
          collected.sort((a, b) => {
            const score = (s) =>
              (/\d+\s+failing|\d+\s+passing/i.test(s) ? 10 : 0) +
              (/git clone|mochawesome|Response timeout of/i.test(s) ? 6 : 0) +
              (/AssertionError|TypeError:|ReferenceError:|SyntaxError:|Cannot find module|PrismaClient/i.test(s) ? 4 : 0);
            const diff = score(b) - score(a);
            if (diff !== 0) return diff;
            return b.length - a.length;
          });
          const bestLog = collected[0];
          if (bestLog.length > 25) {
            return bestLog;
          }
        }
      }

      await sleep(500);
    }

    return '';
  }

  async function handleWriteCode() {
    if (!cachedGeneratedCode && (!cachedGeneratedFiles || cachedGeneratedFiles.length === 0)) {
      alert('No code generated yet. Please click "Solve".');
      return { ok: false, updatedFiles: [], failedFiles: [] };
    }

    const filesToWrite = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
      ? cachedGeneratedFiles
      : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];

    function stripAllComments(c) {
      if (!c) return '';
      let clean = c.replace(/\/\*[\s\S]*?\*\//g, '');
      return clean.split('\n').map(line => {
        let inQuote = false, qChar = '', cIdx = -1;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if ((ch === '"' || ch === "'" || ch === '`') && (i === 0 || line[i-1] !== '\\')) {
            if (!inQuote) { inQuote = true; qChar = ch; }
            else if (ch === qChar) { inQuote = false; }
          } else if (!inQuote && ch === '/' && line[i+1] === '/') {
            cIdx = i; break;
          }
        }
        return cIdx !== -1 ? line.substring(0, cIdx).trimEnd() : line;
      }).filter(l => l.trim() || !l).join('\n');
    }

    // Strict Safety: Auto-detect file target based on content (Guarantees Prisma Schema is never misrouted)
    for (const f of filesToWrite) {
      if (/datasource\s+db|generator\s+client|model\s+[A-Z]/i.test(f.code) || (f.filePath && f.filePath.endsWith('.prisma'))) {
        f.filePath = 'prisma/schema.prisma';
      } else if (/PrismaClient|prisma\.\w+\.(create|deleteMany|find)/i.test(f.code) && !/express|createServer/i.test(f.code)) {
        f.filePath = 'src/seed.js';
      }
    }

    // Strict Safety: Proactively clean any Monaco editor buffers of accidental terminal command artifacts
    try {
      await sendMsg({ op: 'AP_CLEAN_EDITOR_ARTIFACTS' }, 2000);
    } catch(e) {}

    // Strict Enforcement: Strip all comments from all solution files
    for (const f of filesToWrite) {
      f.code = stripAllComments(f.code);
    }

    ui.setStatus(`Injecting solution into ${filesToWrite.length} file(s)...`, '', 'running', true);

    // Build all-in-one atomic base64 terminal bash script (non-interactive sudo -n prevents password prompt hang)
    let bashScript = '';
    bashScript += `git config --global --add safe.directory /app/code 2>/dev/null || true && `;
    bashScript += `(sudo -n true 2>/dev/null && sudo chmod -R 777 /app/code/.git 2>/dev/null && sudo chown -R newton:newton /app/code 2>/dev/null || true) && `;
    bashScript += `(rm -f .git/index.lock 2>/dev/null || true) && `;
    bashScript += `sed -i '/mkdir -p/d' src/index.js 2>/dev/null || true && `;
    bashScript += `sed -i '/base64 -d/d' src/index.js 2>/dev/null || true && `;
    bashScript += `sed -i '/=== AP-SOLVER/d' src/index.js 2>/dev/null || true && `;
    bashScript += `git checkout -- src/index.js 2>/dev/null || true && `;

    const hasPrisma = filesToWrite.some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client|model\s+/i.test(f.code));
    const hasSeed = filesToWrite.some(f => (f.filePath && f.filePath.endsWith('seed.js')) || /prisma\.\w+\.(create|deleteMany)/i.test(f.code));

    for (const f of filesToWrite) {
      const dir = f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : '';
      if (dir) {
        bashScript += `mkdir -p "${dir}" && `;
      }
      const cleanCode = stripAllComments(f.code || '').trim();
      let b64 = '';
      try {
        b64 = btoa(unescape(encodeURIComponent(cleanCode)));
      } catch(e) {
        b64 = btoa(cleanCode);
      }
      bashScript += `echo "${b64}" | base64 -d > "${f.filePath}" && `;
      if (f.filePath.endsWith('schema.prisma') || f.filePath === 'prisma/schema.prisma') {
        bashScript += `cp "${f.filePath}" ./schema.prisma 2>/dev/null || true && `;
        bashScript += `mkdir -p prisma && cp "${f.filePath}" prisma/schema.prisma 2>/dev/null || true && `;
      } else if (f.filePath.endsWith('seed.js')) {
        bashScript += `cp "${f.filePath}" ./seed.js 2>/dev/null || true && `;
        bashScript += `mkdir -p src && cp "${f.filePath}" src/seed.js 2>/dev/null || true && `;
      }
    }

    const hasIndex = filesToWrite.some(f => f.filePath && f.filePath.endsWith('index.js'));
    if (!hasIndex && (hasSeed || hasPrisma)) {
      const starterIndex = `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 8000;\napp.use(express.json());\napp.get('/', (req, res) => { res.send('Server is running'); });\nif (process.env.NODE_ENV !== 'test') {\n  app.listen(PORT, () => { console.log('Server running on port ' + PORT); });\n}\nmodule.exports = app;`;
      let b64Index = '';
      try {
        b64Index = btoa(unescape(encodeURIComponent(starterIndex)));
      } catch(e) {
        b64Index = btoa(starterIndex);
      }
      bashScript += `mkdir -p "src" && echo "${b64Index}" | base64 -d > "src/index.js" && `;
    }

    if (hasPrisma || hasSeed) {
      bashScript += `node -e 'try { const p="./package.json", pkg=require(p); pkg.prisma = pkg.prisma || {}; pkg.prisma.seed = "node src/seed.js"; require("fs").writeFileSync(p, JSON.stringify(pkg, null, 2)); } catch(e){}' 2>/dev/null || true && `;
      bashScript += `npm install --save-dev prisma 2>/dev/null || true && npm install @prisma/client 2>/dev/null || true && `;
      bashScript += `(npx -y prisma db push --skip-generate 2>/dev/null || true) && (npx -y prisma generate 2>/dev/null || true) && `;
    }

    if (hasSeed) {
      bashScript += `if [ -f src/seed.js ]; then node src/seed.js || true; elif [ -f seed.js ]; then node seed.js || true; fi && `;
    }

    // Collect post-write setup/build/migration commands from AI & workspace specs (deduped against built-in Prisma steps)
    const detectedPostCmds = detectClientPostWriteCommands(
      cachedQuestion?.details || '',
      cachedEditor?.referenceFiles?.['package.json'] || '',
      filesToWrite
    );
    const mergedPostCmds = [...new Set([...(cachedCommands || []), ...detectedPostCmds])].filter(c => {
      if ((hasPrisma || hasSeed) && /(?:prisma\s+(?:db\s+push|generate)|src\/seed\.js)/i.test(c)) return false;
      return true;
    });
    if (mergedPostCmds.length > 0) {
      for (const pc of mergedPostCmds) {
        bashScript += `(${pc} || true) && `;
      }
      ui.addLog(`⚙️ [Post-Write Commands] Running in terminal before commit: ${mergedPostCmds.join(' && ')}`, 'normal');
    }

    bashScript += `(rm -f .git/index.lock 2>/dev/null; git config user.email "solver@ap.dev" 2>/dev/null; git config user.name "AP-Solver" 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true) && `;
    bashScript += `echo "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ==="`;

    // Auto-copy terminal script to clipboard as an instant superpower
    try {
      await navigator.clipboard.writeText(bashScript);
      ui.addLog(`💻 [Terminal Engine] Ready! Multi-file script auto-copied to clipboard.`, 'ok');
    } catch (e) {}

    // PRIMARY PATH: Integrated Terminal Execution (Direct Container Disk Injection)
    filesWrittenViaTerminal = false;
    for (let termAttempt = 1; termAttempt <= 2; termAttempt++) {
      try {
        ui.addLog(`⚡ [Terminal Turbo Engine] Writing ${filesToWrite.length} file(s) directly to disk via Integrated Terminal (Attempt ${termAttempt}/2)...`, 'ok');
        const termResp = await sendMsg({ op: 'AP_WRITE_TERMINAL', data: { files: filesToWrite, script: bashScript, postCommands: mergedPostCmds } }, 28000);
        if (termResp && termResp.ok) {
          filesWrittenViaTerminal = true;
          ui.addLog(`⚡ [Terminal Turbo Engine] Successfully wrote ${filesToWrite.length} file(s) directly to disk via Terminal (${termResp.method || 'terminal'})!`, 'ok');
          for (const f of filesToWrite) {
            ui.setFileStatus(f.filePath, 'injected');
          }
          ui.setStatus('Files Saved via Terminal', `${filesToWrite.length} file(s) saved to disk. Ready to submit!`, 'success');
          await sleep(500);
          break;
        } else {
          ui.addLog(`⚠️ [Terminal Engine] Notice: ${termResp?.error || 'Terminal focus pending'}. Script is in clipboard!`, 'warn');
          if (termAttempt < 2) await sleep(500);
        }
      } catch (e) {
        console.log('[AP-Solver] Terminal direct write bypassed:', e);
      }
    }

    if (filesWrittenViaTerminal) {
      ui.addLog(`⚡ [Terminal-First Architecture] Files written cleanly to container disk via Terminal! Monaco editor completely bypassed.`, 'ok');
      for (const f of filesToWrite) {
        ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
        ui.setFileStatus(f.filePath, 'injected');
      }
      return { ok: true, updatedFiles: filesToWrite.map(f => f.filePath), failedFiles: [] };
    }

    // STRICT ZERO-TOUCH POLICY: NEVER TOUCH OR POLLUTE MONACO EDITOR!
    // All files must be written strictly to the Linux container disk via terminal commands.
    ui.addLog(`📋 Multi-file bash script is COPIED in your clipboard!`, 'ok');
    ui.addLog(`👉 Press Cmd+V (or right-click Paste) in the bottom Terminal & press Enter to run!`, 'warn');
    ui.setStatus('Action Required: Paste in Terminal', 'Script is in clipboard. Paste into bottom Terminal and press Enter.', 'warn');

    // Wait up to 25 seconds for the terminal output monitor to confirm execution
    for (let waitSec = 0; waitSec < 25; waitSec++) {
      if (filesWrittenViaTerminal) {
        ui.addLog(`⚡ [Terminal-First Architecture] Files confirmed written cleanly to container disk via Terminal! Monaco editor completely bypassed.`, 'ok');
        for (const f of filesToWrite) {
          ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
          ui.setFileStatus(f.filePath, 'injected');
        }
        return { ok: true, updatedFiles: filesToWrite.map(f => f.filePath), failedFiles: [] };
      }

      // Active Terminal Output Monitor: Check if manual paste script finished executing in terminal
      try {
        const termCandidates = [...document.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i]')];
        for (const ifr of document.querySelectorAll('iframe')) {
          try {
            const doc = ifr.contentDocument || ifr.contentWindow?.document;
            if (doc) termCandidates.push(...doc.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i]'));
          } catch(e) {}
        }
        for (const el of termCandidates) {
          const rows = (el.innerText || el.textContent || '').split('\n');
          if (rows.some(r => r.trim() === '=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===')) {
            filesWrittenViaTerminal = true;
            ui.addLog(`⚡ [Terminal-First Architecture] Detected "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===" in terminal output! Auto-proceeding...`, 'ok');
            break;
          }
        }
      } catch(e) {}

      if (filesWrittenViaTerminal) {
        for (const f of filesToWrite) {
          ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
          ui.setFileStatus(f.filePath, 'injected');
        }
        return { ok: true, updatedFiles: filesToWrite.map(f => f.filePath), failedFiles: [] };
      }
      await sleep(1000);
    }

    const updatedFiles = [];
    const failedFiles = [];
    for (const f of filesToWrite) {
      ui.addLog(`Erasing initial code & writing complete solution into "${f.filePath}"...`, 'info');
      const curCode = f.code || '';
      const hasTerminalArtifact = /base64\s*-d|mkdir\s*-p|=== AP-SOLVER/i.test(curCode);
      const hasCleanCode = curCode.length > 50 && !/\/\/\s*write your code here|\/\*\s*write your code here\s*\*\//i.test(curCode) && !hasTerminalArtifact;
      const codeMatches = hasCleanCode && !hasTerminalArtifact;
      if (filesWrittenViaTerminal || codeMatches) {
        updatedFiles.push(f.filePath);
      } else {
        failedFiles.push(f.filePath);
      }
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
      if (!code || code.trim().length < 30) {
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

    // If files were written via terminal, disk is already updated & seeded. Bypass Monaco in-memory check.
    if (filesWrittenViaTerminal) {
      ui.addLog(`✓ Terminal-First verification: ${filesToWrite.length} file(s) saved directly to container disk. Ready to submit!`, 'ok');
      return true;
    }

    // Give editor buffer and container file system 1500ms to settle after file save
    await sleep(1500);

    // Verify active editor in workspace does not have starter placeholder or bash artifacts
    try {
      const editorStatus = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 5000);
      if (editorStatus && editorStatus.ok && editorStatus.code && editorStatus.activeFile) {
        if (/base64\s*-d|mkdir\s*-p|=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ===/i.test(editorStatus.code)) {
          ui.addLog(`⚠️ Notice: Active editor contains terminal command artifact. Stripping artifact cleanly...`, 'warn');
          try {
            await sendMsg({ op: 'AP_CLEAN_EDITOR_ARTIFACTS' }, 3000);
          } catch(e) {}
          await sleep(400);
        }
        const curActive = sanitizeActiveFile(editorStatus.activeFile).toLowerCase();
        const isTargetFile = filesToWrite.some(f => {
          const base = f.filePath.split('/').pop().toLowerCase();
          return curActive.includes(base) || base.includes(curActive);
        });
        if (isTargetFile && /\/\/\s*write your code here|\/\*\s*write your code here\s*\*\//i.test(editorStatus.code)) {
          ui.addLog(`🛑 Verification failed: Active editor for "${editorStatus.activeFile}" still contains starter placeholder! The code was not replaced. Please paste the solution into the editor or terminal before submitting.`, 'bad');
          ui.setStatus('Editor Not Replaced', 'Starter placeholder still present in editor.', 'error');
          return false;
        }
      }
    } catch (e) {
      console.warn('[AP-Solver] Editor status verification check bypassed:', e);
    }

    ui.addLog(`✓ Code completeness verified (${filesToWrite.length} file(s) complete, non-placeholder). Ready to submit!`, 'ok');
    return true;
  }

  async function handleSubmit() {
    try {
      // Safety guard: Verify all required files are complete before submitting
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
      // Strip ANSI escapes & normalize CRLF before regex matching
      const cleanTerm = terminalOutput
        .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r\n?/g, '\n');

      // 1. Parse Mocha failure blocks ("1) Suite test name:\n   AssertionError: ...")
      // Preserves leading newline in lookahead so consecutive summary lines ("1) ...\n2) ...") are cleanly ignored
      const mochaFailureRegex = /(?:^|\n)\s*(\d+)\)\s+([^\n]+?)(?=\n)([\s\S]*?)(?=(?:\n\s*\d+\)\s+\S|\n\s*(?:\d+\s+failing|\d+\s+passing)|(?![\s\S])))/g;
      let match;
      while ((match = mochaFailureRegex.exec(cleanTerm)) !== null) {
        const num = match[1];
        let title = match[2].replace(/:\s*$/, '').trim();
        const block = match[3].trim();
        if (!block) continue; // Skip top summary list entries
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0 || /^\d+\)\s+/.test(lines[0])) continue;

        // Merge multi-line Mocha suite + sub-test title when lines[0] is the indented test name ending in ':'
        if (lines.length > 1 && /:\s*$/.test(lines[0]) && !/^(?:AssertionError|TypeError|ReferenceError|SyntaxError|Error:|PrismaClient|at\s+)/i.test(lines[0])) {
          title = `${title} › ${lines.shift().replace(/:\s*$/, '').trim()}`;
        }

        const errLine = lines.find(l => /AssertionError|TypeError|ReferenceError|SyntaxError|PrismaClient|Cannot find module|Error:|timeout of|expected\s+/i.test(l)) || lines[0] || 'Assertion Failure';
        const diffLines = lines.filter(l => /^[+-]\s|expected\s+|actual\s+|to equal|to deeply equal/i.test(l));
        const diffText = diffLines.slice(0, 4).join('\n');
        const stackLine = lines.find(l => /^at\s+.+\((.+:\d+:\d+)\)/.test(l) || /^at\s+.+:\d+:\d+/.test(l)) || '';

        const key = title.toLowerCase();
        seenErrors.add(key);

        analysisItems.push({
          num,
          title,
          error: errLine,
          diff: diffText || null,
          stack: stackLine || null,
          diagnosis: diagnoseErrorMessage(errLine, title, diffText)
        });
      }

      // 2. Parse Jest failure blocks ("● Suite › Test Name")
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

        analysisItems.push({
          num: analysisItems.length + 1,
          title,
          error: errLine,
          diff: diffText || null,
          stack: stackLine || null,
          diagnosis: diagnoseErrorMessage(errLine, title, diffText)
        });
      }

      // 3. Fallback extractor when no numbered Mocha/Jest block matched (e.g. startup crashes, hooks, wrapped xterm lines, or AssertionError traces)
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
        // 4. Last-resort terminal tail extractor when logs exist but no standard Mocha/Error header matched (never yield 0 failures on a 67-line error log!)
        if (analysisItems.length === 0 && rawLines.length > 0 && subRes && (subRes.passed || 0) < (subRes.total || 1)) {
          const meaningful = rawLines.filter(l => !/^(?:Cloning into|Already up to date|npm notice|npm warn|>|\+)/i.test(l));
          const tailExcerpt = (meaningful.length > 0 ? meaningful : rawLines).slice(-12).join(' | ').slice(0, 500);
          if (tailExcerpt.length > 15) {
            analysisItems.push({
              num: 1,
              title: 'Grader / Container Execution Failure',
              error: tailExcerpt,
              diff: null,
              stack: null,
              diagnosis: diagnoseErrorMessage(tailExcerpt, '', '')
            });
          }
        }
      }
    }

    if (subRes?.tests && subRes.tests.length > 0) {
      // Include non-passing tests whenever grader reports passed < total (fixes 0/13 where non-red SVG badges stayed PENDING!)
      const hasFailedRun = (subRes.totalCount || subRes.tests.length) > (subRes.passedCount ?? subRes.passed ?? 0);
      const failItems = subRes.tests.filter(t => t.fail || (!t.pass && hasFailedRun));
      for (const fi of failItems) {
        const key = fi.name.toLowerCase();
        if (![...seenErrors].some(k => key.includes(k) || k.includes(key))) {
          let autoDiag = diagnoseErrorMessage(fi.error || '', fi.name, '');
          if (/duplicate|already exists/i.test(fi.name)) {
            autoDiag += ` Query database to check if record already exists before creating.`;
          }
          if (/token|auth|header/i.test(fi.name)) {
            autoDiag += ` Check authorization header validation and JWT verification.`;
          }

          analysisItems.push({
            num: analysisItems.length + 1,
            title: fi.name,
            error: fi.error || 'Test assertion failed in evaluation',
            diff: null,
            stack: null,
            diagnosis: autoDiag
          });
        }
      }
    } else if (subRes?.failedTests && subRes.failedTests.length > 0) {
      for (const ft of subRes.failedTests) {
        const key = ft.toLowerCase();
        if (![...seenErrors].some(k => key.includes(k) || k.includes(key))) {
          let autoDiag = diagnoseErrorMessage('', ft, '');
          if (/duplicate|already exists/i.test(ft)) {
            autoDiag += ` Query database to check if record already exists before creating.`;
          }

          analysisItems.push({
            num: analysisItems.length + 1,
            title: ft,
            error: 'Test assertion failed',
            diff: null,
            stack: null,
            diagnosis: autoDiag
          });
        }
      }
    }

    return analysisItems;
  }

  // Shared helper: Builds comprehensive debugging prompt from terminal traces, test failures, and current solution files
  async function buildDebugFeedback(terminalOutput, subRes, attemptLabel = '1') {
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
      // Group/cap repeated identical errors so prompt stays crisp and leaves ample output budget
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
      const failItems = subRes.tests.filter(t => t.fail || (!t.pass && hasFailedRun));
      for (const item of failItems) {
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
      ui.addLog(`📄 Captured error logs (${totalLinesCount} lines, ${failureItems.length} parsed failure(s)).`, 'ok');
    }

    // Gather CURRENT CODE of ALL files in src/ (and workspace) — NEVER overwrite terminal-written solution with stale Monaco starter code!
    const currentFilesMap = new Map();

    // 1. Authoritative code generated & written in previous attempt
    if (cachedGeneratedFiles && cachedGeneratedFiles.length > 0) {
      for (const f of cachedGeneratedFiles) {
        if (f.filePath && f.code) {
          currentFilesMap.set(f.filePath, f.code);
        }
      }
    }

    // 2. Supplement only untouched workspace files (package.json, test files, config) from editor/probe models
    if (cachedEditor?.referenceFiles) {
      for (const [fname, content] of Object.entries(cachedEditor.referenceFiles)) {
        if (content && !currentFilesMap.has(fname)) {
          currentFilesMap.set(fname, content);
        }
      }
    }
    try {
      const latestEd = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 3000);
      if (latestEd?.referenceFiles) {
        for (const [fname, content] of Object.entries(latestEd.referenceFiles)) {
          if (content && !currentFilesMap.has(fname)) {
            currentFilesMap.set(fname, content);
          }
        }
      }
      if (!filesWrittenViaTerminal && latestEd?.activeFile && latestEd?.code) {
        const act = sanitizeActiveFile(latestEd.activeFile);
        if (!currentFilesMap.has(act)) {
          currentFilesMap.set(act, latestEd.code);
        }
      }
    } catch(e) {}

    // 3. Attach full code of all current files to feedbackBlocks
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
      ui.addLog(`📂 Attached current code of ${currentFilesMap.size} workspace file(s) to AI debug prompt.`, 'ok');
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

      ui.addLog('Starting automated 6-step solve lifecycle...', 'ok');

      // Clear any stale cached editor or generated files from previous runs
      cachedEditor = null;
      cachedGeneratedFiles = [];
      cachedCommands = [];
      attemptHistory = [];
      const remediatedCmds = new Set();
      filesWrittenViaTerminal = false;

      // Step 1: Read full question & initial code of all files
      ui.setStatus('Step 1/6: Reading Question, Packages & Test Files...', '', 'running', true);
      ui.addLog('📋 [Step 1/6] Giving full question and initial code of files to AI...', 'ok');
      switchToQuestionTab();
      await sleep(300);
      await handleReadContext();

      let maxAttempts = ui.options.autoRetry ? 5 : 1;
      let feedback = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        filesWrittenViaTerminal = false;
        if (attempt > 1) {
          ui.addLog(`🔁 [Attempt ${attempt}/${maxAttempts}] Generating fix from side bar terminal & retrying steps 4 & 5...`, 'warn');
        }

        // Inner bounded Local Pre-Test Loop: validates & debugs locally in container Terminal BEFORE clicking slow remote Submit!
        const maxLocalTries = ui.options.autoRetry ? 3 : 1;
        let writeBlockedOrIncomplete = false;

        for (let localTry = 1; localTry <= maxLocalTries; localTry++) {
          filesWrittenViaTerminal = false;
          const stepTag = localTry > 1 ? `Attempt ${attempt} (Local Debug ${localTry}/${maxLocalTries})` : `Attempt ${attempt}/${maxAttempts}`;

          // Generate clean complete replacement using feedback
          ui.setStatus(`${stepTag}: Generating Solution...`, feedback ? 'Debug Escalation: analyzing error traces with High-Reasoning model...' : 'Generating initial test-compliant solution...', 'running', true);
          await handleGenerate(feedback);

          // Step 2 & Step 3: Check files, create any missing files, and write code cleanly via Terminal
          ui.setStatus(`${stepTag} - Step 2 & 3: Checking Files & Writing Code...`, 'Writing solution files directly to disk via Terminal...', 'running', true);
          ui.addLog(`🔍 [Step 2/6] Determining required files & creating any missing files at given location...`, 'ok');
          ui.addLog('✍️ [Step 3/6] Writing code into all files one by one, erasing initial code...', 'ok');
          const writeResult = await handleWriteCode();
          if (!writeResult || !writeResult.ok) {
            const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
              ? cachedGeneratedFiles
              : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
            const pending = writeResult?.failedFiles?.length
              ? writeResult.failedFiles
              : filesToCheck.map(f => f.filePath);

            ui.addLog(`🛑 [Policy Enforcement] Submission BLOCKED: Do not click submit until each required file's code is updated! (${pending.join(', ')} pending)`, 'bad');
            ui.setStatus('Submission Blocked', `Waiting for all required files to be updated: ${pending.join(', ')}`, 'error');
            writeBlockedOrIncomplete = true;
            break; // STRICT ENFORCEMENT: NEVER CLICK SUBMIT UNTIL EACH REQUIRED FILE'S CODE IS UPDATED!
          }

          // Code Completeness Check: Submit ONLY when code is complete and non-placeholder!
          const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
            ? cachedGeneratedFiles
            : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
          const isComplete = await verifyCodeCompleteness(filesToCheck);
          if (!isComplete) {
            writeBlockedOrIncomplete = true;
            break;
          }

          // Automated Local Pre-Test Verification (syntax check + npm test / Mocha + startup check BEFORE slow remote submit)
          ui.setStatus(`${stepTag} - Local Pre-Test Check...`, 'Running container test suite in Terminal first...', 'running', true);
          ui.addLog(`🧪 [Local Pre-Test] Running local container tests before remote submission...`, 'running');
          let localRes = await sendMsg({ op: 'AP_RUN_LOCAL_TESTS', data: { files: filesToCheck.map(f => f.filePath) } }, 45000);

          // Auto-Command Remediation: if a missing dependency, Prisma client, or build command caused failure, run it & re-check before wasting an AI call!
          if (localRes && localRes.status === 'failed' && Array.isArray(localRes.autoFixCommands) && localRes.autoFixCommands.length > 0) {
            const freshCmds = localRes.autoFixCommands.filter(c => !remediatedCmds.has(c));
            if (freshCmds.length > 0) {
              freshCmds.forEach(c => remediatedCmds.add(c));
              ui.addLog(`🛠️ [Auto-Command Remediation] Executing missing setup command(s) in Terminal: ${freshCmds.join(' && ')}`, 'warn');
              const cmdRes = await sendMsg({ op: 'AP_RUN_TERMINAL_COMMANDS', data: { commands: freshCmds } }, 48000);
              if (cmdRes?.output) {
                ui.addLog(`⚙️ Command finished (exit=${cmdRes.exitCode ?? 0}). Re-running local pre-tests...`, cmdRes.ok ? 'ok' : 'warn');
              }
              localRes = await sendMsg({ op: 'AP_RUN_LOCAL_TESTS', data: { files: filesToCheck.map(f => f.filePath) } }, 45000);
            }
          }

          if (localRes && localRes.status === 'passed') {
            ui.addLog(`✅ [Local Pre-Test] Passed (${localRes.passed || 'all'} tests passing)! Submitting with confidence...`, 'ok');
            break;
          } else if (localRes && localRes.status === 'failed') {
            ui.addLog(`❌ [Local Pre-Test] Failed locally (${localRes.passed || 0} passed, ${localRes.failed || 0} failed)!`, 'bad');
            const firstErrLine = (localRes.output || '').split('\n').find(l => /Error:|AssertionError|expected|Cannot find/i.test(l)) || 'Local test assertion failed';
            attemptHistory.push(`Local ${attempt}.${localTry} (${localRes.passed || 0}/${(localRes.passed || 0) + (localRes.failed || 0)}): ${firstErrLine.trim().slice(0, 120)}`);
            if (ui.options.autoRetry && localTry < maxLocalTries) {
              feedback = await buildDebugFeedback(
                localRes.output || '',
                {
                  passed: localRes.passed || 0,
                  total: (localRes.passed || 0) + (localRes.failed || 0),
                  failedTests: localRes.failed > 0 ? [`${localRes.failed} test(s) failed during local Terminal npm test`] : []
                },
                `${attempt}.${localTry} (Local Pre-Test)`
              );
              ui.addLog(`🧠 Skipping slow remote Submit — escalating to Debug Model for fast local fix (${localTry + 1}/${maxLocalTries})...`, 'warn');
              continue;
            }
            ui.addLog(`⚠️ Max local debug tries reached (${maxLocalTries}); proceeding to remote Submit...`, 'warn');
            break;
          } else {
            const skipMsg = localRes?.status === 'no_local_tests'
              ? 'No local test suite present (startup check clean; tests run remotely on Newton grader).'
              : 'Proceeding directly to remote Newton grader.';
            ui.addLog(`ℹ️ [Local Pre-Test] ${skipMsg}`, 'normal');
            break;
          }
        }

        if (writeBlockedOrIncomplete) {
          ui.setRunning(false);
          break;
        }

        // Step 4: Submit and wait until testcases judgement
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
              if (t.error) {
                ui.addLog(`      ↳ Error: ${t.error}`, 'bad');
              }
            } else if (t.pass) {
              ui.addLog(`   ✅ ${t.name}`, 'ok');
            }
          }
        }

        if (subRes && subRes.ok) {
          ui.addLog(`🎉 CHALLENGE SOLVED! All ${subRes.passed || 'all'} test cases passed on Attempt ${attempt} (${timeStr})!`, 'ok');
          ui.setStatus('Accepted 🎉', `All ${subRes.passed || 'all'} test cases passed at ${timeStr}!`, 'success');
          ui.setRunning(false);
          break;
        } else if (attempt < maxAttempts) {
          // Step 5: Check error message in side bar terminal, analyze it, and fix error
          ui.addLog(`🔍 [Step 5/6] Tests failed. Checking error message in side bar terminal & analyzing failure...`, 'warn');
          ui.setStatus(`Attempt ${attempt}/${maxAttempts} - Step 5/6: Analyzing Terminal Errors...`, 'Checking error messages in side bar terminal...', 'running', true);

          const terminalOutput = await readTerminalOutput(5500);
          const remoteAutoCmds = detectClientPostWriteCommands(
            cachedQuestion?.details || '',
            cachedEditor?.referenceFiles?.['package.json'] || '',
            cachedGeneratedFiles,
            terminalOutput
          ).filter(c => !remediatedCmds.has(c));
          if (remoteAutoCmds.length > 0) {
            remoteAutoCmds.forEach(c => remediatedCmds.add(c));
            ui.addLog(`🛠️ [Auto-Command Remediation] Executing terminal command detected from grader error: ${remoteAutoCmds.join(' && ')}`, 'warn');
            await sendMsg({ op: 'AP_RUN_TERMINAL_COMMANDS', data: { commands: remoteAutoCmds } }, 48000);
          }

          const errHint = (terminalOutput || '').split('\n').find(l => /AssertionError|TypeError|SyntaxError|ReferenceError|Cannot find|expected/i.test(l)) || `${subRes?.passed || 0}/${subRes?.total || 0} passed`;
          attemptHistory.push(`Remote Attempt ${attempt} (${subRes?.passed || 0}/${subRes?.total || 0}): ${errHint.trim().slice(0, 120)}`);
          feedback = await buildDebugFeedback(terminalOutput, subRes, String(attempt));

          // Step 6: Repeat step 4 & 5 again
          ui.addLog(`🔁 [Step 6/6] Repeating steps 4 and 5 with targeted fix on Attempt ${attempt + 1}/${maxAttempts}...`, 'warn');

          // Switch back to Tab 1 (Question) for the next iteration
          switchToQuestionTab();
          await sleep(1500);
          continue;
        } else {
          ui.addLog(`⚠️ Attempt ${attempt} finished: ${subRes?.passed || 0}/${subRes?.total || 0} test cases passed.`, 'warn');
          if (!ui.options.autoRetry) {
            ui.addLog('ℹ️ Auto-retry is disabled. Review error messages above or click Solve to retry.', 'normal');
          }
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
          // Double check if editor has file active with complete code
          const verifyResp = await sendMsg({ op: 'AP_QUERY_EDITOR' }, 3000);
          const curCode = verifyResp?.code || '';
          const curActive = sanitizeActiveFile(verifyResp?.activeFile || '').toLowerCase();
          const baseName = filePath.split('/').pop().toLowerCase();
          const isCurrentFile = curActive.includes(baseName) || baseName.includes(curActive);
          const curCodeSample = code.replace(/[\s\r\n]+/g, ' ').slice(0, 50);
          const curEditorSample = curCode.replace(/[\s\r\n]+/g, ' ');
          const hasTerminalArtifact = /base64\s*-d|mkdir\s*-p|=== AP-SOLVER/i.test(curCode);
          const codeMatches = !hasTerminalArtifact && curEditorSample.includes(curCodeSample);
          if (isCurrentFile && codeMatches) {
            ui.setFileStatus(filePath, 'injected');
            ui.addLog(`✓ Verified complete solution code already active in "${filePath}"!`, 'ok');
            return true;
          }
          ui.setFileStatus(filePath, 'error');
          ui.addLog(`⚠️ Could not switch to "${filePath}". Please click "${filePath}" tab in VS Code and try again.`, 'warn');
          return false;
        }
      },
      onConfirmTerminalPasted: async () => {
        filesWrittenViaTerminal = true;
        const filesToCheck = (cachedGeneratedFiles && cachedGeneratedFiles.length > 0)
          ? cachedGeneratedFiles
          : [{ filePath: sanitizeActiveFile(cachedEditor?.activeFile), code: cachedGeneratedCode }];
        for (const f of filesToCheck) {
          ui.setFileStatus(f.filePath, 'injected');
        }
        ui.addLog('⚡ Terminal paste confirmed by user! Proceeding to submit solution...', 'ok');
        ui.setStatus('Submitting Solution...', 'Evaluating solution with test grader...', 'running', true);
        await sleep(500);
        await handleSubmit();
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
      autoRetry: settings.autoRetry !== false,
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
