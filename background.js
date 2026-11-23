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
    // Send message to all frames in the tab
    const frames = await chrome.webNavigation?.getAllFrames({ tabId }).catch(() => null);
    
    // Attempt standard message send first
    const directResp = await chrome.tabs.sendMessage(tabId, { op: 'AP_GET_EDITOR_STATUS' }).catch(() => null);
    if (directResp && directResp.ok && directResp.code) {
      return directResp;
    }

    // Try executing script in MAIN world across all frames to find Monaco
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        try {
          // Check monaco in window
          const m = window.monaco || (window.require && window.require.defined && window.require.defined('vs/editor/editor.main') ? window.require('vs/editor/editor.main') : null);
          if (m && m.editor) {
            const editors = m.editor.getEditors();
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors[0];

            if (activeEd && activeEd.getModel()) {
              const model = activeEd.getModel();
              return {
                found: true,
                code: activeEd.getValue(),
                language: model.getLanguageId ? model.getLanguageId() : 'javascript',
                uri: model.uri ? model.uri.toString() : ''
              };
            }
          }

          // Fallback check: Monaco DOM view-lines
          const monacoDom = document.querySelector('.monaco-editor');
          if (monacoDom) {
            const lines = [...monacoDom.querySelectorAll('.view-lines .view-line')];
            if (lines.length > 0) {
              return {
                found: true,
                code: lines.map(l => l.textContent).join('\n'),
                language: 'javascript',
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
    // Try executing script in MAIN world across all frames
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [newCode],
      func: (codeToWrite) => {
        try {
          const m = window.monaco || (window.require && window.require.defined && window.require.defined('vs/editor/editor.main') ? window.require('vs/editor/editor.main') : null);
          if (m && m.editor) {
            const editors = m.editor.getEditors();
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode();
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors[0];

            if (activeEd && activeEd.getModel()) {
              const model = activeEd.getModel();
              activeEd.focus();
              activeEd.executeEdits('ap-solver', [{
                range: model.getFullModelRange(),
                text: codeToWrite,
                forceMoveMarkers: true
              }]);
              activeEd.pushUndoStop();

              // Verify
              if (activeEd.getValue().trim().length > 0) {
                return { success: true, method: 'monaco.executeEdits' };
              }
              model.setValue(codeToWrite);
              return { success: true, method: 'monaco.setValue' };
            }
          }

          // Fallback: Check if there is an inputarea
          const input = document.querySelector('.monaco-editor textarea.inputarea');
          if (input) {
            input.focus();
            document.execCommand('selectAll', false, null);
            const ok = document.execCommand('insertText', false, codeToWrite);
            return { success: ok, method: 'execCommand.insertText' };
          }
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const successResult = results?.find(r => r.result && r.result.success);
    if (successResult) {
      return { ok: true, method: successResult.result.method };
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
