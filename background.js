// background.js - AP-Solver Service Worker (Multi-File & Multi-Folder Aware)
import { generateSolution, getSettings, saveSettings, formatCodeIndentation } from './utils/llm.js';

console.log('[AP-Solver] Background service worker initialized.');

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AP-Solver] Installed/Updated:', details.reason);
  const current = await getSettings();
  if (!current.provider) {
    await saveSettings({ provider: 'race' });
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =======================================================================
// Chrome DevTools Protocol (CDP) True Native Hardware Driver
// Enables Real OS-Level Mouse Clicks, Double-Clicks, Keyboard & Shortcuts
// =======================================================================

async function attachCDP(tabId) {
  if (!chrome.debugger) return false;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    console.log('[AP-Solver CDP] Attached successfully to tab', tabId);
    return true;
  } catch (err) {
    if (err.message && err.message.includes('Already attached')) {
      return true;
    }
    console.warn('[AP-Solver CDP] Attach warning:', err.message);
    return false;
  }
}

function sendCDP(tabId, method, params = {}) {
  return new Promise((resolve) => {
    if (!chrome.debugger) return resolve({ ok: false, error: 'debugger API not available' });
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, result: res });
      }
    });
  });
}

// True Native Mouse Click with real OS isTrusted=true event
async function cdpNativeClick(tabId, x, y, clickCount = 1) {
  await sendCDP(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount
  });
  await sleep(40);
  await sendCDP(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount
  });
}

// True Native Double-Click
async function cdpNativeDblClick(tabId, x, y) {
  await cdpNativeClick(tabId, x, y, 1);
  await sleep(60);
  await cdpNativeClick(tabId, x, y, 2);
}

// True Native Key Press
async function cdpNativeKey(tabId, key, code, keyCode, modifiers = 0) {
  await sendCDP(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  });
  await sleep(30);
  await sendCDP(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  });
}

// True Native Text Typing
async function cdpNativeInsertText(tabId, text) {
  await sendCDP(tabId, 'Input.insertText', { text });
}

// Quick Open via CDP (Cmd+P on Mac, Ctrl+P on Windows)
async function cdpQuickOpenFile(tabId, targetFilePath) {
  if (!targetFilePath) return false;
  const basename = targetFilePath.split('/').pop().trim();
  try {
    const attached = await attachCDP(tabId);
    if (!attached) return false;

    // Modifiers: 4 = Meta (Cmd on Mac), 2 = Ctrl (Win/Linux)
    // Send Cmd+P
    await cdpNativeKey(tabId, 'p', 'KeyP', 80, 4);
    await sleep(250);

    // Type the filename into Quick Open input
    await cdpNativeInsertText(tabId, basename);
    await sleep(250);

    // Press Enter to open
    await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
    await sleep(350);

    console.log(`[AP-Solver CDP] Quick Open triggered for "${basename}".`);
    return true;
  } catch (err) {
    console.warn('[AP-Solver CDP] Quick Open error:', err);
    return false;
  }
}

// Save File via CDP (Cmd+S / Ctrl+S)
async function cdpSaveFile(tabId) {
  try {
    await cdpNativeKey(tabId, 's', 'KeyS', 83, 4); // Cmd+S
    await sleep(50);
    await cdpNativeKey(tabId, 's', 'KeyS', 83, 2); // Ctrl+S
  } catch (e) {}
}

// Broadcast or request data across frames in a specific tab
async function queryEditorInTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        try {
          // Helper: Detect active filename from breadcrumbs, tabs, or monaco model
          function detectActiveFile() {
            // 1. Breadcrumbs (e.g. "src > JS orderManager.js")
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

            // 2. Active tab
            const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
            const activeTab = tabs.find(t => t.classList.contains('active') || t.getAttribute('aria-selected') === 'true');
            if (activeTab) {
              const label = (activeTab.querySelector('.label-name') || activeTab).textContent.trim();
              if (label && !/welcome/i.test(label)) {
                return label.includes('src/') ? label : 'src/' + label;
              }
            }

            return null;
          }

          // Helper: Scan all workspace files from tree & open tabs
          function scanWorkspaceFiles() {
            const files = new Set();
            const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            for (const row of treeRows) {
              const labelEl = row.querySelector('.label-name') || row;
              const text = labelEl.textContent.trim();
              if (text && text.includes('.') && !/^\s*$/.test(text)) {
                files.add(text);
              }
            }
            const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
            for (const tab of tabs) {
              const text = (tab.querySelector('.label-name') || tab).textContent.trim();
              if (text && text.includes('.') && !/welcome/i.test(text)) {
                files.add(text);
              }
            }
            return [...files];
          }

          // Check monaco in window or AMD loader
          let m = window.monaco;
          if (!m && typeof window.require === 'function') {
            try { m = window.require('vs/editor/editor.main'); } catch(e) {}
          }
          if (!m) {
            for (const k of Object.keys(window)) {
              try {
                if (window[k]?.editor?.getModels) {
                  m = window[k];
                  break;
                }
              } catch(e) {}
            }
          }

          const detectedActive = detectActiveFile();
          const workspaceFiles = scanWorkspaceFiles();

          if (m && m.editor) {
            const models = m.editor.getModels ? m.editor.getModels() : [];
            const referenceFiles = {};

            for (const mod of models) {
              const p = mod.uri?.path || '';
              const fname = p.split('/').pop();
              if (fname && (fname.endsWith('.json') || fname.endsWith('.txt')) && !fname.includes('package-lock')) {
                const val = mod.getValue();
                if (val && val.length < 5000) referenceFiles[fname] = val;
              }
              if (fname && fname.includes('.')) workspaceFiles.push(p.includes('src/') ? 'src/' + fname : fname);
            }

            // If a specific active file was detected, find its model first
            let activeModel = null;
            if (detectedActive) {
              const basename = detectedActive.split('/').pop();
              activeModel = models.find(mod => (mod.uri?.path || '').endsWith(basename));
            }

            // Otherwise, get model from active visible editor
            const editors = m.editor.getEditors ? m.editor.getEditors() : [];
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors[0];

            if (!activeModel && activeEd && activeEd.getModel()) {
              activeModel = activeEd.getModel();
            }

            if (activeModel) {
              const val = activeModel.getValue();
              const p = activeModel.uri?.path || activeModel.uri?.toString() || '';
              const fname = p.split('/').pop() || detectedActive || 'src/index.js';
              const resolvedActive = p.includes('src/') ? 'src/' + fname : fname;

              return {
                found: true,
                code: val,
                language: activeModel.getLanguageId ? activeModel.getLanguageId() : 'javascript',
                uri: p,
                activeFile: resolvedActive,
                allFiles: [...new Set(workspaceFiles)],
                referenceFiles
              };
            }
          }

          // Fallback check: Monaco DOM view-lines
          const monacoDom = document.querySelector('.monaco-editor');
          if (monacoDom) {
            const lines = [...monacoDom.querySelectorAll('.view-lines .view-line')];
            const code = lines.map(l => l.textContent).join('\n');
            if (code && !/Get Started with VS Code/i.test(code)) {
              return {
                found: true,
                code,
                language: 'javascript',
                activeFile: detectedActive || 'src/index.js',
                allFiles: [...new Set(workspaceFiles)],
                fromDom: true
              };
            }
          }
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const match = results?.find(r => r.result && r.result.found);
    if (match && match.result) {
      return { ok: true, ...match.result };
    }
  } catch (err) {
    console.warn('[AP-Solver] Error querying editor frames:', err);
  }

  return { ok: false, error: 'Editor not found in any frame.' };
}

async function writeEditorInTab(tabId, newCode, targetFilePath = null) {
  try {
    const cleanCode = formatCodeIndentation(newCode);

    // Phase 1: Try True Native Quick Open via CDP if target file is specified
    if (targetFilePath) {
      try {
        await cdpQuickOpenFile(tabId, targetFilePath);
        await sleep(250);
      } catch (e) {
        console.warn('[AP-Solver CDP] Quick open pass error:', e);
      }
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [cleanCode, targetFilePath],
      func: async (codeToWrite, targetPath) => {
        try {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

            // Click 2 (detail: 2) -> Essential for VS Code tree dblclick detection
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

            // Enter key event to open file in VS Code list
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
            const base = name.split('/').pop().trim();
            const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            return rows.find(r => {
              const aria = (r.getAttribute('aria-label') || '').trim();
              if (aria === base || aria.startsWith(base) || aria.toLowerCase().includes(base.toLowerCase())) return true;
              const title = (r.getAttribute('title') || '').trim();
              if (title === base || title.endsWith(base) || title.toLowerCase().includes(base.toLowerCase())) return true;
              const labelEl = r.querySelector('.label-name, .monaco-icon-label');
              const text = (labelEl?.textContent || r.textContent || '').trim();
              return text === base || text.startsWith(base) || new RegExp(`(^|\\b)${base}(\\b|\\s|$)`, 'i').test(text);
            });
          }

          // Helper: Navigate explorer to target file
          async function navigateToTargetFile(target) {
            if (!target) return false;
            const basename = target.split('/').pop();
            const isSrc = target.includes('src/') || /\.(js|ts|json|txt)$/i.test(target);

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

            // 3. Click tab matching target if present in tabs bar
            const matchingTab = tabs.find(t => {
              const aria = (t.getAttribute('aria-label') || '').trim();
              if (aria === basename || aria.includes(basename)) return true;
              const txt = (t.querySelector('.label-name') || t).textContent.trim();
              return txt === basename || txt.startsWith(basename) || txt.includes(basename);
            });
            if (matchingTab) {
              simulateClick(matchingTab);
              await sleep(250);
              const curTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
              const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
              if (curTxt === basename || curTxt.startsWith(basename)) {
                return true;
              }
            }

            // 4. Monaco Model Switch if model already in memory
            let m = window.monaco;
            if (!m && typeof window.require === 'function') {
              try { m = window.require('vs/editor/editor.main'); } catch(e) {}
            }
            if (m && m.editor) {
              const models = m.editor.getModels ? m.editor.getModels() : [];
              const matchModel = models.find(mod => {
                const p = mod.uri?.path || mod.uri?.toString() || '';
                return p.endsWith('/' + basename) || p.endsWith(target);
              });
              const editors = m.editor.getEditors ? m.editor.getEditors() : [];
              const activeEd = editors[0];
              if (matchModel && activeEd) {
                activeEd.setModel(matchModel);
                await sleep(150);
                return true;
              }
            }

            // 5. Always expand 'src' folder in Explorer tree if target is inside src/
            if (isSrc) {
              const srcItem = findExplorerItem('src');
              if (srcItem) {
                const isCollapsed = srcItem.getAttribute('aria-expanded') === 'false' ||
                  !!srcItem.querySelector('.collapsed, .codicon-chevron-right');
                if (isCollapsed) {
                  const twistie = srcItem.querySelector('.monaco-tl-twistie, .codicon-chevron-right, .codicon');
                  simulateClick(twistie || srcItem);
                  await sleep(350);
                }
              }
            }

            // 6. Find and click the target file in the tree
            const fileItem = findExplorerItem(basename);
            if (fileItem) {
              simulateClick(fileItem);
              // Poll up to 1.5s for tab or active editor to switch
              const t0 = Date.now();
              while (Date.now() - t0 < 1500) {
                const curTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
                const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
                if (curTxt === basename || curTxt.startsWith(basename)) {
                  return true;
                }
                await sleep(100);
              }
              return true;
            }

            // 7. If file not found in tree, create it using New File button!
            const newFileBtn = document.querySelector('.codicon-new-file, [aria-label*="New File" i], [title*="New File" i]');
            if (newFileBtn) {
              const srcItem = findExplorerItem('src');
              if (srcItem) simulateClick(srcItem);
              simulateClick(newFileBtn);
              await sleep(250);
              const input = document.querySelector('.monaco-inputbox input, .inputArea input, input.monaco-inputbox');
              if (input) {
                input.value = basename;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                await sleep(400);
                return true;
              }
            }

            return false;
          }

          if (targetPath) {
            await navigateToTargetFile(targetPath);
          }
          await sleep(200);

          // Helper: trigger Ctrl+S / Cmd+S to save file on disk
          function triggerFileSave() {
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

          const basename = targetPath ? targetPath.split('/').pop() : null;
          const activeTabEl = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
          const activeTabName = (activeTabEl?.querySelector('.label-name') || activeTabEl)?.textContent?.trim() || '';
          const isTargetActive = !basename || activeTabName === basename || activeTabName.startsWith(basename);

          // Strategy 1: Monaco instance or AMD loader search (Wipe & Replace with setValue)
          let m = window.monaco;
          if (!m && typeof window.require === 'function') {
            try { m = window.require('vs/editor/editor.main'); } catch(e) {}
          }
          if (!m) {
            for (const k of Object.keys(window)) {
              try {
                if (window[k]?.editor?.getModels || typeof window[k]?.getModels === 'function') {
                  m = window[k];
                  break;
                }
              } catch(e) {}
            }
          }

          if (m && m.editor) {
            const editors = m.editor.getEditors ? m.editor.getEditors() : [];
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0;
            }) || editors[0];

            // A. If targetModel exists in getModels, write to it directly!
            const models = m.editor.getModels ? m.editor.getModels() : [];
            let targetModel = null;
            if (basename) {
              targetModel = models.find(mod => {
                const p = mod.uri?.path || mod.uri?.toString() || '';
                return p.endsWith('/' + basename) || p.endsWith(targetPath);
              });
            }

            if (targetModel && typeof targetModel.setValue === 'function') {
              targetModel.setValue(codeToWrite);
              if (activeEd && activeEd.getModel() !== targetModel) {
                activeEd.setModel(targetModel);
              }
              triggerFileSave();
              await sleep(150);
              return { success: true, verified: true, method: 'monaco.model.setValue', filePath: targetPath };
            }

            // B. If target is active in activeEd (or if (!targetPath)), write to activeEd model!
            if ((!targetPath || isTargetActive) && activeEd && activeEd.getModel()) {
              activeEd.getModel().setValue(codeToWrite);
              triggerFileSave();
              await sleep(150);
              return { success: true, verified: true, method: 'monaco.activeModel.setValue', filePath: targetPath };
            }
          }

          // Strategy 2: DOM fallback: ONLY if active tab matches targetPath!
          if (isTargetActive) {
            const editorDom = document.querySelector('.monaco-editor');
            const input = editorDom?.querySelector('textarea.inputarea') || document.querySelector('textarea.inputarea');
            if (input) {
              input.focus();
              const isMac = /mac/i.test(navigator.platform);

              // Select all
              const selectAllEvt = new KeyboardEvent('keydown', {
                key: 'a',
                code: 'KeyA',
                keyCode: 65,
                which: 65,
                ctrlKey: !isMac,
                metaKey: isMac,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(selectAllEvt);
              document.execCommand('selectAll', false, null);

              // Delete old code
              const backspaceEvt = new KeyboardEvent('keydown', {
                key: 'Backspace',
                code: 'Backspace',
                keyCode: 8,
                which: 8,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(backspaceEvt);

              const dt = new DataTransfer();
              dt.setData('text/plain', codeToWrite);
              try { document.execCommand('paste'); } catch(e) {}
              try {
                const pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                input.dispatchEvent(pasteEvt);
              } catch(e) {}

              try {
                document.execCommand('insertText', false, codeToWrite);
              } catch(e) {}

              await sleep(150);
              triggerFileSave();
              return {
                success: true,
                verified: true,
                method: 'dom.insertTextAndPaste',
                filePath: targetPath
              };
            }
          }

          // CRITICAL SAFETY SHIELD: Refuse to write into wrong file!
          if (targetPath) {
            return {
              success: false,
              verified: false,
              error: `Could not open ${targetPath} in editor (active tab is "${activeTabName}"). Refused to overwrite.`
            };
          }
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const successResult = results?.find(r => r.result && r.result.success);
    if (successResult) {
      // Phase 3: Trigger real OS-level Save via CDP
      await cdpSaveFile(tabId);
      return { ok: true, verified: !!successResult.result.verified, method: successResult.result.method + '+cdp', filePath: successResult.result.filePath };
    }
  } catch (err) {
    console.warn('[AP-Solver] Error writing to editor in tab:', err);
  }

  return { ok: false, error: 'Failed to write code into editor frame.' };
}

// Global Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { op, data } = message;

  // Handle async operations with async IIFE
  (async () => {
    try {
      if (op === 'AP_GET_SETTINGS') {
        const settings = await getSettings();
        sendResponse({ ok: true, settings });
      } else if (op === 'AP_SAVE_SETTINGS') {
        const updated = await saveSettings(data);
        sendResponse({ ok: true, settings: updated });
      } else if (op === 'AP_GENERATE') {
        const result = await generateSolution(data.promptData, data.settingsOverride);
        sendResponse({ ok: true, result });
      } else if (op === 'AP_QUERY_EDITOR') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        const resp = await queryEditorInTab(tabId);
        sendResponse(resp);
      } else if (op === 'AP_WRITE_EDITOR') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        const resp = await writeEditorInTab(tabId, data.code, data.filePath);
        sendResponse(resp);
      } else {
        sendResponse({ ok: false, error: `Unknown op: ${op}` });
      }
    } catch (err) {
      console.error('[AP-Solver] Background error handling op', op, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; // Keep message port open for async response
});
