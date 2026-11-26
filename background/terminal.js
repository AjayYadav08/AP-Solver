// background/terminal.js - Integrated Terminal panel opener, MAIN-world buffer reader, command dispatcher & disk writer
import { buildBase64TerminalScript } from '../utils/commands.js';
import { sleep, attachCDP, sendCDP, cdpNativeClick, cdpNativeKey, cdpNativeInsertText } from './cdp.js';

/** Ensure VS Code Web Integrated Terminal panel is visible across frames. */
export async function ensureTerminalOpen(tabId) {
  try {
    const checkRes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const candidates = [
          ...document.querySelectorAll('.terminal-outer-container, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, canvas.xterm-text-layer, canvas.xterm-cursor-layer, .xterm-screen, textarea.xterm-helper-textarea')
        ];
        for (const term of candidates) {
          const parent = term.closest('.terminal, .terminal-wrapper, .integrated-terminal') || term;
          if (parent.closest('.monaco-editor')) continue;
          const r = parent.getBoundingClientRect();
          if (r.width > 40 && r.height > 30) return true;
        }
        return false;
      }
    });

    if (checkRes?.some(r => r.result === true)) {
      console.log('[AP-Solver] Terminal is ALREADY open and visible. Keeping it intact.');
      return true;
    }

    const runAction = (actionName) => chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [actionName],
      func: (action) => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0, buttons: 1 };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            try { el.dispatchEvent(t.startsWith('p') ? new PointerEvent(t, opts) : new MouseEvent(t, opts)); } catch(e) {}
          }
          try { el.click(); } catch(e) {}
          return true;
        }
        const findTermTab = () => [...document.querySelectorAll('[role="tab"], .action-item, .composite.title, [class*="tab" i]')]
          .find(t => (t.textContent || '').trim().toUpperCase() === 'TERMINAL' || t.getAttribute('aria-label')?.toLowerCase() === 'terminal');
        const findMoreBtn = () => document.querySelector('.part.panel .title [aria-label*="More" i], .part.panel [class*="codicon-more" i], .part.panel [class*="codicon-ellipsis" i], .composite.title [aria-label*="More" i]');
        const findMenuTerm = () => [...document.querySelectorAll('.action-menu-item, [role="menuitem"], .monaco-menu-item, .action-label')]
          .find(it => (it.textContent || '').trim().toLowerCase() === 'terminal');

        if (action === 'termTab') return simulateClickSeq(findTermTab());
        if (action === 'moreBtn') return simulateClickSeq(findMoreBtn());
        if (action === 'menuTerm') return simulateClickSeq(findMenuTerm());
        if (action === 'statusProblems') {
          const sp = document.querySelector('.statusbar-item.left [aria-label*="Problem" i], .statusbar-item.left [aria-label*="Error" i], .statusbar-item.left [class*="codicon-error" i], .statusbar-item.left');
          return simulateClickSeq(sp);
        }
        if (action === 'termTabOrMore') return simulateClickSeq(findTermTab() || findMoreBtn());
        return false;
      }
    });

    const tabClickRes = await runAction('termTab');
    if (tabClickRes?.some(r => r.result === true)) { await sleep(350); return true; }

    await runAction('moreBtn');
    await sleep(250);

    const menuClickRes = await runAction('menuTerm');
    if (menuClickRes?.some(r => r.result === true)) { await sleep(350); return true; }

    await runAction('statusProblems');
    await sleep(300);

    await runAction('termTabOrMore');
    await sleep(200);

    await runAction('menuTerm');
    await sleep(350);
  } catch(e) {
    console.warn('[AP-Solver] ensureTerminalOpen error:', e);
  }
  return true;
}

/** Locate Integrated Terminal frame ID and viewport coordinates (offsetting parent iframe coords). */
export async function findTerminalFrameInfo(tabId) {
  const resolveTopOffset = async (match) => {
    if (!match || match.frameId === 0 || !match.result) return match;
    try {
      const ifrRes = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => [...document.querySelectorAll('iframe')].map(ifr => {
          const r = ifr.getBoundingClientRect();
          return { src: ifr.src || '', left: r.left, top: r.top, width: r.width, height: r.height };
        }).filter(r => r.width > 150 && r.height > 150)
      });
      const iframes = ifrRes?.[0]?.result || [];
      const vsIframe = iframes.find(i => /codeserver|vscode|coder/i.test(i.src) || i.left > 150) || iframes[0];
      if (vsIframe) {
        match.result.x = vsIframe.left + match.result.localX;
        match.result.y = vsIframe.top + match.result.localY;
        match.result.frameLeft = vsIframe.left;
        match.result.frameTop = vsIframe.top;
      }
    } catch (e) {}
    return match;
  };

  const scanRes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const candidates = [
        ...document.querySelectorAll('.terminal-outer-container, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, canvas.xterm-text-layer, canvas.xterm-cursor-layer, .xterm-screen, textarea.xterm-helper-textarea')
      ];
      for (const term of candidates) {
        const parent = term.closest('.terminal, .terminal-wrapper, .integrated-terminal') || term;
        if (parent.closest('.monaco-editor')) continue;
        const r = parent.getBoundingClientRect();
        if (r.width > 40 && r.height > 30) {
          const lx = r.left + Math.min(60, Math.max(20, r.width * 0.2));
          const ly = r.top + Math.min(80, Math.max(15, r.height * 0.45));
          return { found: true, localX: lx, localY: ly, x: lx, y: ly, width: r.width, height: r.height };
        }
      }
      return { found: false };
    }
  });

  let match = scanRes?.find(r => r.result && r.result.found);
  if (!match) {
    await ensureTerminalOpen(tabId);
    await sleep(350);
    const retryScan = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const ta = document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea, [class*="xterm" i] textarea');
        if (ta && !ta.closest('.monaco-editor')) {
          const container = ta.closest('.terminal-wrapper, .terminal, .integrated-terminal') || ta;
          const r = container.getBoundingClientRect();
          const lx = r.left + Math.min(60, Math.max(15, r.width * 0.2));
          const ly = r.top + Math.min(60, Math.max(15, r.height * 0.45));
          return { found: true, localX: lx, localY: ly, x: lx, y: ly, width: r.width, height: r.height };
        }
        return { found: false };
      }
    });
    match = retryScan?.find(r => r.result && r.result.found);
  }
  return await resolveTopOffset(match || null);
}

/** Execute command in Integrated Terminal strictly protecting Monaco focus. */
export async function dispatchCommandToTerminal(tabId, cmdText, settleMs = 1500) {
  await ensureTerminalOpen(tabId);
  const match = await findTerminalFrameInfo(tabId);
  const targetFrameId = match?.frameId;
  const pos = match?.result;

  const focusAndPrepareTerminalLine = async (clearExistingLine = true) => {
    const attached = await attachCDP(tabId);
    if (!attached || !pos) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => {
          const host = document.getElementById('ap-solver-host');
          if (host) {
            host.dataset.prevPe = host.style.pointerEvents || '';
            host.style.pointerEvents = 'none';
          }
        }
      });
    } catch (e) {}

    try {
      if (targetFrameId !== undefined) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [targetFrameId] },
            func: () => {
              document.querySelectorAll('.monaco-editor textarea, textarea.inputarea').forEach(t => { try { t.blur(); } catch(e) {} });
              const ta = document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea');
              if (ta && !ta.closest('.monaco-editor')) try { ta.focus(); } catch(e) {}
            }
          });
        } catch(e) {}
      }

      if (pos.x && pos.y) {
        await cdpNativeClick(tabId, pos.x, pos.y);
        await sleep(140);
      }

      const focusCheck = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const el = document.activeElement;
          if (!el) return { isTerminal: false, isMonaco: false };
          const isTerminal = el.classList.contains('xterm-helper-textarea') || (el.tagName === 'TEXTAREA' && !!el.closest('.terminal, .integrated-terminal'));
          const isMonaco = el.classList.contains('inputarea') || !!el.closest('.monaco-editor');
          return { isTerminal, isMonaco };
        }
      });
      const isTerminalFocused = focusCheck?.some(f => f.result?.isTerminal);
      const isMonacoFocused = focusCheck?.some(f => f.result?.isMonaco);
      if (isTerminalFocused && !isMonacoFocused && clearExistingLine) {
        await cdpNativeKey(tabId, 'c', 'KeyC', 67, 2);
        await sleep(80);
        await cdpNativeKey(tabId, 'u', 'KeyU', 85, 2);
        await sleep(80);
      }
      return { ok: isTerminalFocused && !isMonacoFocused, isTerminalFocused, isMonacoFocused, attached };
    } finally {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          func: () => {
            const host = document.getElementById('ap-solver-host');
            if (host) {
              host.style.pointerEvents = host.dataset.prevPe || '';
              delete host.dataset.prevPe;
            }
          }
        });
      } catch (e) {}
    }
  };

  const prep = await focusAndPrepareTerminalLine(true);

  if (targetFrameId !== undefined) {
    try {
      const inFrameRes = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [targetFrameId] },
        world: 'MAIN',
        func: (cmd) => {
          document.querySelectorAll('.monaco-editor textarea, textarea.inputarea').forEach(t => { try { t.blur(); } catch(e) {} });
          const ta = document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea, [class*="xterm" i] textarea');
          if (ta && !ta.closest('.monaco-editor')) {
            try { ta.focus(); } catch(e) {}
            const termEls = [...document.querySelectorAll('.terminal, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, .xterm, .xterm-screen, canvas.xterm-text-layer')];
            for (const termEl of termEls) {
              for (const k of ['xterm', '_xterm', '__xterm']) {
                if (termEl && termEl[k] && typeof termEl[k].paste === 'function') {
                  try {
                    if (typeof termEl[k].input === 'function') {
                      termEl[k].input('\x03', true);
                      termEl[k].input('\x15', true);
                    }
                    termEl[k].paste(cmd);
                    if (typeof termEl[k].input === 'function') termEl[k].input('\r', true);
                    return true;
                  } catch(e) {}
                }
              }
            }
          }
          return false;
        },
        args: [cmdText]
      });

      if (inFrameRes?.[0]?.result === true) {
        if (prep?.ok) {
          await sleep(160);
          await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
        }
        if (settleMs > 0) await sleep(settleMs);
        return { ok: true, method: 'terminal.inFrameScript', targetFrameId };
      }
    } catch (e) {
      console.warn('[AP-Solver Terminal] inFrameScript error:', e);
    }
  }

  if (targetFrameId !== undefined) {
    try {
      const injectResp = await chrome.tabs.sendMessage(tabId, {
        op: 'AP_INJECT_TERMINAL_COMMAND',
        data: { command: cmdText }
      }, { frameId: targetFrameId });
      if (injectResp && injectResp.ok) {
        if (!injectResp.sentEnterViaCore) {
          await sleep(180);
          if (prep?.ok) {
            await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
          } else {
            const postPrep = await focusAndPrepareTerminalLine(false);
            if (postPrep && !postPrep.isMonacoFocused) await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
          }
        }
        if (settleMs > 0) await sleep(settleMs);
        return { ok: true, method: 'terminal.inFrame', targetFrameId };
      }
    } catch (e) {}
  }

  if (prep && pos) {
    if (prep.isTerminalFocused && !prep.isMonacoFocused) {
      await cdpNativeInsertText(tabId, cmdText);
      await sleep(150);
      await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
      if (settleMs > 0) await sleep(settleMs);
      return { ok: true, method: 'terminal.cdp', targetFrameId };
    } else {
      console.warn('[AP-Solver Terminal] Focus guard: Terminal does not have confirmed exclusive focus (isTerminal:', prep.isTerminalFocused, 'isMonaco:', prep.isMonacoFocused, '). Aborting CDP typing to protect editor.');
      return { ok: false, error: 'Terminal does not have active focus. Command copied to clipboard.' };
    }
  }

  return { ok: false, error: 'Terminal not found across frames' };
}

/** Read Integrated Terminal buffer in MAIN world (supports xterm WebGL buffer API, DOM renderer, and A11y tree). */
export async function readIntegratedTerminalText(tabId, targetFrameId = undefined) {
  try {
    const target = targetFrameId !== undefined ? { tabId, frameIds: [targetFrameId] } : { tabId, allFrames: true };
    const res = await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: () => {
        const texts = [];
        const termWrappers = document.querySelectorAll('.terminal, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, .xterm, .xterm-screen, canvas.xterm-text-layer');
        for (const el of termWrappers) {
          for (const k of ['xterm', '_xterm', '__xterm']) {
            const inst = el && el[k];
            const buf = inst?.buffer?.active || inst?.buffer?.normal || inst?._core?.buffer?.lines;
            if (buf) {
              try {
                const len = buf.length || 0;
                const lines = [];
                const startIdx = Math.max(0, len - 320);
                for (let i = startIdx; i < len; i++) {
                  const line = buf.getLine ? buf.getLine(i) : (buf.get ? buf.get(i) : null);
                  if (line && line.translateToString) lines.push(line.translateToString(true));
                }
                const joined = lines.join('\n').trim();
                if (joined) texts.push(joined);
              } catch(e) {}
            }
          }
        }

        const xtermRowContainers = document.querySelectorAll('.xterm-rows');
        for (const container of xtermRowContainers) {
          if (container.closest('.monaco-editor') || container.closest('#ap-solver-host')) continue;
          const rows = [...container.querySelectorAll(':scope > div, div')];
          if (rows.length > 0) {
            const joined = rows.map(r => (r.textContent || '').replace(/\u00a0/g, ' ')).join('\n').trim();
            if (joined) texts.push(joined);
          }
        }

        const a11yContainers = document.querySelectorAll('.xterm-accessibility-tree, .xterm-accessibility');
        for (const acc of a11yContainers) {
          if (acc.closest('.monaco-editor') || acc.closest('#ap-solver-host')) continue;
          const items = [...acc.querySelectorAll('div, [role="listitem"]')];
          if (items.length > 0) {
            const joined = items.map(i => (i.textContent || '').replace(/\u00a0/g, ' ')).join('\n').trim();
            if (joined) texts.push(joined);
          }
        }

        if (texts.length === 0) return '';
        texts.sort((a, b) => b.length - a.length);
        return texts[0];
      }
    });

    const combined = (res || []).map(r => r?.result || '').filter(Boolean);
    if (combined.length === 0) return '';
    combined.sort((a, b) => b.length - a.length);
    return combined[0];
  } catch (e) {
    return '';
  }
}

export async function decodeTerminalJsonPayload(rawInner) {
  const txt = (rawInner || '').trim();
  const gzMatch = txt.match(/GZ:([A-Za-z0-9+/=\s]+)/);
  if (gzMatch) {
    try {
      const cleanB64 = gzMatch[1].replace(/[^A-Za-z0-9+/=]/g, '');
      const binStr = atob(cleanB64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const decompressed = await new Response(stream).text();
        return JSON.parse(decompressed);
      }
    } catch (e) {
      console.warn('[AP-Solver] GZ decode failed:', e);
    }
  }
  const rawMatch = txt.match(/RAW:([A-Za-z0-9+/=\s]+)/);
  if (rawMatch) {
    try {
      const cleanB64 = rawMatch[1].replace(/[^A-Za-z0-9+/=]/g, '');
      const binStr = atob(cleanB64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      console.warn('[AP-Solver] RAW decode failed:', e);
    }
  }
  return null;
}

export async function runTerminalCommandWithCapture(tabId, { bashCmd, startMarker, endMarker, timeoutMs = 15000 }) {
  try {
    try {
      const att = await attachCDP(tabId);
      if (att) await sendCDP(tabId, 'Accessibility.enable');
    } catch (e) {}

    await ensureTerminalOpen(tabId);
    let baseText = await readIntegratedTerminalText(tabId);
    if (!baseText || !baseText.trim()) {
      await sleep(200);
      baseText = await readIntegratedTerminalText(tabId);
    }
    if (!baseText || !baseText.trim()) {
      return { ok: false, unreadable: true, error: 'Terminal output unavailable in DOM/buffer (WebGL renderer)' };
    }
    const countOccurrences = (str, sub) => {
      if (!str || !sub) return 0;
      let count = 0, pos = 0;
      while ((pos = str.indexOf(sub, pos)) !== -1) { count++; pos += sub.length; }
      return count;
    };
    const baseEndCount = countOccurrences(baseText, endMarker);

    const execRes = await dispatchCommandToTerminal(tabId, bashCmd, 300);
    if (!execRes || !execRes.ok) {
      return { ok: false, error: execRes?.error || 'Could not dispatch terminal command' };
    }

    const tStart = Date.now();
    let sawOutputChange = false;
    while (Date.now() - tStart < timeoutMs) {
      await sleep(350);
      const curText = await readIntegratedTerminalText(tabId, execRes.targetFrameId);
      if (curText && curText !== baseText) sawOutputChange = true;

      const curEndCount = countOccurrences(curText, endMarker);
      if (curEndCount > baseEndCount) {
        const endIdx = curText.lastIndexOf(endMarker);
        const startIdx = curText.lastIndexOf(startMarker, endIdx);
        const sliceStart = startIdx !== -1 ? startIdx + startMarker.length : Math.max(0, endIdx - 6000);
        return { ok: true, raw: curText.substring(sliceStart, endIdx), fullText: curText };
      }
      if (!sawOutputChange && (Date.now() - tStart > 3500)) {
        return { ok: false, unreadable: true, error: 'Terminal output unavailable in DOM/buffer' };
      }
    }

    return { ok: false, timedOut: true, error: 'Terminal capture timed out waiting for completion marker' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

export async function writeFilesViaTerminal(tabId, files, customScript = null, postCommands = []) {
  if (!files || files.length === 0) return { ok: false, error: 'No files provided' };

  const bashScript = customScript || buildBase64TerminalScript(files, postCommands);

  try {
    const baseline = await readIntegratedTerminalText(tabId);
    const baseDoneCount = (baseline.match(/AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY/g) || []).length;

    const res = await dispatchCommandToTerminal(tabId, bashScript, 0);
    if (!res || !res.ok) return res;

    const hasHeavyCmd = /prisma|npm install|npm run build|npx tsc|migrate/i.test(bashScript);
    const maxWait = hasHeavyCmd ? 22000 : 6000;
    const t0 = Date.now();
    await sleep(700);

    while (Date.now() - t0 < maxWait) {
      const curText = await readIntegratedTerminalText(tabId, res.targetFrameId);
      const curDoneCount = (curText.match(/AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY/g) || []).length;
      if (curDoneCount > baseDoneCount + 1 || (curDoneCount > baseDoneCount && /(?:^|\n)[^\n]*[$#]\s*$/.test(curText.trimEnd()))) {
        return { ok: true, verified: true, method: res.method };
      }
      if (!curText && (Date.now() - t0 > (hasHeavyCmd ? 8000 : 2500))) break;
      await sleep(400);
    }

    return { ok: true, verified: false, method: res.method };
  } catch (e) {
    console.warn('[AP-Solver Terminal] writeFilesViaTerminal error:', e);
    return { ok: false, error: e.message || String(e) };
  }
}
