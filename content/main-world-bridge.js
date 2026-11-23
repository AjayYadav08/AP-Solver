// content/main-world-bridge.js - Injected into MAIN world to access window.monaco directly & navigate multi-file workspace
(() => {
  if (window.__apBridgeLoaded) return;
  window.__apBridgeLoaded = true;

  console.log('[AP-Solver Bridge] Main world multi-file bridge initialized.');

  function getMonacoInstance() {
    if (window.monaco && window.monaco.editor) {
      return window.monaco;
    }
    if (typeof window.require === 'function') {
      try {
        const m = window.require('vs/editor/editor.main');
        if (m && m.editor) return m;
      } catch (e) {}
    }
    for (const k of Object.keys(window)) {
      try {
        if (window[k]?.editor?.getModels) {
          return window[k];
        }
      } catch (e) {}
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

  // Helper: Trigger Ctrl+S / Cmd+S save
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

  // Helper: Extract active filename from breadcrumbs or active tab
  function detectActiveFileName(monaco) {
    // 1. Check breadcrumbs (e.g. "src > JS orderManager.js")
    const breadcrumbs = [...document.querySelectorAll('.breadcrumbs-widget .monaco-breadcrumb-item')].map(b => b.textContent.trim()).filter(Boolean);
    if (breadcrumbs.length > 0) {
      const last = breadcrumbs[breadcrumbs.length - 1].replace(/^[A-Z]+\s+/, '');
      if (last.includes('.')) {
        if (breadcrumbs.length >= 2 && breadcrumbs[0] === 'src') {
          return 'src/' + last;
        }
        return last;
      }
    }

    // 2. Check active tab in editor tabs bar
    const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
    const activeTab = tabs.find(t => t.classList.contains('active') || t.getAttribute('aria-selected') === 'true');
    if (activeTab) {
      const label = (activeTab.querySelector('.label-name') || activeTab).textContent.trim();
      if (label && !/welcome/i.test(label)) {
        return label;
      }
    }

    // 3. Check active Monaco editor model URI
    if (monaco && monaco.editor) {
      const ed = getActiveEditor(monaco);
      const m = ed?.getModel();
      if (m && m.uri) {
        const p = m.uri.path || m.uri.toString();
        const parts = p.split('/');
        const fname = parts[parts.length - 1];
        if (fname && !/welcome/i.test(fname)) {
          return p.includes('src/') ? 'src/' + fname : fname;
        }
      }
    }

    // 4. Fallback: check open non-welcome tab
    const openTab = tabs.find(t => {
      const txt = (t.querySelector('.label-name') || t).textContent.trim();
      return txt.includes('.') && !/welcome/i.test(txt);
    });
    if (openTab) {
      return (openTab.querySelector('.label-name') || openTab).textContent.trim();
    }

    return 'src/index.js';
  }

  // Helper: Scan all files visible in Explorer tree & Monaco models
  function scanAllWorkspaceFiles(monaco) {
    const files = new Set();

    // From Monaco loaded models
    if (monaco && monaco.editor) {
      const models = monaco.editor.getModels ? monaco.editor.getModels() : [];
      for (const m of models) {
        const p = m.uri?.path || m.uri?.toString() || '';
        const fname = p.split('/').pop();
        if (fname && fname.includes('.') && !/welcome|settings|workbench/i.test(fname)) {
          files.add(p.includes('src/') ? 'src/' + fname : fname);
        }
      }
    }

    // From Explorer tree DOM
    const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
    for (const row of treeRows) {
      const labelEl = row.querySelector('.label-name') || row;
      const text = labelEl.textContent.trim();
      if (text && text.includes('.') && !/^\s*$/.test(text)) {
        files.add(text);
      }
    }

    // From Tabs
    const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
    for (const tab of tabs) {
      const text = (tab.querySelector('.label-name') || tab).textContent.trim();
      if (text && text.includes('.') && !/welcome/i.test(text)) {
        files.add(text);
      }
    }

    return [...files];
  }

  // Helper: Navigate to or open a target file in VS Code
  async function navigateToTargetFile(targetFilePath, monaco) {
    const basename = targetFilePath.split('/').pop();
    const isSrc = targetFilePath.includes('src/');

    // 1. Check if already open and active
    const curActive = detectActiveFileName(monaco);
    if (curActive === targetFilePath || curActive.endsWith('/' + basename) || curActive === basename) {
      return true;
    }

    // 2. Check if open in tabs
    const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
    const matchingTab = tabs.find(t => {
      const txt = (t.querySelector('.label-name') || t).textContent.trim();
      return txt === basename || txt === targetFilePath;
    });
    if (matchingTab) {
      matchingTab.click();
      await new Promise(r => setTimeout(r, 100));
      return true;
    }

    // 3. Monaco Model Switch (Instant API switch)
    if (monaco && monaco.editor) {
      const models = monaco.editor.getModels ? monaco.editor.getModels() : [];
      const matchModel = models.find(m => {
        const p = m.uri?.path || m.uri?.toString() || '';
        return p.endsWith('/' + basename) || p.endsWith(targetFilePath);
      });
      const editor = getActiveEditor(monaco);
      if (matchModel && editor) {
        editor.setModel(matchModel);
        await new Promise(r => setTimeout(r, 100));
        return true;
      }
    }

    // 4. Explorer Tree Navigation
    const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];

    // If target is in src/, ensure src folder is expanded
    if (isSrc) {
      const srcFolder = treeRows.find(r => {
        const text = (r.querySelector('.label-name') || r).textContent.trim();
        return /^src$/i.test(text);
      });
      if (srcFolder) {
        const isCollapsed = srcFolder.getAttribute('aria-expanded') === 'false' ||
          !!srcFolder.querySelector('.collapsed, .codicon-chevron-right');
        if (isCollapsed) {
          srcFolder.click();
          const twistie = srcFolder.querySelector('.monaco-tl-twistie, .codicon');
          if (twistie) twistie.click();
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // Re-query rows after potential folder expansion
    const updatedRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"], .label-name, .monaco-icon-label')];
    const fileRow = updatedRows.find(r => {
      const text = (r.querySelector('.label-name') || r).textContent.trim();
      return text === basename || text === targetFilePath;
    });

    if (fileRow) {
      fileRow.click();
      fileRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      return true;
    }

    return false;
  }

  // Helper: Create a new file in workspace
  async function createNewFileInWorkspace(filePath, monaco, initialCode = '') {
    const basename = filePath.split('/').pop();
    const isSrc = filePath.includes('src/');

    // 1. If folder row exists (e.g. src), click it to select target directory
    if (isSrc) {
      const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
      const srcFolder = treeRows.find(r => /^src$/i.test((r.querySelector('.label-name') || r).textContent.trim()));
      if (srcFolder) srcFolder.click();
    }

    // 2. Click "New File" icon on Explorer title bar
    const newFileBtn = document.querySelector('.codicon-new-file, [aria-label*="New File" i], [title*="New File" i]');
    if (newFileBtn) {
      newFileBtn.click();
      await new Promise(r => setTimeout(r, 200));

      const input = document.querySelector('.monaco-inputbox input, .inputArea input, input.monaco-inputbox');
      if (input) {
        input.value = basename;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
    }

    // 3. Monaco API Model Creation
    if (monaco && monaco.editor && monaco.Uri) {
      const uri = monaco.Uri.file('/workspace/' + (filePath.startsWith('/') ? filePath.slice(1) : filePath));
      const model = monaco.editor.createModel(initialCode, 'javascript', uri);
      const editor = getActiveEditor(monaco);
      if (editor && model) {
        editor.setModel(model);
        triggerSave();
        return true;
      }
    }

    return false;
  }

  window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    const { action, id, payload } = event.data;

    if (action === 'AP_PING') {
      const monaco = getMonacoInstance();
      const hasMonaco = !!monaco;
      const editorCount = hasMonaco ? monaco.editor.getEditors().length : 0;
      window.postMessage({ action: 'AP_PONG', id, hasMonaco, editorCount }, '*');
    }

    if (action === 'AP_READ_CODE' || action === 'AP_SCAN_WORKSPACE') {
      try {
        const monaco = getMonacoInstance();
        const activeFile = detectActiveFileName(monaco);
        const allFiles = scanAllWorkspaceFiles(monaco);

        let code = '';
        let language = 'javascript';
        let uri = '';

        if (monaco) {
          const editor = getActiveEditor(monaco);
          if (editor) {
            code = editor.getValue();
            const model = editor.getModel();
            language = model?.getLanguageId ? model.getLanguageId() : 'javascript';
            uri = model?.uri ? model.uri.toString() : '';
          }
        }

        if (!code) {
          const monacoDom = document.querySelector('.monaco-editor');
          if (monacoDom) {
            const lines = [...monacoDom.querySelectorAll('.view-lines .view-line')].map(l => l.textContent).join('\n');
            code = lines;
          }
        }

        // Also extract snippets of JSON or helper files if loaded
        const referenceFiles = {};
        if (monaco && monaco.editor) {
          const models = monaco.editor.getModels ? monaco.editor.getModels() : [];
          for (const m of models) {
            const p = m.uri?.path || '';
            const fname = p.split('/').pop();
            if (fname && (fname.endsWith('.json') || fname.endsWith('.txt')) && !fname.includes('package-lock')) {
              const val = m.getValue();
              if (val && val.length < 5000) {
                referenceFiles[fname] = val;
              }
            }
          }
        }

        window.postMessage({
          action: 'AP_READ_CODE_RESULT',
          id,
          ok: true,
          code,
          language,
          uri,
          activeFile,
          allFiles,
          referenceFiles
        }, '*');
      } catch (err) {
        window.postMessage({ action: 'AP_READ_CODE_RESULT', id, ok: false, error: err.message }, '*');
      }
    }

    if (action === 'AP_NAVIGATE_FILE') {
      const targetFilePath = payload?.filePath || '';
      try {
        const monaco = getMonacoInstance();
        const ok = await navigateToTargetFile(targetFilePath, monaco);
        window.postMessage({ action: 'AP_NAVIGATE_FILE_RESULT', id, ok, filePath: targetFilePath }, '*');
      } catch (err) {
        window.postMessage({ action: 'AP_NAVIGATE_FILE_RESULT', id, ok: false, error: err.message }, '*');
      }
    }

    if (action === 'AP_CREATE_FILE') {
      const filePath = payload?.filePath || '';
      const initialCode = payload?.initialCode || '';
      try {
        const monaco = getMonacoInstance();
        const ok = await createNewFileInWorkspace(filePath, monaco, initialCode);
        window.postMessage({ action: 'AP_CREATE_FILE_RESULT', id, ok, filePath }, '*');
      } catch (err) {
        window.postMessage({ action: 'AP_CREATE_FILE_RESULT', id, ok: false, error: err.message }, '*');
      }
    }

    if (action === 'AP_WRITE_CODE') {
      const newCode = payload?.code || '';
      const targetFilePath = payload?.filePath || '';

      try {
        const monaco = getMonacoInstance();

        // 1. If target file specified, navigate to it first
        if (targetFilePath) {
          const navSuccess = await navigateToTargetFile(targetFilePath, monaco);
          if (!navSuccess) {
            // File might not exist yet -> create it!
            await createNewFileInWorkspace(targetFilePath, monaco, newCode);
            await new Promise(r => setTimeout(r, 150));
          }
        }

        // 2. Set value via Monaco API
        if (monaco && monaco.editor) {
          const models = monaco.editor.getModels ? monaco.editor.getModels() : [];
          let targetModel = null;

          if (targetFilePath) {
            const basename = targetFilePath.split('/').pop();
            targetModel = models.find(m => {
              const p = m.uri?.path || m.uri?.toString() || '';
              return p.endsWith('/' + basename) || p.endsWith(targetFilePath);
            });
          }

          if (!targetModel) {
            const editor = getActiveEditor(monaco);
            targetModel = editor?.getModel();
          }

          if (targetModel && typeof targetModel.setValue === 'function') {
            targetModel.setValue(newCode);
            const editor = getActiveEditor(monaco);
            if (editor && editor.getModel() !== targetModel) {
              editor.setModel(targetModel);
            }
            triggerSave();
            window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'model.setValue', filePath: targetFilePath }, '*');
            return;
          }
        }

        // 3. DOM Fallback: Multi-tier Select All, Wipe and Paste
        const editorDom = document.querySelector('.monaco-editor');
        const textarea = editorDom?.querySelector('textarea.inputarea') || document.querySelector('textarea.inputarea');
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
          document.execCommand('selectAll', false, null);

          // 4. Primary: Block Paste
          const dt = new DataTransfer();
          dt.setData('text/plain', newCode);

          try {
            document.execCommand('paste');
          } catch (e) {}

          try {
            const pasteEvt = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            });
            textarea.dispatchEvent(pasteEvt);
            if (editorDom) editorDom.dispatchEvent(pasteEvt);
          } catch (e) {}

          try {
            textarea.dispatchEvent(new InputEvent('beforeinput', {
              inputType: 'insertFromPaste',
              data: newCode,
              dataTransfer: dt,
              bubbles: true,
              cancelable: true
            }));
          } catch (e) {}

          // Fallback only if needed
          const viewLines = document.querySelector('.monaco-editor .view-lines');
          const linesCheck = viewLines ? [...viewLines.querySelectorAll('.view-line')].map(l => l.textContent).join('\n') : '';
          if (linesCheck.length < 50) {
            try {
              document.execCommand('insertText', false, newCode);
            } catch (e) {}
          }

          triggerSave();
          window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'dom.wipeAndPaste', filePath: targetFilePath }, '*');
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
