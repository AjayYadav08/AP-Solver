// content/frame-editor.js - Injected into all frames (including VS Code Web / Monaco)
(() => {
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
        const bridgeResp = await askBridge('AP_READ_CODE');
        if (bridgeResp.ok && bridgeResp.code) {
          sendResponse({
            ok: true,
            code: bridgeResp.code,
            language: bridgeResp.language || 'javascript',
            uri: bridgeResp.uri || '',
            frameUrl: location.href,
            method: 'bridge'
          });
          return;
        }

        // Check DOM fallback
        if (hasEditor()) {
          const domCode = readCodeFromDOM();
          if (domCode) {
            sendResponse({
              ok: true,
              code: domCode,
              language: 'javascript',
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

    if (msg.op === 'AP_SET_EDITOR_CODE') {
      (async () => {
        const code = msg.code || '';
        // Try bridge first
        const bridgeResp = await askBridge('AP_WRITE_CODE', { code });
        if (bridgeResp.ok) {
          sendResponse({ ok: true, method: bridgeResp.method || 'bridge' });
          return;
        }

        // Fallback: DOM execCommand
        const textarea = document.querySelector('.monaco-editor textarea.inputarea');
        if (textarea) {
          textarea.focus();
          document.execCommand('selectAll', false, null);
          const ok = document.execCommand('insertText', false, code);
          sendResponse({ ok: ok, method: 'execCommand' });
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
