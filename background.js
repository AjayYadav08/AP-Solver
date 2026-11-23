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
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [cleanCode, targetFilePath],
      func: async (codeToWrite, targetPath) => {
        try {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

          // Helper: Navigate explorer to target file
          async function navigateToTargetFile(target) {
            if (!target) return;
            const basename = target.split('/').pop();
            const isSrc = target.includes('src/');

            // 1. Close Welcome tab if open
            const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
            const welcomeTab = tabs.find(t => /welcome/i.test(t.textContent.trim()));
            if (welcomeTab) {
              const closeBtn = welcomeTab.querySelector('.tab-close-action, .codicon-close');
              if (closeBtn) closeBtn.click();
            }

            // 2. Click tab matching target if present
            const matchingTab = tabs.find(t => {
              const txt = (t.querySelector('.label-name') || t).textContent.trim();
              return txt === basename || txt === target;
            });
            if (matchingTab) {
              matchingTab.click();
              await sleep(100);
              return true;
            }

            // 3. Look in Explorer file tree
            const treeRows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            if (isSrc) {
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
                  await sleep(150);
                }
              }
            }

            // Find and open target file item
            const allTreeItems = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"], .monaco-icon-label')];
            const fileItem = allTreeItems.find(r => {
              const text = (r.querySelector('.label-name') || r).textContent.trim();
              return text === basename || text === target;
            });
            if (fileItem) {
              fileItem.click();
              fileItem.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
              await sleep(150);
              return true;
            }

            // 4. If file not found in tree, create it using New File button!
            const newFileBtn = document.querySelector('.codicon-new-file, [aria-label*="New File" i], [title*="New File" i]');
            if (newFileBtn) {
              if (isSrc) {
                const srcRow = treeRows.find(r => /^src$/i.test((r.querySelector('.label-name') || r).textContent.trim()));
                if (srcRow) srcRow.click();
              }
              newFileBtn.click();
              await sleep(150);
              const input = document.querySelector('.monaco-inputbox input, .inputArea input, input.monaco-inputbox');
              if (input) {
                input.value = basename;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                await sleep(250);
                return true;
              }
            }

            return false;
          }

          if (targetPath) {
            await navigateToTargetFile(targetPath);
          }
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
              let targetModel = null;

              if (targetPath) {
                const basename = targetPath.split('/').pop();
                targetModel = models.find(mod => (mod.uri?.path || '').endsWith(basename));
              }

              if (!targetModel) {
                const editors = m.editor?.getEditors ? m.editor.getEditors() : [];
                const activeEd = editors.find(e => {
                  const node = e.getContainerDomNode();
                  return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
                }) || editors[0];
                targetModel = activeEd?.getModel();
              }

              if (targetModel && typeof targetModel.setValue === 'function') {
                targetModel.setValue(codeToWrite);
                const editors = m.editor?.getEditors ? m.editor.getEditors() : [];
                const activeEd = editors[0];
                if (activeEd && activeEd.getModel() !== targetModel) {
                  activeEd.setModel(targetModel);
                }
                triggerFileSave();
                await sleep(150);
                return { success: true, verified: true, method: 'monaco.model.setValue', filePath: targetPath };
              }
            }
          }

          // Strategy 2: DOM fallback: Block Paste
          const editorDom = document.querySelector('.monaco-editor');
          const input = editorDom?.querySelector('textarea.inputarea') || document.querySelector('textarea.inputarea');
          if (input) {
            input.focus();
            const isMac = /mac/i.test(navigator.platform);

            // Move to start, then select all
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
            input.dispatchEvent(topEvt);

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

            const dt = new DataTransfer();
            dt.setData('text/plain', codeToWrite);

            try { document.execCommand('paste'); } catch(e) {}
            try {
              const pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
              input.dispatchEvent(pasteEvt);
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
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const successResult = results?.find(r => r.result && r.result.success);
    if (successResult) {
      return { ok: true, verified: !!successResult.result.verified, method: successResult.result.method, filePath: successResult.result.filePath };
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
