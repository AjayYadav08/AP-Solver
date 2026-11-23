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
        function triggerSave() {
          const isMac = /mac/i.test(navigator.platform);
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
          const ta = document.querySelector('.monaco-editor textarea.inputarea');
          if (ta) ta.dispatchEvent(saveEvt);
        }

        const monaco = getMonacoInstance();
        if (monaco && monaco.editor) {
          // Check all models for index.js
          const models = monaco.editor.getModels ? monaco.editor.getModels() : [];
          const indexModel = models.find((m) => /index\.(js|ts)/i.test(m.uri?.path || m.uri?.toString() || ''));
          if (indexModel) {
            indexModel.setValue(newCode);
            triggerSave();
            window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'model.setValue' }, '*');
            return;
          }

          const editor = getActiveEditor(monaco);
          if (editor && editor.getModel()) {
            const model = editor.getModel();
            editor.focus();
            model.setValue(newCode);
            triggerSave();
            window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'activeEditor.setValue' }, '*');
            return;
          }
        }

        // DOM Fallback
        const editorDom = document.querySelector('.monaco-editor');
        const textarea = editorDom?.querySelector('textarea.inputarea');
        if (textarea) {
          textarea.focus();
          document.execCommand('selectAll', false, null);

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
          } catch (e) {}

          triggerSave();
          window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'dom.paste' }, '*');
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
