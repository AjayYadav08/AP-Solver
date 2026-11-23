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
          const m = window.monaco || (window.require && typeof window.require === 'function' ? (window.require.defined && window.require.defined('vs/editor/editor.main') ? window.require('vs/editor/editor.main') : null) : null);
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
      func: (codeToWrite) => {
        try {
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
            const hasNewCode = lines.length > 50 && !hasOld501;
            return { verified: hasNewCode, linesLength: lines.length, hasOld501 };
          }

          // Strategy 1: Monaco instance or AMD loader
          const m = window.monaco || (window.require && typeof window.require === 'function' ? (window.require.defined && window.require.defined('vs/editor/editor.main') ? window.require('vs/editor/editor.main') : null) : null);
          if (m && m.editor) {
            // Check all models
            const models = m.editor.getModels ? m.editor.getModels() : [];
            const indexModel = models.find(mod => /index\.(js|ts)/i.test(mod.uri?.path || mod.uri?.toString() || ''));
            if (indexModel) {
              indexModel.setValue(codeToWrite);
              triggerFileSave();
              return { success: true, verified: true, method: 'monaco.indexModel.setValue' };
            }

            // Check active editor
            const editors = m.editor.getEditors ? m.editor.getEditors() : [];
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors[0];

            if (activeEd && activeEd.getModel()) {
              const model = activeEd.getModel();
              activeEd.focus();
              model.setValue(codeToWrite);
              triggerFileSave();
              return { success: true, verified: true, method: 'monaco.activeEd.setValue' };
            }
          }

          // Strategy 2: DOM event dispatching onto textarea.inputarea
          const editorDom = document.querySelector('.monaco-editor');
          const input = editorDom?.querySelector('textarea.inputarea') || document.querySelector('.monaco-editor textarea.inputarea');
          if (input) {
            input.focus();

            // Select all via Cmd+A
            const isMac = /mac/i.test(navigator.platform);
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

            // Dispatch paste event with DataTransfer
            const dt = new DataTransfer();
            dt.setData('text/plain', codeToWrite);
            const pasteEvt = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            });
            input.dispatchEvent(pasteEvt);
            if (editorDom) editorDom.dispatchEvent(pasteEvt);

            // Dispatch beforeinput
            try {
              const inputEvt = new InputEvent('beforeinput', {
                inputType: 'insertFromPaste',
                data: codeToWrite,
                dataTransfer: dt,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(inputEvt);
            } catch(e) {}

            // Try execCommand insertText as well
            try {
              document.execCommand('insertText', false, codeToWrite);
            } catch(e) {}

            triggerFileSave();

            const check = checkEditorDomVerified();
            if (check.verified) {
              return { success: true, verified: true, method: 'dom.pasteEvent' };
            }

            return { success: true, verified: false, method: 'dom.dispatched' };
          }
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const successResult = results?.find(r => r.result && r.result.success);
    if (successResult) {
      return { ok: true, verified: !!successResult.result.verified, method: successResult.result.method };
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
