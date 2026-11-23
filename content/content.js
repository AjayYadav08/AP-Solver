// content/content.js - Core Top-Frame Automation Driver for AP-Solver
(() => {
  if (window.top !== window) return; // Only run in top window
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
  function extractQuestion() {
    // 1. Try finding title from header or question pane
    let title = '';
    const headerTitleMatch = document.body.innerText.match(/< Back\s*\|\s*([^\n\r]+)/);
    if (headerTitleMatch && headerTitleMatch[1]) {
      title = headerTitleMatch[1].trim();
    }

    // Try finding QUESTION pane
    const questionPanels = [...document.querySelectorAll('div, section')].filter((el) => {
      const text = el.innerText || '';
      return (
        isVisible(el) &&
        /QUESTION/i.test(text.slice(0, 150)) &&
        /Requirements|Test Cases|Build|Implement/i.test(text)
      );
    });

    const qPanel = questionPanels.sort((a, b) => a.innerText.length - b.innerText.length)[0] || document.body;

    if (!title) {
      const heading = qPanel.querySelector('h1, h2, h3, div[class*="title" i], div[class*="header" i]');
      title = heading ? heading.innerText.trim() : 'Fullstack / API Challenge';
    }

    // Extract difficulty and points
    let difficulty = 'Medium';
    let points = '0/60';
    const diffMatch = qPanel.innerText.match(/\b(Easy|Medium|Hard)\b/i);
    if (diffMatch) difficulty = diffMatch[1];
    const ptsMatch = qPanel.innerText.match(/(\d+\s*\/\s*\d+)\b/);
    if (ptsMatch) points = ptsMatch[1];

    // Extract Test Cases
    const testCases = [];
    const lines = qPanel.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const tcMatch = line.match(/^\d+\.\s+(.+)$/);
      if (tcMatch && tcMatch[1].length > 5) {
        testCases.push(tcMatch[1].trim());
      }
    }

    // Cleaned full description
    const fullText = qPanel.innerText
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

  // --- Section 2: Editor Interaction ---
  async function queryActiveEditor() {
    // Ask background to query all frames in this tab
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ op: 'AP_QUERY_EDITOR' }, (r) => resolve(r));
    });

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
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ op: 'AP_WRITE_EDITOR', data: { code: newCode } }, (r) => resolve(r));
    });

    if (resp && resp.ok) {
      return { ok: true, method: resp.method };
    }

    // Fallback in top document
    const textarea = document.querySelector('.monaco-editor textarea.inputarea');
    if (textarea) {
      textarea.focus();
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, newCode);
      return { ok, method: 'top-execCommand' };
    }

    return { ok: false, error: resp?.error || 'Could not write code into editor' };
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

    const provider = ui.options.provider || 'gemini';
    const providerName = provider === 'gemini' ? 'Gemini 2.5 Flash' : provider === 'groq' ? 'Groq Llama 3.3 70B' : 'OpenAI';

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

    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ op: 'AP_GENERATE', data: { promptData, settingsOverride: ui.options } }, (r) => resolve(r));
    });

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

  async function handleWriteCode() {
    if (!cachedGeneratedCode) {
      alert('No code generated yet. Please click "Generate" or "Solve & Submit Solution".');
      return;
    }

    ui.setStatus('Injecting code into Monaco editor...', '', 'running', true);
    const res = await writeCodeToEditor(cachedGeneratedCode);

    if (res.ok) {
      ui.addLog(`✓ Code successfully injected via ${res.method}!`, 'ok');
      ui.setStatus('Code Injected', 'Editor updated successfully.', 'success');
    } else {
      ui.addLog(`Failed to inject: ${res.error}. Trying clipboard copy fallback...`, 'warn');
      navigator.clipboard.writeText(cachedGeneratedCode);
      ui.setStatus('Code Copied to Clipboard', 'Please focus editor and press Cmd+V / Ctrl+V to paste.', 'error');
    }
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
    ui.setRunning(true);
    try {
      // 1. Read context
      await handleReadContext();

      let maxAttempts = ui.options.autoRetry ? 3 : 1;
      let feedback = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          ui.addLog(`🔁 Auto-Retry Attempt ${attempt}/${maxAttempts}...`, 'warn');
        }

        // 2. Generate
        const code = await handleGenerate(feedback);

        // 3. Write
        await handleWriteCode();

        // 4. Submit if enabled or requested
        if (ui.options.autoSubmit || attempt > 1) {
          ui.addLog('Auto-submitting solution...');
          await sleep(1000);
          const subRes = await handleSubmit();

          if (subRes.ok) {
            ui.addLog(`🎉 Challenge completed on attempt ${attempt}!`, 'ok');
            break;
          } else if (attempt < maxAttempts && subRes.failedTests?.length) {
            feedback = `The following test cases failed on this attempt:\n` +
              subRes.failedTests.map((t) => `- ${t}`).join('\n') +
              `\nPlease re-analyze the logic and fix every failing requirement.`;
            await sleep(2000);
            continue;
          }
        } else {
          ui.addLog('Code injected. Review and click "Submit" to run test cases.', 'ok');
          break;
        }
      }
    } catch (err) {
      console.error('[AP-Solver] One-click solve error:', err);
      ui.addLog(`Stopped: ${err.message}`, 'bad');
    } finally {
      ui.setRunning(false);
    }
  }

  // --- Initialize UI ---
  async function init() {
    // Load stored settings
    const settingsResp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ op: 'AP_GET_SETTINGS' }, (r) => resolve(r));
    });

    const settings = settingsResp?.settings || {};

    ui = new window.APSolverUI({
      onOneClickSolve: handleOneClickSolve,
      onReadContext: handleReadContext,
      onGenerate: () => handleGenerate(),
      onWriteCode: handleWriteCode,
      onSubmit: handleSubmit,
      onOptionsChange: (newOpts) => {
        chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: newOpts });
      }
    });

    ui.updateOptions({
      autoSubmit: settings.autoSubmit ?? false,
      autoRetry: settings.autoRetry ?? true,
      provider: settings.provider || 'gemini'
    });

    // Auto-scan initial question after slight delay for DOM to populate
    setTimeout(async () => {
      const q = extractQuestion();
      if (q && q.title) {
        ui.updateProblemInfo({
          title: q.title,
          difficulty: q.difficulty,
          points: q.points,
          testCasesCount: q.testCases.length
        });
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
