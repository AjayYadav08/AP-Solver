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

    // Prefer visible, non-readonly editor (excluding HTTP tester response panes)
    const active = editors.find((ed) => {
      const node = ed.getContainerDomNode ? ed.getContainerDomNode() : null;
      if (node && node.closest?.('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], #ap-solver-host')) return false;
      const rect = node ? node.getBoundingClientRect() : null;
      return rect && rect.width > 0 && rect.height > 40 && !ed.getOption(monaco.editor.EditorOption.readOnly);
    });

    return active || editors.find(ed => {
      const node = ed.getContainerDomNode ? ed.getContainerDomNode() : null;
      return !node?.closest?.('[class*="response" i], [class*="http-request" i], #ap-solver-host');
    }) || editors[0];
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

  // Helper: Simulate realistic user click and dblclick using PointerEvent and MouseEvent with accurate coordinates
  function simulateClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch(e) {}
    try { el.focus(); } catch(e) {}
    const list = el.closest?.('.monaco-list, .monaco-tree-view');
    if (list) { try { list.focus(); } catch(e) {} }

    const target = el.querySelector?.('.label-name, .monaco-icon-label') || el;
    const rect = target.getBoundingClientRect();
    const clientX = (rect.left + rect.width / 2) || 150;
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

    // Click 1 (detail: 1)
    const clickOpts1 = { ...baseOpts, detail: 1 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new PointerEvent('pointerup', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', clickOpts1)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('click', clickOpts1)); } catch (e) {}

    // Click 2 (detail: 2) -> Required by Monaco / VS Code for double click detection
    const clickOpts2 = { ...baseOpts, detail: 2 };
    try { target.dispatchEvent(new PointerEvent('pointerdown', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new PointerEvent('pointerup', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('click', clickOpts2)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent('dblclick', clickOpts2)); } catch (e) {}

    if (target !== el) {
      try { el.dispatchEvent(new PointerEvent('pointerdown', clickOpts1)); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', clickOpts1)); } catch (e) {}
      try { el.dispatchEvent(new PointerEvent('pointerup', clickOpts1)); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', clickOpts1)); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('click', clickOpts1)); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('dblclick', clickOpts2)); } catch (e) {}
    }

    try { el.click?.(); } catch (e) {}
    try { target.click?.(); } catch (e) {}

    // Enter keydown / keyup to open item in VS Code tree
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (target !== el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
    } catch (e) {}

    return true;
  }

  function findExplorerItem(name) {
    const base = name.split('/').pop().trim().toLowerCase();
    const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
    return rows.find(r => {
      const aria = (r.getAttribute('aria-label') || '').trim().toLowerCase();
      if (aria === base || aria.startsWith(base)) return true;
      const title = (r.getAttribute('title') || '').trim().toLowerCase();
      if (title === base || title.endsWith(base) || title.includes(base)) return true;
      const labelEl = r.querySelector('.label-name, .monaco-icon-label');
      const text = (labelEl?.textContent || r.textContent || '').trim().toLowerCase();
      return text === base || text.startsWith(base) || text.split(/\s+/)[0] === base;
    });
  }

  // Helper: Navigate to or open a target file in VS Code
  async function navigateToTargetFile(targetFilePath, monaco) {
    if (!targetFilePath) return false;
    const basename = targetFilePath.split('/').pop();
    const isSrc = targetFilePath.includes('src/') || /\.(js|ts|json|txt)$/i.test(targetFilePath);

    // 1. Close Welcome tab if open
    const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
    const welcomeTab = tabs.find(t => /welcome/i.test((t.querySelector('.label-name') || t).textContent.trim()));
    if (welcomeTab) {
      const closeBtn = welcomeTab.querySelector('.tab-close-action, .codicon-close');
      if (closeBtn) closeBtn.click();
    }

    // 2. Check if already open and active
    const activeTabEl = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
    const activeLabel = (activeTabEl?.querySelector('.label-name') || activeTabEl)?.textContent?.trim() || '';
    if (activeLabel === basename || activeLabel.startsWith(basename)) {
      return true;
    }

    // 3. Check if open in tabs
    const matchingTab = tabs.find(t => {
      const aria = (t.getAttribute('aria-label') || '').trim();
      if (aria === basename || aria.includes(basename)) return true;
      const txt = (t.querySelector('.label-name') || t).textContent.trim();
      return txt === basename || txt.startsWith(basename) || txt.includes(basename);
    });
    if (matchingTab) {
      simulateClick(matchingTab);
      await new Promise(r => setTimeout(r, 200));
      const curTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
      const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
      if (curTxt === basename || curTxt.startsWith(basename)) {
        return true;
      }
    }

    // 4. Monaco Model Switch (Instant API switch if model already in memory)
    if (monaco && monaco.editor) {
      const models = monaco.editor.getModels ? monaco.editor.getModels() : [];
      const matchModel = models.find(m => {
        const p = m.uri?.path || m.uri?.toString() || '';
        return p.endsWith('/' + basename) || p.endsWith(targetFilePath);
      });
      const editor = getActiveEditor(monaco);
      if (matchModel && editor) {
        editor.setModel(matchModel);
        await new Promise(r => setTimeout(r, 150));
        return true;
      }
    }

    // 5. Expand 'src' folder if target is in src/
    if (isSrc) {
      const srcItem = findExplorerItem('src');
      if (srcItem) {
        const isCollapsed = srcItem.getAttribute('aria-expanded') === 'false' ||
          !!srcItem.querySelector('.collapsed, .codicon-chevron-right');
        if (isCollapsed) {
          const twistie = srcItem.querySelector('.monaco-tl-twistie, .codicon-chevron-right, .codicon');
          simulateClick(twistie || srcItem);
          await new Promise(r => setTimeout(r, 350));
        }
      }
    }

    // 6. Find and click target file in Explorer tree
    const fileRow = findExplorerItem(basename);
    if (fileRow) {
      simulateClick(fileRow);
      // Poll up to 1.5s for tab or active editor to switch
      const t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        const curTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
        const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
        if (curTxt === basename || curTxt.startsWith(basename)) {
          return true;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      return true;
    }

    return false;
  }

  // Helper: Create a new file in workspace
  async function createNewFileInWorkspace(filePath, monaco, initialCode = '') {
    if (!filePath) return false;
    const basename = filePath.split('/').pop().trim();
    if (!basename || !basename.includes('.') || /^(1|2|3|4|5|one|two)(\.(js|ts))?$/i.test(basename)) {
      return false;
    }
    const isSrc = filePath.includes('src/') || /\.(js|ts|json|txt)$/i.test(filePath);

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
      const normPath = filePath.startsWith('/') ? filePath : '/' + filePath;
      const fullUri = monaco.Uri.file('/workspace' + (normPath.startsWith('/src/') ? normPath : '/src' + normPath));
      const model = monaco.editor.createModel(initialCode, 'javascript', fullUri);
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
            await new Promise(r => setTimeout(r, 200));
          }
        }

        // 2. Set value via Monaco API
        if (monaco && monaco.editor) {
          const getModelsFn = monaco.editor.getModels;
          let targetModel = null;
          const basename = targetFilePath ? targetFilePath.split('/').pop() : null;

          // Poll for targetModel matching basename (up to 2s)
          const t0 = Date.now();
          while (Date.now() - t0 < 2000) {
            const models = getModelsFn ? getModelsFn.call(monaco.editor) : [];
            if (basename) {
              targetModel = models.find(m => {
                const p = m.uri?.path || m.uri?.toString() || '';
                return p.endsWith('/' + basename) || p.endsWith(targetFilePath);
              });
            } else {
              targetModel = models[0];
            }
            if (targetModel) break;
            await new Promise(r => setTimeout(r, 100));
          }

          // If targetModel found, write directly into it!
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

          // If targetFilePath is specified, check if active editor tab actually matches target
          const activeFileName = detectActiveFileName(monaco);
          const isTargetActuallyActive = !basename || activeFileName.toLowerCase().includes(basename.toLowerCase());

          // If target is active in activeEd, write to its model
          if (isTargetActuallyActive) {
            const editor = getActiveEditor(monaco);
            const activeModel = editor?.getModel();
            if (activeModel && typeof activeModel.setValue === 'function') {
              activeModel.setValue(newCode);
              triggerSave();
              window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'monaco.activeModel.setValue', filePath: targetFilePath }, '*');
              return;
            }
          }

          // If targetFilePath was NOT specified, write into active editor
          if (!targetFilePath) {
            const editor = getActiveEditor(monaco);
            const activeModel = editor?.getModel();
            if (activeModel && typeof activeModel.setValue === 'function') {
              activeModel.setValue(newCode);
              triggerSave();
              window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'monaco.activeModel.setValue' }, '*');
              return;
            }
          }
        }

        // 3. DOM Fallback: ONLY if active tab or breadcrumb matches targetFilePath
        const curActive = detectActiveFileName(monaco);
        const basename = targetFilePath ? targetFilePath.split('/').pop() : '';
        const normStr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '');
        const isTargetActive = !targetFilePath || normStr(curActive).includes(normStr(basename));

        if (isTargetActive) {
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

            // 4. Primary: Block Paste & insertText
            const dt = new DataTransfer();
            dt.setData('text/plain', newCode);

            try { document.execCommand('paste'); } catch (e) {}

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

            // Ensure text is actually inserted
            try {
              document.execCommand('insertText', false, newCode);
            } catch (e) {}

            triggerSave();
            window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: true, method: 'dom.insertTextAndPaste', filePath: targetFilePath }, '*');
            return;
          }
        }

        window.postMessage({ action: 'AP_WRITE_CODE_RESULT', id, ok: false, error: 'Could not find target model or editor for ' + targetFilePath }, '*');
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
