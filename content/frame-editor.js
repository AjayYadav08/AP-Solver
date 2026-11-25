// content/frame-editor.js - Injected into all frames (including VS Code Web / Monaco)
(() => {
  if (!/(^|\.)newtonschool\.co$/i.test(location.hostname) && location.hostname && !/localhost|127\.0\.0\.1|vscode/i.test(location.hostname)) return; // Newton School portal & embedded frames
  if (window.__apFrameEditorLoaded) return;
  window.__apFrameEditorLoaded = true;

  // Inject main-world-bridge into the page context
  function injectMainWorldBridge() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/main-world-bridge.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      console.warn('[AP-Solver Frame] Bridge injection error:', err);
    }
  }

  // Inject when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMainWorldBridge);
  } else {
    injectMainWorldBridge();
  }

  // Helper to talk to main-world-bridge via postMessage
  function askBridge(action, payload = {}, timeout = 2500) {
    return new Promise((resolve) => {
      const id = 'bridge_' + Math.random().toString(36).substring(2, 9);
      let timer = null;

      const handler = (event) => {
        if (!event.data || event.data.id !== id) return;
        window.removeEventListener('message', handler);
        clearTimeout(timer);
        resolve(event.data);
      };

      window.addEventListener('message', handler);

      timer = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ ok: false, error: 'Bridge request timed out' });
      }, timeout);

      window.postMessage({ action, id, payload }, '*');
    });
  }

  // Detect if this frame contains Monaco or an editor
  function hasEditor() {
    return !!document.querySelector('.monaco-editor, textarea.inputarea, .view-lines');
  }

  // Helper: Simulate realistic user click and dblclick
  function simulateClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch(e) {}
    try { el.focus(); } catch(e) {}
    const list = el.closest?.('.monaco-list, .monaco-tree-view');
    if (list) { try { list.focus(); } catch(e) {} }

    // Dismiss any active inline rename input
    const activeInput = document.querySelector('.monaco-list-row input, .monaco-inputbox input, input.monaco-inputbox');
    if (activeInput) {
      try {
        activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        activeInput.blur();
      } catch(e) {}
    }

    const isTreeRow = el.classList?.contains('monaco-list-row') || el.getAttribute?.('role') === 'treeitem';
    // For tree items, target the icon specifically — NEVER click the text label name, which triggers inline rename!
    const icon = isTreeRow ? (el.querySelector('.monaco-icon-label-icon, .codicon, .monaco-tl-twistie') || el) : null;
    const target = icon || el.querySelector?.('.label-name, .monaco-icon-label') || el;
    const rect = target.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const clientX = isTreeRow
      ? ((rect.left && rect.left > 0) ? (rect.left + 8) : (elRect.left + 24))
      : ((rect.left + rect.width / 2) || 150);
    const clientY = (rect.top + rect.height / 2) || 150;

    const baseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: 1
    };

    // Click 1
    const clickOpts1 = { ...baseOpts, detail: 1 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new PointerEvent('pointerup', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('click', clickOpts1)); } catch (e) {}

    // Click 2 (detail: 2) -> Monaco / VS Code tree dblclick
    const clickOpts2 = { ...baseOpts, detail: 2 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new PointerEvent('pointerup', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('click', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('dblclick', clickOpts2)); } catch (e) {}

    // CRITICAL: NEVER dispatch Enter key on tree items! On macOS/VS Code, Enter triggers inline file rename!

    return true;
  }

  // Try to open a target file if VS Code Web is showing the Welcome tab or wrong file
  function tryOpenTargetFileInExplorer(targetFilePath = null) {
    try {
      const basename = targetFilePath ? targetFilePath.split('/').pop().toLowerCase() : null;

      // 1. Check open tabs first
      const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
      if (basename) {
        const matchingTab = tabs.find(t => {
          const aria = (t.getAttribute('aria-label') || '').toLowerCase();
          const txt = (t.querySelector('.label-name') || t).textContent.trim().toLowerCase();
          return aria.includes(basename) || txt === basename || txt.startsWith(basename);
        });
        if (matchingTab) {
          simulateClick(matchingTab);
          return true;
        }
      }

      const items = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
      // Expand 'src' folder if present
      const srcFolder = items.find((el) => {
        const t = (el.querySelector('.label-name') || el).textContent.trim();
        return /^src$/i.test(t);
      });
      if (srcFolder) {
        const isCollapsed = srcFolder.getAttribute('aria-expanded') === 'false' ||
          !!srcFolder.querySelector('.collapsed, .codicon-chevron-right');
        if (isCollapsed) {
          const twistie = srcFolder.querySelector('.monaco-tl-twistie, .codicon-chevron-right, .collapsed');
          if (twistie) {
            try { twistie.click(); } catch(e) {}
            try { twistie.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch(e) {}
          }
          try { srcFolder.focus(); } catch(e) {}
          try { srcFolder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true })); } catch(e) {}
          simulateClick(twistie || srcFolder);
        }
      }

      if (basename) {
        const target = items.find((el) => {
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          if (aria === basename || aria.startsWith(basename)) return true;
          const txt = (el.querySelector('.label-name') || el).textContent.trim().toLowerCase();
          return txt === basename || txt.startsWith(basename) || txt.split(/\s+/)[0] === basename;
        });
        if (target) {
          simulateClick(target);
          return true;
        }
      }

      // Default: Find first non-welcome js file
      const anyFile = items.find((el) => /\.(js|ts)$/i.test((el.querySelector('.label-name') || el).textContent.trim()));
      if (anyFile) {
        simulateClick(anyFile);
        return true;
      }
    } catch (e) {
      // Continue
    }
    return false;
  }

  // Fallback: Read code directly from DOM if bridge fails
  function readCodeFromDOM() {
    const viewLines = document.querySelector('.monaco-editor .view-lines');
    if (viewLines) {
      const lines = [...viewLines.querySelectorAll('.view-line')].map((l) => l.textContent);
      return lines.join('\n');
    }
    return '';
  }

  // Listen for extension messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.op === 'AP_GET_EDITOR_STATUS') {
      (async () => {
        // Try bridge first
        let bridgeResp = await askBridge('AP_READ_CODE');

        // If Welcome screen or empty, try opening index.js from explorer
        if (!bridgeResp.ok || !bridgeResp.code || /Get Started with VS Code/i.test(bridgeResp.code)) {
          if (tryOpenTargetFileInExplorer()) {
            await new Promise((r) => setTimeout(r, 600));
            bridgeResp = await askBridge('AP_READ_CODE');
          }
        }

        if (bridgeResp.ok && bridgeResp.code && !/Get Started with VS Code/i.test(bridgeResp.code)) {
          sendResponse({
            ok: true,
            code: bridgeResp.code,
            language: bridgeResp.language || 'javascript',
            uri: bridgeResp.uri || '',
            activeFile: bridgeResp.activeFile || 'src/index.js',
            allFiles: bridgeResp.allFiles || [],
            referenceFiles: bridgeResp.referenceFiles || {},
            frameUrl: location.href,
            method: 'bridge'
          });
          return;
        }

        // Check DOM fallback
        if (hasEditor()) {
          const domCode = readCodeFromDOM();
          if (domCode && !/Get Started with VS Code/i.test(domCode)) {
            sendResponse({
              ok: true,
              code: domCode,
              language: 'javascript',
              activeFile: 'src/index.js',
              frameUrl: location.href,
              method: 'dom'
            });
            return;
          }
        }

        sendResponse({ ok: false, error: 'No editor found in this frame' });
      })();
      return true; // async
    }

    if (msg.op === 'AP_SET_EDITOR_CODE' || msg.op === 'AP_WRITE_EDITOR') {
      (async () => {
        const payloadData = msg.data || msg;
        const code = payloadData.code || '';
        const filePath = payloadData.filePath || null;
        tryOpenTargetFileInExplorer(filePath);

        // Try bridge first
        const bridgeResp = await askBridge('AP_WRITE_CODE', { code, filePath });
        if (bridgeResp.ok) {
          sendResponse({ ok: true, verified: true, method: bridgeResp.method || 'bridge', filePath });
          return;
        }

        // Check if active tab matches filePath before DOM fallback
        if (filePath) {
          const basename = filePath.split('/').pop().toLowerCase();
          const activeTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
          const activeTxt = (activeTab?.querySelector('.label-name') || activeTab)?.textContent?.trim()?.toLowerCase() || '';
          if (activeTxt && !activeTxt.includes(basename)) {
            sendResponse({ ok: false, error: `Active tab is "${activeTxt}", not target "${basename}"` });
            return;
          }
        }

        // Fallback: DOM events on textarea with multi-tier Select All & Wipe
        const editorDom = document.querySelector('.monaco-editor');
        const textarea = editorDom?.querySelector('textarea.inputarea') || document.querySelector('textarea.inputarea');
        if (textarea) {
          textarea.focus();

          const isMac = /mac/i.test(navigator.platform);

          // 1. Cursor to top: Cmd+Up / Ctrl+Home
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

          // True Wipe: Delete & Backspace existing selection before inserting or pasting
          try { document.execCommand('delete', false, null); } catch(e) {}
          const backspaceEvt = new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true });
          textarea.dispatchEvent(backspaceEvt);
          try {
            textarea.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
          } catch(e) {}
          textarea.value = '';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));

          await new Promise(r => setTimeout(r, 120));

          // 4. Insert clean text without duplicate paste
          let inserted = false;
          try {
            inserted = document.execCommand('insertText', false, code);
          } catch(e) {}

          if (!inserted) {
            const dt = new DataTransfer();
            dt.setData('text/plain', code);
            const pasteEvt = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            });
            textarea.dispatchEvent(pasteEvt);
          }

          await new Promise(r => setTimeout(r, 150));

          // Trigger Ctrl+S to save
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

          const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => l.textContent).join('\n');
          const codeSnippet = code.replace(/[\s\r\n]+/g, ' ').slice(0, 40);
          const linesClean = lines.replace(/[\s\r\n]+/g, ' ');
          const verified = linesClean.includes(codeSnippet);
          if (verified) {
            sendResponse({ ok: true, verified: true, method: 'frame-dom-wipeAndPaste' });
          } else {
            sendResponse({ ok: false, error: 'DOM textarea write unverified; requires CDP hardware wipe', method: 'frame-dom-unverified' });
          }
          return;
        }

        sendResponse({ ok: false, error: bridgeResp.error || 'Failed to write code' });
      })();
      return true;
    }

    if (msg.op === 'AP_SELECT_ALL') {
      (async () => {
        const bridgeResp = await askBridge('AP_SELECT_ALL');
        sendResponse(bridgeResp);
      })();
      return true;
    }

    // --- Integrated Terminal Direct Frame Controller ---
    if (msg.op === 'AP_CHECK_TERMINAL') {
      const termInfo = findIntegratedTerminal();
      sendResponse({ ok: true, found: termInfo.found, rect: termInfo.rect || null });
      return true;
    }

    if (msg.op === 'AP_OPEN_TERMINAL') {
      (async () => {
        const opened = await openIntegratedTerminal();
        const termInfo = findIntegratedTerminal();
        sendResponse({ ok: true, opened: opened || termInfo.found, rect: termInfo.rect || null });
      })();
      return true;
    }

    if (msg.op === 'AP_CLEAN_EDITOR_ARTIFACTS') {
      (async () => {
        try {
          const reqId = 'ap_clean_' + Date.now();
          const handler = (evt) => {
            if (evt.data && evt.data.action === 'AP_CLEAN_EDITOR_ARTIFACTS_RESULT' && evt.data.id === reqId) {
              window.removeEventListener('message', handler);
              sendResponse({ ok: !!evt.data.ok, cleanedCount: evt.data.cleanedCount || 0 });
            }
          };
          window.addEventListener('message', handler);
          window.postMessage({ action: 'AP_CLEAN_EDITOR_ARTIFACTS', id: reqId }, '*');
          setTimeout(() => {
            window.removeEventListener('message', handler);
            sendResponse({ ok: true, cleanedCount: 0 });
          }, 600);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }

    if (msg.op === 'AP_INJECT_TERMINAL_COMMAND') {
      (async () => {
        const cmd = msg.data?.command || msg.command || msg.data?.script || '';
        const termInfo = findIntegratedTerminal();
        if (!termInfo.found) {
          sendResponse({ ok: false, error: 'Terminal not found in this frame' });
          return;
        }

        const ta = termInfo.textarea || document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea, [class*="xterm" i] textarea');
        if (ta && ta.closest('.monaco-editor')) {
          sendResponse({ ok: false, error: 'Targeted editor instead of terminal' });
          return;
        }
        // Blur all Monaco editors BEFORE focusing terminal so activeElement cannot leak into editor
        document.querySelectorAll('.monaco-editor textarea, textarea.inputarea').forEach(t => {
          try { t.blur(); } catch(e) {}
        });
        if (ta) {
          try { ta.focus(); } catch(e) {}
        }
        if (termInfo.element && !ta) {
          try { termInfo.element.focus(); termInfo.element.click(); } catch(e) {}
        }

        let pasted = false;
        let sentEnterViaCore = false;

        // 1. Try Main-World xterm.paste via postMessage to main-world-bridge
        try {
          const reqId = 'ap_term_' + Date.now();
          const mainPromise = new Promise((resolve) => {
            const h = (evt) => {
              if (evt.data && evt.data.action === 'AP_INJECT_TERMINAL_MAIN_RESULT' && evt.data.id === reqId) {
                window.removeEventListener('message', h);
                resolve({ pasted: !!evt.data.pasted, sentEnterViaCore: !!evt.data.sentEnterViaCore });
              }
            };
            window.addEventListener('message', h);
            setTimeout(() => {
              window.removeEventListener('message', h);
              resolve({ pasted: false, sentEnterViaCore: false });
            }, 300);
          });
          window.postMessage({ action: 'AP_INJECT_TERMINAL_MAIN', id: reqId, payload: { command: cmd } }, '*');
          const mainRes = await mainPromise;
          pasted = mainRes.pasted;
          sentEnterViaCore = mainRes.sentEnterViaCore;
        } catch (e) {}

        // 2. Direct element xterm property fallback
        if (!pasted) {
          const termEl = termInfo.element;
          for (const k of ['xterm', '_xterm', '__xterm']) {
            const term = termEl && termEl[k];
            if (term && typeof term.paste === 'function') {
              try {
                if (typeof term.input === 'function') { term.input('\x03', true); term.input('\x15', true); }
                term.paste(cmd);
                pasted = true;
                if (typeof term.input === 'function') { term.input('\r', true); sentEnterViaCore = true; }
                break;
              } catch(e) {}
            }
          }
        }

        // Do NOT simulate untrusted ClipboardEvent paste: modern xterm.js ignores synthetic paste/Enter events,
        // which would falsely report ok=true and block CDP hardware terminal execution!
        // Keep terminal focus confirmed and escalate to Step 3 Hardware CDP when xterm API isn't directly exposed.
        const isConfirmedTerminalFocus = !!(ta && document.activeElement === ta && !document.activeElement.closest('.monaco-editor'));
        if (!pasted) {
          sendResponse({
            ok: false,
            pasted: false,
            focusConfirmed: isConfirmedTerminalFocus,
            error: 'Direct xterm API unavailable; escalating to CDP hardware terminal input'
          });
          return;
        }

        sendResponse({ ok: true, pasted, sentEnterViaCore, rect: termInfo.rect });
      })();
      return true;
    }
  });

  // Helper functions for Integrated Terminal
  function findIntegratedTerminal() {
    const selectors = [
      '.terminal-outer-container',
      '.terminal-wrapper',
      '.terminal.xterm',
      '.pane-body.integrated-terminal',
      '.xterm-screen',
      '.xterm-rows',
      'canvas.xterm-text-layer',
      'canvas.xterm-cursor-layer',
      'textarea.xterm-helper-textarea'
    ];
    for (const sel of selectors) {
      const els = [...document.querySelectorAll(sel)];
      for (const el of els) {
        const term = el.closest('.terminal, .terminal-wrapper, .integrated-terminal') || el;
        if (term.closest('.monaco-editor')) continue;
        const r = term.getBoundingClientRect();
        if (r.width > 40 && r.height > 30) {
          const ta = term.querySelector('textarea.xterm-helper-textarea, [class*="xterm" i] textarea') || document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, [class*="xterm" i] textarea');
          if (ta && ta.closest('.monaco-editor')) continue;
          return {
            found: true,
            element: term,
            textarea: ta,
            rect: {
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              cx: r.left + Math.min(r.width / 2, 200),
              cy: r.top + Math.min(r.height / 2, 80)
            }
          };
        }
      }
    }
    return { found: false };
  }

  async function openIntegratedTerminal() {
    if (findIntegratedTerminal().found) return true;

    // 1. Check if TERMINAL tab is in the panel tab bar
    const allTabs = [...document.querySelectorAll('[role="tab"], .composite.title, .action-item')];
    const termTab = allTabs.find(t => (t.textContent || '').trim().toUpperCase() === 'TERMINAL' || t.getAttribute('aria-label')?.toLowerCase() === 'terminal');
    if (termTab) {
      simulateClick(termTab);
      await new Promise(r => setTimeout(r, 250));
      if (findIntegratedTerminal().found) return true;
    }

    // 2. Click "..." in panel title
    const moreBtn = document.querySelector('.part.panel .title [aria-label*="More" i], .part.panel [class*="codicon-more" i], .part.panel [class*="codicon-ellipsis" i], .composite.title [aria-label*="More" i]');
    if (moreBtn) {
      simulateClick(moreBtn);
      await new Promise(r => setTimeout(r, 200));
      const menuItems = [...document.querySelectorAll('.action-menu-item, [role="menuitem"], .action-label')];
      const termItem = menuItems.find(it => (it.textContent || '').trim().toLowerCase() === 'terminal');
      if (termItem) {
        simulateClick(termItem);
        await new Promise(r => setTimeout(r, 350));
        if (findIntegratedTerminal().found) return true;
      }
    }

    // 3. Click Status Bar Problems icon: "(X) 1  (!) 0"
    const statusBar = document.querySelector('.statusbar-item.left [aria-label*="Problem" i], .statusbar-item.left [aria-label*="Error" i], .statusbar-item.left [class*="codicon-error" i], .statusbar-item.left');
    if (statusBar) {
      simulateClick(statusBar);
      await new Promise(r => setTimeout(r, 250));

      const tabsAfter = [...document.querySelectorAll('[role="tab"], .composite.title, .action-item')];
      const termTabAfter = tabsAfter.find(t => (t.textContent || '').trim().toUpperCase() === 'TERMINAL');
      if (termTabAfter) {
        simulateClick(termTabAfter);
        await new Promise(r => setTimeout(r, 250));
        if (findIntegratedTerminal().found) return true;
      }

      const moreAfter = document.querySelector('.part.panel .title [aria-label*="More" i], .part.panel [class*="codicon-more" i], .part.panel [class*="codicon-ellipsis" i]');
      if (moreAfter) {
        simulateClick(moreAfter);
        await new Promise(r => setTimeout(r, 200));
        const menuItems = [...document.querySelectorAll('.action-menu-item, [role="menuitem"], .action-label')];
        const termItem = menuItems.find(it => (it.textContent || '').trim().toLowerCase() === 'terminal');
        if (termItem) {
          simulateClick(termItem);
          await new Promise(r => setTimeout(r, 350));
          if (findIntegratedTerminal().found) return true;
        }
      }
    }

    // 4. Ctrl + ` keydown fallback
    try {
      const ev = new KeyboardEvent('keydown', {
        key: '`',
        code: 'Backquote',
        keyCode: 192,
        which: 192,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(ev);
      window.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    } catch(e) {}

    return findIntegratedTerminal().found;
  }
})();
