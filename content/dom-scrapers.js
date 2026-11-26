// content/dom-scrapers.js - Scrapers for Question (Tab 1), Submissions/Testcases (Tab 2) & Terminal Logs (Tab 3)
(() => {
  if (window.top !== window) return;
  if (!/(^|\.)newtonschool\.co$/i.test(location.hostname)) return;

  const AP = (window.__AP = window.__AP || {});

  function getQuestionContainer() {
    const candidates = [...document.querySelectorAll('div, section, main')].filter((el) => {
      const text = el.innerText || '';
      return (
        AP.isVisible(el) &&
        text.length > 80 &&
        /Requirements|Test Cases|Given Task Data|Implement the following|Method\s+Endpoint/i.test(text) &&
        !el.closest('#ap-solver-host') &&
        !el.querySelector('.monaco-editor')
      );
    });
    const leftCandidates = candidates.filter((el) => el.getBoundingClientRect().left < window.innerWidth * 0.55);
    const sorted = (leftCandidates.length ? leftCandidates : candidates).sort((a, b) => b.innerText.length - a.innerText.length);
    return sorted[0] || document.body;
  }

  function extractQuestion() {
    const qContainer = getQuestionContainer();
    const containerText = qContainer.innerText || '';
    const bodyText = document.body.innerText || '';

    let title = '';
    const topText = bodyText.slice(0, 2000);
    const backMatch = topText.match(/(?:<|\bBack\b)[^\w\n]*[|\n]\s*([^\n\r]+)/i);
    if (backMatch && backMatch[1]) {
      const clean = backMatch[1].split(/(?:Total XP|\s{4,}|\t)/i)[0].trim();
      if (clean.length > 3 && !/^(newton|playground|school|back|<)$/i.test(clean)) title = clean;
    }

    if (!title) {
      const headings = [...document.querySelectorAll('h1, h2, h3, h4, [class*="title" i], [class*="header" i]')].filter((el) => {
        const r = el.getBoundingClientRect();
        const t = el.innerText.trim();
        return AP.isVisible(el) && r.left < window.innerWidth * 0.55 && t.length > 3 &&
          !/^(QUESTION|Test Cases|Requirements|Newton School|Given Task Data|Submissions|ALL SUBMISSIONS|LATEST SUBMISSION)$/i.test(t);
      });
      if (headings.length > 0) title = headings[0].innerText.trim();
    }

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

    if (!title || /^(newton school|playground)$/i.test(title)) {
      title = 'Build a Task Management API';
    }

    let difficulty = 'Medium';
    let points = '0/60';
    const diffMatch = (containerText + ' ' + bodyText).match(/\b(Easy|Medium|Hard)\b/i);
    if (diffMatch) difficulty = diffMatch[1];
    const ptsMatch = (containerText + ' ' + bodyText).match(/(\d+\s*\/\s*\d+)\b/);
    if (ptsMatch) points = ptsMatch[1];

    const testCases = [];
    for (const text of [containerText, bodyText]) {
      const lines = text.split('\n').map((l) => l.trim());
      for (const line of lines) {
        const m = line.match(/^(\d+)[\.\)]\s+(.+)$/);
        if (m && m[2].length > 4) {
          const desc = m[2].trim();
          if (!/^(open|click|go to|download|step|navigate)\b/i.test(desc) || /test|return|reject|filter|accept|get|post|patch|put|delete|status|json|array|task/i.test(desc)) {
            if (!testCases.includes(desc)) testCases.push(desc);
          }
        }
      }
      if (testCases.length > 0) break;
    }

    const fullText = (containerText.length > 100 ? containerText : bodyText)
      .replace(/< Back.*?\n/g, '')
      .replace(/Total XP.*?\n/g, '')
      .replace(/Submit Solution/g, '')
      .trim();

    return { title, difficulty, points, testCases, details: fullText };
  }

  function getSubmitButton() {
    const candidates = [
      ...document.querySelectorAll('button, [role="button"], a[role="button"], input[type="submit"]')
    ].filter(b => AP.isVisible(b) && !b.closest('#ap-solver-host'));

    const textMatch = candidates.find(b => {
      const txt = (b.innerText || b.textContent || b.getAttribute('value') || '').trim();
      return /submit\s*(solution|code)?/i.test(txt) && !/cancel/i.test(txt);
    });
    if (textMatch) return textMatch;

    return candidates.find(b => {
      const tid = (b.getAttribute('data-testid') || b.getAttribute('id') || b.className || '').toLowerCase();
      return tid.includes('submit') && !tid.includes('cancel');
    }) || null;
  }

  function readSubmissionResults() {
    const isRunning = /Running Test Cases|Checking Submission|evaluat(ing|e)|several minutes/i.test(document.body.innerText);

    const leftElements = [...document.querySelectorAll('*')].filter((el) => {
      if (!AP.isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.left < window.innerWidth * 0.55 && r.top > 40 && !el.closest('#ap-solver-host');
    });

    const testNameElements = leftElements.filter((el) => {
      const text = el.innerText?.trim() || '';
      if (!/^\d+[\.\)]\s+[A-Za-z]/.test(text)) return false;
      if (text.length < 5 || text.length > 250) return false;
      if (text.includes('\n') && (text.match(/\n/g) || []).length > 2) return false;
      return ![...el.children].some((c) => /^\d+[\.\)]\s+[A-Za-z]/.test(c.innerText?.trim() || ''));
    });

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

    const tests = uniqueTestElements.map(({ el, num, name }) => {
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

        if (
          fill === '#009965' || fill.includes('green') || fill.includes('#10b981') || fill.includes('#22c55e') ||
          fill.includes('#16a34a') || fill.includes('#059669') ||
          stroke === '#009965' || stroke.includes('green') || stroke.includes('#10b981') || stroke.includes('#16a34a') ||
          cls.includes('green') || cls.includes('pass') || cls.includes('success') || cls.includes('check') ||
          style.includes('green') || style.includes('#009965') || style.includes('#10b981') || style.includes('rgb(0, 153') || style.includes('rgb(16, 185')
        ) {
          isGreen = true;
        }
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

      if (!isGreen && !isRed) {
        for (const svg of row.querySelectorAll('svg')) {
          try {
            const cs = window.getComputedStyle(svg);
            const col = cs.color || '', fill = cs.fill || '', stroke = cs.stroke || '';
            if (col.includes('239,') || col.includes('220,') || col.includes('244,') || fill.includes('239,') || fill.includes('220,') || stroke.includes('239,') || stroke.includes('220,')) isRed = true;
            if (col.includes('0, 153') || col.includes('16, 185') || col.includes('34, 197') || fill.includes('0, 153') || fill.includes('16, 185') || stroke.includes('0, 153') || stroke.includes('16, 185')) isGreen = true;
          } catch (e) {}
        }
      }

      if (!isGreen && !isRed) {
        const rowTxt = (row.innerText || '').trim();
        if (/\bfailed\b|\bfail\b|✕|✖|❌/i.test(rowTxt) && !/\bpass(?:ed)?\b/i.test(rowTxt)) isRed = true;
        else if (/\bpassed\b|✓|✅/i.test(rowTxt) && !/\bfail(?:ed)?\b/i.test(rowTxt)) isGreen = true;
      }

      const status = isRed ? 'FAIL' : (isGreen ? 'PASS' : 'PENDING');
      return { num, name, status, pass: status === 'PASS', fail: status === 'FAIL', pending: status === 'PENDING' };
    });

    let timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeElements = leftElements.filter((el) => {
      const t = el.innerText?.trim() || '';
      return /(?:ago|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b)/i.test(t) && t.length < 50;
    });
    if (timeElements.length > 0) timestamp = timeElements[0].innerText.trim();

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
      for (const ifr of document.querySelectorAll('iframe')) {
        try {
          const doc = ifr.contentDocument || ifr.contentWindow?.document;
          if (doc) candidates.push(...doc.querySelectorAll('.xterm-rows, pre, code, [class*="terminal" i], [class*="output" i]'));
        } catch (e) {}
      }

      for (const el of candidates) {
        const text = el.innerText || '';
        if (!text || (!text.includes('AssertionError') && !text.includes('failing') && !text.includes('Error:') && !text.includes('timeout'))) continue;
        const cleanTestName = testName.replace(/^\d+[\.\)]\s*/, '').trim();
        let testIdx = text.indexOf(cleanTestName);
        if (testIdx === -1) {
          const words = cleanTestName.split(/\s+/).filter(w => w.length > 3);
          if (words.length > 0) {
            const firstIdx = text.indexOf(words[0]);
            if (firstIdx !== -1 && words.some(w => text.includes(w))) testIdx = firstIdx;
          }
        }
        if (testIdx !== -1) {
          const lines = text.substring(testIdx).split('\n').map(l => l.trim()).filter(Boolean);
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
    for (const t of res.tests) {
      if (t.fail && !t.error) {
        const errText = findMochaErrorForTest(t.name);
        if (errText) t.error = errText;
      }
    }
    return res;
  }

  function getLeftRailTabs() {
    const elements = [...document.querySelectorAll('button, [role="tab"], div, a, li, span')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!AP.isVisible(el) || r.left < 0 || r.left > 80 || r.top < 30 || r.top > 450) return false;
      if (r.width < 14 || r.height < 14 || r.width > 75 || r.height > 75 || el.closest('#ap-solver-host')) return false;
      const text = el.innerText.trim();
      const hasIcon = !!el.querySelector('svg, i, [class*="icon" i], [class*="codicon" i]') || text === 'Q';
      return hasIcon || /tab|button/i.test(el.getAttribute('role') || el.tagName) || text.length === 1;
    });
    const uniqueTabs = [];
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (!uniqueTabs.find((u) => Math.abs(u.getBoundingClientRect().top - r.top) < 15)) uniqueTabs.push(el);
    }
    return uniqueTabs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
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

  function findLeftRailIcon(regex) {
    return [...document.querySelectorAll('button, [role="tab"]')].find((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText && el.innerText.trim().length <= 24 ? el.innerText.trim() : '')).toLowerCase();
      return AP.isVisible(el) && r.left < 60 && r.width <= 70 && r.height <= 70 && !el.closest('#ap-solver-host') && regex.test(label);
    });
  }

  function switchToQuestionTab() {
    const explicit = findLeftRailIcon(/question|problem/i);
    if (explicit) { explicit.click(); return true; }
    return clickRailTab(0);
  }

  function switchToSubmissionsTab() {
    const explicit = findLeftRailIcon(/submission|test\s*case/i);
    if (explicit) { explicit.click(); return true; }
    return clickRailTab(1);
  }

  function switchToTerminalTab() {
    const explicit = findLeftRailIcon(/terminal|log|output|console|execution/i);
    if (explicit) { explicit.click(); return true; }
    return clickRailTab(2);
  }

  async function readTerminalOutput(maxWaitMs = 6000) {
    switchToTerminalTab();
    await AP.sleep(800);

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const candidates = [...document.querySelectorAll('pre, code, .xterm-rows, [class*="terminal" i], [class*="console" i], [class*="output" i], [class*="log" i], div')].filter((el) => {
        const r = el.getBoundingClientRect();
        const text = el.innerText || '';
        if (!AP.isVisible(el) || r.width <= 80 || r.height <= 40 || el.closest('#ap-solver-host')) return false;
        const isGraderTrace = /git clone|mochawesome|\d+\s+(?:failing|passing)|AssertionError|Response timeout of|timeout of \d+ms exceeded|Cannot find module|PrismaClient|node-\d+|npm test/i.test(text);
        const isGenericError = /mocha|npm test|failing|passing|prisma|TypeError:|ReferenceError:|SyntaxError:|Error:/i.test(text);
        const looksLikeQuestionOrHttp = (/^\s*QUESTION\b/i.test(text) || (/HTTP REQUEST\s+GET/i.test(text) && /QUERY PARAMS/i.test(text))) && !isGraderTrace;
        if (looksLikeQuestionOrHttp) return false;
        return isGraderTrace || isGenericError;
      });

      try {
        for (const ifr of document.querySelectorAll('iframe')) {
          const doc = ifr.contentDocument || ifr.contentWindow?.document;
          if (doc) {
            const ifrEls = [...doc.querySelectorAll('pre, code, .xterm-rows, [class*="terminal" i], [class*="output" i], [class*="log" i], div')].filter(el =>
              /mocha|npm test|AssertionError|failing|passing|prisma|timeout|error|node|TypeError|ReferenceError|SyntaxError/i.test(el.innerText || '')
            );
            candidates.push(...ifrEls);
          }
        }
      } catch (e) {}

      if (candidates.length > 0) {
        const leftCandidates = candidates.filter(c => {
          try { return c.getBoundingClientRect().left < window.innerWidth * 0.55; } catch (e) { return true; }
        });
        const bestPool = leftCandidates.length > 0 ? leftCandidates : candidates;

        const collected = [];
        for (const el of bestPool) {
          const xtermRows = el.querySelectorAll ? el.querySelectorAll('.xterm-rows > div') : null;
          if (xtermRows && xtermRows.length > 0) {
            const xtermText = Array.from(xtermRows).map(row => row.innerText || '').join('\n').trim();
            if (xtermText.length > 25 && !collected.includes(xtermText)) collected.push(xtermText);
          }
          let t = (el.innerText || '').trim();
          const httpIdx = t.indexOf('\nHTTP REQUEST\n');
          if (httpIdx > 40) t = t.slice(0, httpIdx).trim();
          if (t.length > 25 && !collected.includes(t)) collected.push(t);
        }

        if (collected.length > 0) {
          collected.sort((a, b) => {
            const score = (s) =>
              (/\d+\s+failing|\d+\s+passing/i.test(s) ? 10 : 0) +
              (/git clone|mochawesome|Response timeout of/i.test(s) ? 6 : 0) +
              (/AssertionError|TypeError:|ReferenceError:|SyntaxError:|Cannot find module|PrismaClient/i.test(s) ? 4 : 0);
            const diff = score(b) - score(a);
            return diff !== 0 ? diff : b.length - a.length;
          });
          if (collected[0].length > 25) return collected[0];
        }
      }

      await AP.sleep(500);
    }

    return '';
  }

  Object.assign(AP, {
    getQuestionContainer,
    extractQuestion,
    getSubmitButton,
    readSubmissionResults,
    findMochaErrorForTest,
    readSubmissionResultsWithErrors,
    getLeftRailTabs,
    clickRailTab,
    switchToQuestionTab,
    switchToSubmissionsTab,
    switchToTerminalTab,
    readTerminalOutput
  });
})();
