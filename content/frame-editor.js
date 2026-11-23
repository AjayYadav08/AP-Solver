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

          await new Promise(r => setTimeout(r, 120));

          // 4. Insert text replacing selection
          try {
            document.execCommand('insertText', false, code);
          } catch(e) {}

          // 5. Paste clean code
          const dt = new DataTransfer();
          dt.setData('text/plain', code);
          const pasteEvt = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          });
          textarea.dispatchEvent(pasteEvt);
          if (editorDom) editorDom.dispatchEvent(pasteEvt);

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
          const hasOld501 = /res\.statusCode\s*=\s*501/i.test(lines);
          const countHttp = (lines.match(/require\(['"](?:node:)?http['"]\)/g) || []).length;
          const verified = lines.length > 50 && !hasOld501 && countHttp <= 1;

          sendResponse({ ok: true, verified, method: 'frame-dom-wipeAndPaste' });
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
  });
})();
