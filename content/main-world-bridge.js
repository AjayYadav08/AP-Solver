// content/main-world-bridge.js - Injected into MAIN world to access window.monaco directly
(() => {
  if (window.__apBridgeLoaded) return;
  window.__apBridgeLoaded = true;

  console.log('[AP-Solver Bridge] Main world bridge initialized.');

  function getMonacoInstance() {
    if (window.monaco && window.monaco.editor) {
      return window.monaco;
    }
    if (window.require && typeof window.require === 'function') {
      try {
        if (window.require.defined && window.require.defined('vs/editor/editor.main')) {
          return window.require('vs/editor/editor.main');
        }
      } catch (e) {
        // Continue
      }
    }
    return null;
  }

  function getActiveEditor(monaco) {
    if (!monaco || !monaco.editor) return null;
    const editors = monaco.editor.getEditors();
    if (!editors || editors.length === 0) return null;

    // Prefer visible, non-readonly editor
    const active = editors.find((ed) => {
      const node = ed.getContainerDomNode();
      const rect = node ? node.getBoundingClientRect() : null;
      return rect && rect.width > 0 && rect.height > 40 && !ed.getOption(monaco.editor.EditorOption.readOnly);
    });

    return active || editors[0];
  }

  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    const { action, id, payload } = event.data;

    if (action === 'AP_PING') {
      const monaco = getMonacoInstance();
      const hasMonaco = !!monaco;
      const editorCount = hasMonaco ? monaco.editor.getEditors().length : 0;
      window.postMessage({ action: 'AP_PONG', id, hasMonaco, editorCount }, '*');
    }

    if (action === 'AP_READ_CODE') {
      try {
        const monaco = getMonacoInstance();
        if (!monaco) {
          // Check DOM fallback
          const monacoDom = document.querySelector('.monaco-editor');
          if (monacoDom) {
            const lines = [...monacoDom.querySelectorAll('.view-lines .view-line')].map(l => l.textContent).join('\n');
            window.postMessage({ action: 'AP_READ_CODE_RESULT', id, ok: true, code: lines, fromDom: true }, '*');
            return;
          }
          window.postMessage({ action: 'AP_READ_CODE_RESULT', id, ok: false, error: 'Monaco not available in main world' }, '*');
          return;
        }

        const editor = getActiveEditor(monaco);
        if (!editor) {
          window.postMessage({ action: 'AP_READ_CODE_RESULT', id, ok: false, error: 'No active Monaco editor instance found' }, '*');
          return;
        }

        const model = editor.getModel();
        const code = editor.getValue();
        const language = model && model.getLanguageId ? model.getLanguageId() : 'javascript';
        const uri = model && model.uri ? model.uri.toString() : '';

        window.postMessage({
          action: 'AP_READ_CODE_RESULT',
          id,
          ok: true,
          code,
          language,
          uri
        }, '*');
      } catch (err) {
        window.postMessage({ action: 'AP_READ_CODE_RESULT', id, ok: false, error: err.message }, '*');
      }
    }

    if (action === 'AP_WRITE_CODE') {
      const newCode = payload?.code || '';
      try {
        const monaco = getMonacoInstance();
        if (monaco) {
          const editor = getActiveEditor(monaco);
          if (editor && editor.getModel()) {
            const model = editor.getModel();
            editor.focus();
            
            // Execute edits to preserve undo stack and fire normal change events
            editor.executeEdits('ap-solver', [{
              range: model.getFullModelRange(),
              text: newCode,
              forceMoveMarkers: true
            }]);
            editor.pushUndoStop();

            // Verification
            const updated = editor.getValue();
            if (updated.trim().length > 0) {
              window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'executeEdits' }, '*');
              return;
            }

            // Fallback setValue
            model.setValue(newCode);
            window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'setValue' }, '*');
            return;
          }
        }

        // DOM Fallback
        const textarea = document.querySelector('.monaco-editor textarea.inputarea');
        if (textarea) {
          textarea.focus();
          document.execCommand('selectAll', false, null);
          const ok = document.execCommand('insertText', false, newCode);
          window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok, method: 'execCommand' }, '*');
          return;
        }

        window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: false, error: 'Could not find editor to write code' }, '*');
      } catch (err) {
        window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: false, error: err.message }, '*');
      }
    }

    if (action === 'AP_SELECT_ALL') {
      try {
        const monaco = getMonacoInstance();
        if (monaco) {
          const editor = getActiveEditor(monaco);
          if (editor && editor.getModel()) {
            editor.focus();
            editor.setSelection(editor.getModel().getFullModelRange());
            window.postMessage({ action: 'AP_SELECT_ALL_RESULT', id, ok: true }, '*');
            return;
          }
        }
        const textarea = document.querySelector('.monaco-editor textarea.inputarea');
        if (textarea) {
          textarea.focus();
          document.execCommand('selectAll', false, null);
          window.postMessage({ action: 'AP_SELECT_ALL_RESULT', id, ok: true }, '*');
          return;
        }
      } catch (err) {
        window.postMessage({ action: 'AP_SELECT_ALL_RESULT', id, ok: false, error: err.message }, '*');
      }
    }
  });
})();
