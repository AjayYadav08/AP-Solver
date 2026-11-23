// background.js - AP-Solver Service Worker
import { generateSolution, getSettings, saveSettings } from './utils/llm.js';

console.log('[AP-Solver] Background service worker initialized.');

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AP-Solver] Installed/Updated:', details.reason);
  const current = await getSettings();
  if (!current.provider) {
    await saveSettings({ provider: 'gemini' });
  }
});

// Broadcast or request data across frames in a specific tab
async function queryEditorInTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        try {
          // Helper: navigate to index.js if needed
          const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
          const hasIndexTab = tabs.some(t => /index\.(js|ts)/i.test(t.textContent.trim()));
          if (!hasIndexTab) {
            // Find src and index.js
            const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            const srcRow = treeRows.find(r => /^src$/i.test((r.querySelector('.label-name') || r).textContent.trim()));
            if (srcRow) {
              srcRow.click();
              const twistie = srcRow.querySelector('.monaco-tl-twistie, .codicon');
              if (twistie) twistie.click();
            }
            const indexItem = treeRows.find(r => /^index\.(js|ts)$/i.test((r.querySelector('.label-name') || r).textContent.trim()));
            if (indexItem) {
              indexItem.click();
              indexItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            }
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
          if (m && m.editor) {
            const models = m.editor.getModels ? m.editor.getModels() : [];
            const indexModel = models.find(mod => /index\.(js|ts)/i.test(mod.uri?.path || mod.uri?.toString() || ''));
            if (indexModel) {
              return {
                found: true,
                code: indexModel.getValue(),
                language: 'javascript',
                uri: indexModel.uri ? indexModel.uri.toString() : 'src/index.js'
              };
            }

            const editors = m.editor.getEditors ? m.editor.getEditors() : [];
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors[0];

            if (activeEd && activeEd.getModel()) {
              const model = activeEd.getModel();
              const val = activeEd.getValue();
              if (val && !/Get Started with VS Code/i.test(val)) {
                return {
                  found: true,
                  code: val,
                  language: model.getLanguageId ? model.getLanguageId() : 'javascript',
                  uri: model.uri ? model.uri.toString() : 'src/index.js'
                };
              }
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
                activeFile: 'index.js',
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

async function writeEditorInTab(tabId, newCode) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [newCode],
      func: async (codeToWrite) => {
        try {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

          // Helper: Navigate explorer to ensure src/index.js is open
          function navigateToTargetFile() {
            try {
              // 1. Close Welcome tab if open
              const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
              const welcomeTab = tabs.find(t => /welcome/i.test(t.textContent.trim()));
              if (welcomeTab) {
                const closeBtn = welcomeTab.querySelector('.tab-close-action, .codicon-close');
                if (closeBtn) closeBtn.click();
              }

              // 2. Click index.js tab if present
              const indexTab = tabs.find(t => /index\.(js|ts)/i.test(t.textContent.trim()));
              if (indexTab) {
                indexTab.click();
                return;
              }

              // 3. Look in Explorer file tree
              const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
              const srcRow = treeRows.find(r => {
                const text = (r.querySelector('.label-name') || r).textContent.trim();
                return /^src$/i.test(text);
              });
              if (srcRow) {
                const isCollapsed = srcRow.getAttribute('aria-expanded') === 'false' ||
                  !!srcRow.querySelector('.collapsed, .codicon-chevron-right');
                if (isCollapsed) {
                  srcRow.click();
                  const twistie = srcRow.querySelector('.monaco-tl-twistie, .codicon');
                  if (twistie) twistie.click();
                }
              }

              // Find and open index.js
              const allTreeItems = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"], .monaco-icon-label')];
              const indexItem = allTreeItems.find(r => {
                const text = (r.querySelector('.label-name') || r).textContent.trim();
                return /^index\.(js|ts)$/i.test(text);
              });
              if (indexItem) {
                indexItem.click();
                indexItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
              }
            } catch (e) {}
          }

          navigateToTargetFile();
          await sleep(100);

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

          // Helper: check if editor DOM currently shows the updated code
          function checkEditorDomVerified() {
            const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].map(l => l.textContent).join('\n');
            const hasOld501 = /res\.statusCode\s*=\s*501/i.test(lines);
            const countHttp = (lines.match(/require\(['"](?:node:)?http['"]\)/g) || []).length;
            const hasNewCode = lines.length > 50 && !hasOld501 && countHttp <= 1;
            return { verified: hasNewCode, linesLength: lines.length, hasOld501, countHttp };
          }

          // Strategy 1: Monaco instance or AMD loader search (Wipe & Replace with setValue)
          let m = window.monaco;
          if (!m && typeof window.require === 'function') {
            const amdMods = ['vs/editor/editor.main', 'vs/editor/common/services/modelService', 'vs/editor/browser/services/codeEditorService'];
            for (const modName of amdMods) {
              try {
                const loaded = await new Promise((res) => {
                  try {
                    window.require([modName], (mod) => res(mod), () => res(null));
                    setTimeout(() => res(null), 150);
                  } catch(e) { res(null); }
                });
                if (loaded?.editor?.getModels || loaded?.getModels) {
                  m = loaded;
                  break;
                }
              } catch(e) {}
            }
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

          if (m) {
            const getModelsFn = m.editor?.getModels || m.getModels;
            if (typeof getModelsFn === 'function') {
              const models = getModelsFn.call(m.editor || m) || [];
              const indexModel = models.find(mod => /index\.(js|ts)/i.test(mod.uri?.path || mod.uri?.toString() || '')) || models[0];
              if (indexModel && typeof indexModel.setValue === 'function') {
                indexModel.setValue(codeToWrite);
                triggerFileSave();
                await sleep(150);
                return { success: true, verified: true, method: 'monaco.model.setValue' };
              }
            }

            const editors = m.editor?.getEditors ? m.editor.getEditors() : [];
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors[0];

            if (activeEd && activeEd.getModel()) {
              activeEd.focus();
              activeEd.getModel().setValue(codeToWrite);
              triggerFileSave();
              await sleep(150);
              return { success: true, verified: true, method: 'monaco.activeEd.setValue' };
            }
          }

          // Strategy 2: Check DOM element properties for Monaco Editor instance
          const editorDom = document.querySelector('.monaco-editor');
          if (editorDom) {
            const domElements = [editorDom, editorDom.parentElement, editorDom.querySelector('.overflow-guard')].filter(Boolean);
            for (const el of domElements) {
              for (const k of Object.keys(el)) {
                try {
                  const val = el[k];
                  if (val && typeof val === 'object') {
                    if (typeof val.getModel === 'function' && typeof val.setValue === 'function') {
                      val.setValue(codeToWrite);
                      triggerFileSave();
                      await sleep(150);
                      return { success: true, verified: true, method: 'domInstance.setValue' };
                    }
                    if (val._model && typeof val._model.setValue === 'function') {
                      val._model.setValue(codeToWrite);
                      triggerFileSave();
                      await sleep(150);
                      return { success: true, verified: true, method: 'domInstance._model.setValue' };
                    }
                  }
                } catch(e) {}
              }
            }
          }

          // Strategy 3: Multi-Tier Mouse Range Selection & Keyboard Wipe & Paste
          const input = editorDom?.querySelector('textarea.inputarea') || document.querySelector('.monaco-editor textarea.inputarea') || document.querySelector('textarea.inputarea');
          if (input) {
            window.focus();
            input.focus();
            await sleep(80);

            // Click inside editor viewport to establish active focus
            if (editorDom) {
              const rect = editorDom.getBoundingClientRect();
              const clickX = rect.left + Math.min(200, rect.width / 2);
              const clickY = rect.top + Math.min(100, rect.height / 3);
              editorDom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: clickX, clientY: clickY }));
              editorDom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: clickX, clientY: clickY }));
              editorDom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: clickX, clientY: clickY }));
            }
            input.focus();
            await sleep(50);

            // Mouse Range Select: Click line 1, then Shift-click last line
            const viewLines = document.querySelector('.monaco-editor .view-lines');
            const linesList = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
            if (linesList.length > 0) {
              const firstLine = linesList[0];
              const r1 = firstLine.getBoundingClientRect();
              firstLine.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: r1.left + 5, clientY: r1.top + 5 }));
              firstLine.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: r1.left + 5, clientY: r1.top + 5 }));
              await sleep(60);

              const lastLine = linesList[linesList.length - 1];
              const r2 = lastLine.getBoundingClientRect();
              lastLine.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, shiftKey: true, clientX: r2.right - 5, clientY: r2.top + 5 }));
              lastLine.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, shiftKey: true, clientX: r2.right - 5, clientY: r2.top + 5 }));
              await sleep(60);
            }

            // Keyboard Modifier Sequence for Select All:
            const isMac = /mac/i.test(navigator.platform);

            // Control+A (for Linux/Windows container)
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', keyCode: 17, which: 17, ctrlKey: true, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', keyCode: 17, which: 17, ctrlKey: false, bubbles: true, cancelable: true }));

            // Meta+A (for Mac)
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', keyCode: 91, which: 91, metaKey: true, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, metaKey: true, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, metaKey: true, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft', keyCode: 91, which: 91, metaKey: false, bubbles: true, cancelable: true }));

            if (editorDom) {
              editorDom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true }));
            }
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true }));

            await sleep(100);

            // Delete current selection before inserting new code
            try {
              document.execCommand('delete', false, null);
            } catch(e) {}

            // Insert new code replacing the selection!
            try {
              document.execCommand('insertText', false, codeToWrite);
            } catch(e) {}

            // Also dispatch ClipboardEvent paste with DataTransfer
            const dt = new DataTransfer();
            dt.setData('text/plain', codeToWrite);
            const pasteEvt = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            });
            input.dispatchEvent(pasteEvt);
            if (editorDom) editorDom.dispatchEvent(pasteEvt);

            // Step 4: Save file
            await sleep(150);
            triggerFileSave();
            await sleep(250);

            const check = checkEditorDomVerified();
            return {
              success: true,
              verified: check.verified,
              method: 'dom.insertTextAndPaste',
              details: check
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
      return { ok: true, verified: !!successResult.result.verified, method: successResult.result.method, details: successResult.result.details };
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
        const resp = await writeEditorInTab(tabId, data.code);
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
