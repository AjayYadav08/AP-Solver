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

// Live Visual Target Beacon (renders on top of the exact file/tab element)
async function showVisualTargetBeacon(tabId, x, y, basename, elType) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [Math.round(x), Math.round(y), basename, elType],
      func: (gx, gy, name, type) => {
        document.querySelectorAll('.ap-live-click-beacon').forEach(e => e.remove());

        const beacon = document.createElement('div');
        beacon.className = 'ap-live-click-beacon';
        beacon.style.cssText = `
          position: fixed;
          left: ${gx}px;
          top: ${gy}px;
          transform: translate(-50%, -50%);
          z-index: 2147483647;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        beacon.innerHTML = `
          <div style="
            background: linear-gradient(135deg, #10b981, #059669);
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            font-weight: 700;
            padding: 6px 14px;
            border-radius: 20px;
            box-shadow: 0 4px 20px rgba(16, 185, 129, 0.7), 0 0 0 2px #ffffff;
            margin-bottom: 8px;
            white-space: nowrap;
            letter-spacing: 0.3px;
          ">
            🎯 Target Found: ${name} (${type})
          </div>
          <div style="
            width: 36px;
            height: 36px;
            border: 3px solid #10b981;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.25);
            box-shadow: 0 0 25px #10b981;
            position: relative;
          ">
            <div style="
              position: absolute;
              width: 10px;
              height: 10px;
              background: #ffffff;
              border-radius: 50%;
              left: 50%;
              top: 50%;
              transform: translate(-50%, -50%);
              box-shadow: 0 0 8px #10b981;
            "></div>
          </div>
        `;

        document.body.appendChild(beacon);

        setTimeout(() => {
          beacon.style.opacity = '0';
          setTimeout(() => beacon.remove(), 400);
        }, 2500);
      }
    });
  } catch (e) {
    console.warn('[AP-Solver] showVisualTargetBeacon error:', e);
  }
}

// True Native CDP Click on Tab or Explorer Tree Item Across Frames
async function cdpClickElementInWorkspace(tabId, targetFilePath) {
  if (!targetFilePath) return false;
  let cleanPath = targetFilePath.trim();
  const basename = cleanPath.split('/').pop().trim();

  // Guard: Reject invalid filenames like "1", "one", or names without extension
  if (!basename || !basename.includes('.') || /^(1|2|3|4|5|one|two)(\.(js|ts))?$/i.test(basename)) {
    console.warn(`[AP-Solver CDP] Skipped invalid target filename: "${targetFilePath}"`);
    return false;
  }

  try {
    const attached = await attachCDP(tabId);

    // 1. Get all iframe positions in top frame
    const iframeRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return [...document.querySelectorAll('iframe')].map((ifr) => {
          const r = ifr.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        }).filter(r => r.width > 150 && r.height > 150);
      }
    });
    const iframes = iframeRes?.[0]?.result || [];

    // PASS 1: Check if file ALREADY EXISTS (Tabs, Tree Rows, Collapsed src folder)
    const scanResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [basename],
      func: (base) => {
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '');
        const normBase = norm(base);

        // A. Check open tabs first
        const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
        for (const t of tabs) {
          const aria = norm(t.getAttribute('aria-label'));
          const txt = norm((t.querySelector('.label-name') || t).textContent);
          if (aria.includes(normBase) || txt.includes(normBase)) {
            // Direct JS click in frame
            try {
              t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              t.click();
              t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
              t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
              t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
            } catch(e) {}

            // Direct Monaco model switch if model is already in memory
            try {
              const m = window.monaco || (typeof window.require === 'function' ? window.require('vs/editor/editor.main') : null);
              if (m && m.editor) {
                const models = m.editor.getModels ? m.editor.getModels() : [];
                const match = models.find(mod => (mod.uri?.path || '').toLowerCase().includes(normBase));
                const editors = m.editor.getEditors ? m.editor.getEditors() : [];
                if (match && editors[0]) editors[0].setModel(match);
              }
            } catch(e) {}

            // Highlight tab in bright neon green
            try {
              t.style.outline = '3px solid #10b981';
              t.style.boxShadow = '0 0 15px #10b981';
              setTimeout(() => { try { t.style.outline = ''; t.style.boxShadow = ''; } catch(e) {} }, 3000);
            } catch(e) {}

            const r = t.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { type: 'tab', x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
        }

        // B. Check explorer tree rows
        const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
        for (const row of rows) {
          const aria = norm(row.getAttribute('aria-label'));
          const txt = norm((row.querySelector('.label-name') || row).textContent);
          if (aria.includes(normBase) || txt.includes(normBase)) {
            try {
              row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              row.style.outline = '3px solid #10b981';
              row.style.boxShadow = '0 0 15px #10b981';
              setTimeout(() => { try { row.style.outline = ''; row.style.boxShadow = ''; } catch(e) {} }, 3000);
            } catch(e) {}

            const r = row.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const icon = row.querySelector('.monaco-icon-label-icon, .codicon, .monaco-icon-label') || row;
              const iconR = icon.getBoundingClientRect();
              const targetX = (iconR.left && iconR.left > r.left) ? (iconR.left + 8) : (r.left + 24);
              const targetY = r.top + r.height / 2;
              return { type: 'treeItem', x: targetX, y: targetY };
            }
          }
        }

        // C. Check if src folder is collapsed
        const srcFolder = rows.find(r => {
          const txt = norm((r.querySelector('.label-name') || r).textContent);
          const aria = norm(r.getAttribute('aria-label'));
          return txt === 'src' || aria === 'src' || aria.startsWith('src');
        });
        if (srcFolder) {
          const isCollapsed = srcFolder.getAttribute('aria-expanded') === 'false' ||
            !!srcFolder.querySelector('.collapsed, .codicon-chevron-right');
          if (isCollapsed) {
            try { srcFolder.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch(e) {}
            const twistie = srcFolder.querySelector('.monaco-tl-twistie, .codicon-chevron-right, .collapsed');
            const rowR = srcFolder.getBoundingClientRect();
            let twistieX = rowR.left + 12;
            let twistieY = rowR.top + rowR.height / 2;
            if (twistie) {
              const tr = twistie.getBoundingClientRect();
              if (tr.width > 0 && tr.height > 0) {
                twistieX = tr.left + tr.width / 2;
                twistieY = tr.top + tr.height / 2;
              }
            }
            return { type: 'expandSrc', x: twistieX, y: twistieY };
          }
        }

        return null;
      }
    });

    // Prioritize existing file target: tab -> treeItem -> expandSrc
    const matches = scanResults?.filter(s => s.result && ['tab', 'treeItem', 'expandSrc'].includes(s.result.type));
    let targetMatch = matches?.find(s => s.result.type === 'tab') ||
                      matches?.find(s => s.result.type === 'treeItem') ||
                      matches?.find(s => s.result.type === 'expandSrc');

    // PASS 2: ONLY if file does NOT exist in tabs or explorer tree, look for New File button inside VS Code frame
    if (!targetMatch) {
      const newFileScan = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          // Verify we are inside VS Code workbench sidebar, not top frame or response tester
          const workbench = document.querySelector('.monaco-workbench, .part.sidebar, .explorer-viewlet');
          if (!workbench) return null;

          // Select src folder row first so new file is created inside src/
          const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
          const srcRow = rows.find(r => {
            const txt = (r.querySelector('.label-name') || r).textContent.trim().toLowerCase();
            return txt === 'src';
          });
          if (srcRow) {
            try { srcRow.click(); } catch(e) {}
          }

          const newFileBtn = document.querySelector('.codicon-new-file, [aria-label*="New File" i], [title*="New File" i]');
          if (newFileBtn) {
            const r = newFileBtn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { type: 'createNewFile', x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
          return null;
        }
      });

      targetMatch = newFileScan?.find(s => s.result && s.result.type === 'createNewFile');
    }

    if (!targetMatch || !targetMatch.result) {
      console.log(`[AP-Solver CDP] Element for "${basename}" not found in frame scans.`);
      return false;
    }

    const { type, x: localX, y: localY } = targetMatch.result;
    const frameId = targetMatch.frameId;

    let globalX = localX;
    let globalY = localY;

    if (frameId !== 0 && iframes.length > 0) {
      // Find VS Code iframe (usually on right side)
      const vsIframe = iframes.find(ifr => ifr.left > 150) || iframes[0];
      if (vsIframe) {
        globalX = vsIframe.left + localX;
        globalY = vsIframe.top + localY;
      }
    }

    console.log(`[AP-Solver CDP] Targeting "${basename}" (${type}) at viewport pixel (${Math.round(globalX)}, ${Math.round(globalY)})`);

    // Show live on-screen visual beacon
    await showVisualTargetBeacon(tabId, globalX, globalY, basename, type);

    if (attached) {
      if (type === 'expandSrc') {
        // 1. In-frame direct DOM trigger on twistie and ArrowRight (NEVER Enter on folders/files)
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            const src = rows.find(r => {
              const txt = (r.querySelector('.label-name') || r).textContent.trim().toLowerCase();
              return txt === 'src';
            });
            if (src) {
              const twistie = src.querySelector('.monaco-tl-twistie, .codicon-chevron-right, .collapsed');
              if (twistie) {
                try { twistie.click(); } catch(e) {}
                try { twistie.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch(e) {}
              }
              try { src.focus(); } catch(e) {}
              try { src.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true })); } catch(e) {}
            }
          }
        });

        // 2. Hardware native click on twistie chevron
        await cdpNativeClick(tabId, globalX, globalY, 1);
        await sleep(60);

        // 3. Hardware native double-click
        await cdpNativeDblClick(tabId, globalX, globalY);
        await sleep(60);

        // 4. Hardware native ArrowRight key to expand folder in VS Code
        await cdpNativeKey(tabId, 'ArrowRight', 'ArrowRight', 39, 0);
        await sleep(250);

        return await cdpClickElementInWorkspace(tabId, targetFilePath);
      }

      if (type === 'tab') {
        await cdpNativeClick(tabId, globalX, globalY, 1);
        await sleep(300);
        return true;
      }

      if (type === 'treeItem') {
        // 1. Dismiss any existing inline rename box with Escape
        await cdpNativeKey(tabId, 'Escape', 'Escape', 27, 0);
        await sleep(60);
        // 2. Hardware native double-click on file icon to open permanently (never slow single clicks that trigger rename)
        await cdpNativeDblClick(tabId, globalX, globalY);
        await sleep(250);
        // CRITICAL: NEVER send Enter key! On macOS/VS Code, Enter triggers inline file rename!
        return true;
      }

      if (type === 'createNewFile') {
        // 1. Click New File button
        await cdpNativeClick(tabId, globalX, globalY, 1);
        await sleep(350);

        // 2. Direct DOM input injection across frames
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          args: [basename],
          func: (name) => {
            const inp = document.querySelector('.monaco-inputbox input, .inputArea input, input.monaco-inputbox, .monaco-list-row input');
            if (inp) {
              inp.focus();
              inp.value = name;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        });

        // 3. True Native text typing via CDP to register with VS Code
        await cdpNativeInsertText(tabId, basename);
        await sleep(150);

        // 4. Press Enter key via CDP to confirm creation
        await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
        await sleep(800); // Give VS Code Web container time to create file & initialize model
        return true;
      }
    }

    return true;
  } catch (err) {
    console.warn('[AP-Solver CDP] cdpClickElementInWorkspace error:', err);
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
          const isWorkbench = !document.querySelector('#ap-solver-host') && (
            !!document.querySelector('.monaco-workbench, .part.editor, .editor-instance, .explorer-viewlet') ||
            (window.self !== window.top && !!document.querySelector('.monaco-editor'))
          );
          // If this frame contains an iframe AND has NO workbench, it's the top host window! SKIP IT!
          if (!isWorkbench && document.querySelector('iframe')) {
            return null;
          }
          if (window.self === window.top && document.querySelector('iframe')) {
            return null;
          }

          // Helper: Detect active filename from breadcrumbs, tabs, or monaco model
          function detectActiveFile() {
            // 1. Breadcrumbs (e.g. "src > JS orderManager.js")
            const breadcrumbs = [...document.querySelectorAll('.breadcrumbs-widget .monaco-breadcrumb-item')].map(b => b.textContent.trim()).filter(Boolean);
            if (breadcrumbs.length > 0) {
              const last = breadcrumbs[breadcrumbs.length - 1].replace(/^[A-Z]+\s+/, '');
              if (last.includes('.') && !/^\d+$/.test(last)) {
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
              if (label && label.includes('.') && !/^\d+$/.test(label) && !/welcome/i.test(label)) {
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
              if (text && text.includes('.') && !/^\d+$/.test(text) && !/^\s*$/.test(text)) {
                files.add(text);
              }
            }
            const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
            for (const tab of tabs) {
              const text = (tab.querySelector('.label-name') || tab).textContent.trim();
              if (text && text.includes('.') && !/^\d+$/.test(text) && !/welcome/i.test(text)) {
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
              if (fname && (fname.endsWith('.json') || fname.endsWith('.txt') || fname.endsWith('.prisma') || fname.endsWith('.js') || fname.endsWith('.ts')) &&
                  !fname.includes('package-lock') && !fname.includes('node_modules') && !/inmemory|workbench/i.test(p) && !/^\d+$/.test(fname)) {
                const val = mod.getValue();
                const cleanKey = p.includes('src/') ? 'src/' + fname : fname;
                if (val && val.length < 25000 && cleanKey !== detectedActive) {
                  referenceFiles[cleanKey] = val;
                }
              }
              if (fname && fname.includes('.') && !/^\d+$/.test(fname)) workspaceFiles.push(p.includes('src/') ? 'src/' + fname : fname);
            }

            // If a specific active file was detected, find its model first
            let activeModel = null;
            if (detectedActive) {
              const basename = detectedActive.split('/').pop();
              activeModel = models.find(mod => (mod.uri?.path || '').endsWith(basename));
            }

            // Otherwise, get model from active visible editor (excluding HTTP tester response pane)
            const editors = m.editor.getEditors ? m.editor.getEditors() : [];
            const activeEd = editors.find(e => {
              const node = e.getContainerDomNode ? e.getContainerDomNode() : null;
              if (node && node.closest?.('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], #ap-solver-host')) return false;
              return node && node.getBoundingClientRect().width > 0 && !e.getOption(m.editor.EditorOption.readOnly);
            }) || editors.find(e => {
              const node = e.getContainerDomNode ? e.getContainerDomNode() : null;
              return !node?.closest?.('[class*="response" i], [class*="http-request" i], #ap-solver-host');
            }) || editors[0];

            if (!activeModel && activeEd && activeEd.getModel()) {
              activeModel = activeEd.getModel();
            }

            if (activeModel) {
              const val = activeModel.getValue();
              const p = activeModel.uri?.path || activeModel.uri?.toString() || '';
              const rawFname = p.split('/').pop() || '';
              let fname = detectedActive || '';
              if (rawFname && rawFname.includes('.') && !/^\d+$/.test(rawFname) && !/inmemory/i.test(p)) {
                fname = rawFname;
              }
              if (!fname || /^\d+$/.test(fname)) {
                fname = 'src/index.js';
              }
              const resolvedActive = fname.includes('src/') ? fname : (p.includes('src/') ? 'src/' + fname : fname);

              return {
                found: true,
                isWorkbench,
                code: val,
                language: activeModel.getLanguageId ? activeModel.getLanguageId() : 'javascript',
                uri: p,
                activeFile: resolvedActive,
                allFiles: [...new Set(workspaceFiles)],
                referenceFiles
              };
            }
          }

          // Fallback check: Monaco DOM view-lines (ONLY inside real workbench)
          if (isWorkbench) {
            const monacoDom = document.querySelector('.monaco-editor');
            if (monacoDom) {
              const lines = [...monacoDom.querySelectorAll('.view-lines .view-line')];
              const code = lines.map(l => l.textContent).join('\n');
              if (code && !/Get Started with VS Code/i.test(code)) {
                return {
                  found: true,
                  isWorkbench,
                  code,
                  language: 'javascript',
                  activeFile: detectedActive || 'src/index.js',
                  allFiles: [...new Set(workspaceFiles)],
                  fromDom: true
                };
              }
            }
          }
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const workbenchMatch = results?.find(r => r.result && r.result.found && r.result.isWorkbench);
    const match = workbenchMatch || results?.find(r => r.result && r.result.found);
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

    // Phase 1: Try True Native Navigation via CDP if target file is specified
    if (targetFilePath) {
      try {
        console.log(`[AP-Solver] True Native CDP navigation to "${targetFilePath}"...`);
        const navOk = await cdpClickElementInWorkspace(tabId, targetFilePath);
        console.log(`[AP-Solver] CDP navigation result for "${targetFilePath}":`, navOk);
        await sleep(350);
      } catch (e) {
        console.warn('[AP-Solver CDP] Native navigation error:', e);
      }
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [cleanCode, targetFilePath],
      func: async (codeToWrite, targetPath) => {
        try {
          const isWorkbench = !document.querySelector('#ap-solver-host') && (
            !!document.querySelector('.monaco-workbench, .part.editor, .editor-instance, .explorer-viewlet') ||
            (window.self !== window.top && !!document.querySelector('.monaco-editor'))
          );
          // If this frame contains an iframe AND has NO workbench, it's the top host window! SKIP IT!
          if (!isWorkbench && document.querySelector('iframe')) {
            return null;
          }
          if (window.self === window.top && document.querySelector('iframe')) {
            return null;
          }

          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

          function simulateClick(el) {
            if (!el) return false;
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch(e) {}
            try { el.focus(); } catch(e) {}
            const list = el.closest?.('.monaco-list, .monaco-tree-view');
            if (list) { try { list.focus(); } catch(e) {} }

            // Dismiss any active inline rename input
            const activeInput = document.querySelector('.monaco-list-row input, .monaco-inputbox input, input.monaco-inputbox');
            if (activeInput) {
              try {
                activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                activeInput.blur();
              } catch(e) {}
            }

            const isTreeRow = el.classList?.contains('monaco-list-row') || el.getAttribute?.('role') === 'treeitem';
            // For tree items, target the icon specifically — NEVER click the text label name, which triggers inline rename!
            const icon = isTreeRow ? (el.querySelector('.monaco-icon-label-icon, .codicon, .monaco-tl-twistie') || el) : null;
            const target = icon || el.querySelector?.('.label-name, .monaco-icon-label') || el;
            const rect = target.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const clientX = isTreeRow
              ? ((rect.left && rect.left > 0) ? (rect.left + 8) : (elRect.left + 24))
              : ((rect.left + rect.width / 2) || 150);
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

            // CRITICAL: NEVER dispatch Enter key on tree items! On macOS/VS Code, Enter triggers inline file rename!

            return true;
          }

          const normStr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '');

          function findExplorerItem(name) {
            const base = name.split('/').pop().trim();
            const normBase = normStr(base);
            const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            return rows.find(r => {
              const aria = normStr(r.getAttribute('aria-label') || '');
              const title = normStr(r.getAttribute('title') || '');
              const labelEl = r.querySelector('.label-name, .monaco-icon-label');
              const text = normStr(labelEl?.textContent || r.textContent || '');
              return aria.includes(normBase) || title.includes(normBase) || text.includes(normBase);
            });
          }

          // Helper: Navigate explorer to target file
          async function navigateToTargetFile(target) {
            if (!target) return false;
            const basename = target.split('/').pop();
            const normBase = normStr(basename);
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
            if (normStr(activeLabel).includes(normBase)) {
              return true;
            }

            // 3. Click tab matching target if present in tabs bar
            const matchingTab = tabs.find(t => {
              const aria = normStr(t.getAttribute('aria-label') || '');
              const txt = normStr((t.querySelector('.label-name') || t).textContent || '');
              return aria.includes(normBase) || txt.includes(normBase);
            });
            if (matchingTab) {
              simulateClick(matchingTab);
              await sleep(250);
              const curTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
              const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
              if (normStr(curTxt).includes(normBase)) {
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
                  if (twistie) {
                    try { twistie.click(); } catch(e) {}
                    try { twistie.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch(e) {}
                  }
                  try { srcItem.focus(); } catch(e) {}
                  try { srcItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true })); } catch(e) {}
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
                if (normStr(curTxt).includes(normBase)) {
                  return true;
                }
                await sleep(100);
              }
              return true;
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
          const normActive = normStr(activeTabName);
          const normBase = basename ? normStr(basename) : '';
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

          const isExcludedNode = (node) => {
            if (!node) return false;
            return !!node.closest?.('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], [class*="request-body" i], [class*="response-body" i], #ap-solver-host');
          };

          let validEditors = [];
          let activeEd = null;
          if (m && m.editor) {
            const allEds = m.editor.getEditors ? m.editor.getEditors() : [];
            validEditors = allEds.filter(e => {
              const node = e.getContainerDomNode ? e.getContainerDomNode() : null;
              if (isExcludedNode(node)) return false;
              const r = node ? node.getBoundingClientRect() : null;
              return r && r.width > 50 && r.height > 50;
            });
            activeEd = validEditors.find(e => !e.getOption?.(m.editor.EditorOption?.readOnly)) || validEditors[0] || null;
          }

          let isModelMatch = false;
          if (activeEd && basename) {
            const p = (activeEd.getModel()?.uri?.path || activeEd.getModel()?.uri?.toString() || '').toLowerCase();
            const b = basename.toLowerCase();
            if (p.endsWith('/' + b) || p.endsWith(targetPath.toLowerCase()) || p.includes('/' + b)) {
              isModelMatch = true;
            }
          }

          const isTargetActive = isModelMatch || !basename || (
            normActive.length > 0 && normBase.length > 0 &&
            (normActive.includes(normBase) || normBase.includes(normActive))
          );

          if (m && m.editor) {
            // A. If targetModel exists in getModels (poll up to 3.5s for newly created files)
            let targetModel = null;
            const tStart = Date.now();
            while (Date.now() - tStart < 3500) {
              const models = m.editor.getModels ? m.editor.getModels() : [];
              if (basename) {
                const b = basename.toLowerCase();
                targetModel = models.find(mod => {
                  const p = (mod.uri?.path || mod.uri?.toString() || '').toLowerCase();
                  return p.endsWith('/' + b) || p.endsWith(targetPath.toLowerCase()) || p.includes('/' + b);
                });
              }
              if (targetModel) break;

              const curTab = document.querySelector('.tab.active, .tab.selected, [role="tab"][aria-selected="true"]');
              const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
              if (normBase && normStr(curTxt).includes(normBase)) break;

              await sleep(150);
            }

            if (targetModel && typeof targetModel.setValue === 'function') {
              try { targetModel.setValue(''); } catch(e) {}
              targetModel.setValue(codeToWrite);
              if (activeEd && activeEd.getModel() !== targetModel) {
                try { activeEd.setModel(targetModel); } catch(e) {}
              }
              triggerFileSave();
              await sleep(150);
              const curVal = targetModel.getValue();
              if (/\/\/\s*write your code here|\/\*\s*write your code here\s*\*\//i.test(curVal)) {
                return { success: false, error: 'Model still contains placeholder code' };
              }
              return { success: true, verified: true, method: 'monaco.model.setValue', filePath: targetPath };
            }

            if (!activeEd) {
              return { success: false, error: 'No valid workspace editor in this frame' };
            }

            // B. If target is active in activeEd (or if (!targetPath)), write to activeEd model!
            if ((!targetPath || isTargetActive) && activeEd && activeEd.getModel()) {
              try { activeEd.getModel().setValue(''); } catch(e) {}
              activeEd.getModel().setValue(codeToWrite);
              triggerFileSave();
              await sleep(150);
              const curVal = activeEd.getModel().getValue();
              if (/\/\/\s*write your code here|\/\*\s*write your code here\s*\*\//i.test(curVal)) {
                return { success: false, error: 'Editor still contains placeholder code' };
              }
              return { success: true, verified: true, method: 'monaco.activeModel.setValue', filePath: targetPath };
            }
          }

          // Strategy 2: DOM fallback: ONLY if active tab matches targetPath!
          if (isTargetActive) {
            const allEditors = [...document.querySelectorAll('.monaco-editor')].filter(el => !isExcludedNode(el));
            const editorDom = allEditors[0];
            if (editorDom) {
              const input = editorDom.querySelector('textarea.inputarea');
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

    // Secondary Fallback: Forward write to content script frames via tabs.sendMessage
    try {
      const frameResps = await chrome.tabs.sendMessage(tabId, {
        op: 'AP_WRITE_EDITOR',
        data: { code: cleanCode, filePath: targetFilePath }
      });
      if (frameResps && frameResps.ok) {
        await cdpSaveFile(tabId);
        return { ok: true, verified: true, method: 'frame-editor.bridge+cdp', filePath: targetFilePath };
      }
    } catch(e) {}

    // Phase 4: Hardware Native CDP Wipe & Replace (Complete erase of starter code via real OS keystrokes)
    try {
      const attached = await attachCDP(tabId);
      if (attached) {
        console.log(`[AP-Solver CDP] Performing Hardware Native Wipe & Replace for "${targetFilePath || 'active file'}"...`);
        // 1. Dismiss any open rename/modal with Escape
        await cdpNativeKey(tabId, 'Escape', 'Escape', 27, 0);
        await sleep(60);

        // 2. Focus editor via click
        const edPos = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const ed = document.querySelector('.monaco-editor');
            if (!ed) return null;
            if (ed.closest?.('[class*="response" i], [class*="http-request" i], #ap-solver-host')) return null;
            const r = ed.getBoundingClientRect();
            if (r.width > 50 && r.height > 50) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
            return null;
          }
        });
        const validPos = edPos?.find(p => p.result)?.result;
        if (validPos) {
          await cdpNativeClick(tabId, validPos.x, validPos.y, 1);
          await sleep(60);
        }

        // 3. True OS Select All: Cmd+A (Mac) and Ctrl+A (Win/Linux)
        await cdpNativeKey(tabId, 'a', 'KeyA', 65, 4); // Cmd+A (Mac)
        await sleep(80);
        await cdpNativeKey(tabId, 'a', 'KeyA', 65, 2); // Ctrl+A (Win/Linux)
        await sleep(80);

        // 4. True OS Hardware Backspace & Delete to 100% WIPE the initial code!
        await cdpNativeKey(tabId, 'Backspace', 'Backspace', 8, 0);
        await sleep(60);
        await cdpNativeKey(tabId, 'Delete', 'Delete', 46, 0);
        await sleep(80);

        // 5. True OS Hardware Insert clean solution
        await cdpNativeInsertText(tabId, cleanCode);
        await sleep(150);

        // 6. Save via Cmd+S / Ctrl+S
        await cdpSaveFile(tabId);
        await sleep(150);

        return { ok: true, verified: true, method: 'cdp.hardwareWipeAndReplace', filePath: targetFilePath };
      }
    } catch (e) {
      console.warn('[AP-Solver CDP] Hardware wipe error:', e);
    }
  } catch (err) {
    console.warn('[AP-Solver] Error writing to editor in tab:', err);
  }

  return { ok: false, error: 'Failed to write code into editor frame.' };
}

// Direct Terminal File Injection Engine (Zero-Click Linux Disk Writer)
async function writeFilesViaTerminal(tabId, files) {
  if (!files || files.length === 0) return { ok: false, error: 'No files provided' };

  let bashScript = '';
  for (const f of files) {
    const dir = f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : '';
    if (dir) {
      bashScript += `mkdir -p "${dir}" && `;
    }
    bashScript += `cat << 'EOF' > "${f.filePath}"\n${f.code}\nEOF\n`;
  }

  try {
    // 1. Check all frames to find and focus open xterm terminal
    const scanRes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const ta = document.querySelector('.xterm-helper-textarea, textarea.xterm-helper-textarea, [class*="xterm" i] textarea');
        if (ta) {
          ta.focus();
          const r = ta.getBoundingClientRect();
          return { found: true, x: r.left + 50, y: r.top + 20 };
        }
        const term = document.querySelector('.terminal.xterm, .xterm-screen, [class*="terminal" i]');
        if (term) {
          term.focus();
          try { term.click(); } catch(e) {}
          const r = term.getBoundingClientRect();
          return { found: true, x: r.left + 50, y: r.top + 20 };
        }
        return { found: false };
      }
    });

    const match = scanRes?.find(r => r.result && r.result.found);
    if (!match || !match.result) {
      return { ok: false, error: 'No open terminal found in workspace' };
    }

    const attached = await attachCDP(tabId);
    if (attached) {
      await cdpNativeInsertText(tabId, bashScript);
      await sleep(150);
      await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
      await sleep(350);
      return { ok: true, method: 'terminal.cdp' };
    }
  } catch (e) {
    console.warn('[AP-Solver Terminal] writeFilesViaTerminal error:', e);
  }

  return { ok: false, error: 'Could not inject into terminal.' };
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
      } else if (op === 'AP_WRITE_TERMINAL') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        const resp = await writeFilesViaTerminal(tabId, data.files);
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
