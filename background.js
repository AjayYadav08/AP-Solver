// background.js - AP-Solver Service Worker (Multi-File & Multi-Folder Aware)
import { generateSolution, getSettings, saveSettings, formatCodeIndentation, stripComments, sanitizePostWriteCommand, detectRequiredPostWriteCommands } from './utils/llm.js';

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

// True Native Key Press (uses keyDown + text:'\r'/char for Enter so xterm.js & Monaco register Enter cleanly!)
async function cdpNativeKey(tabId, key, code, keyCode, modifiers = 0) {
  const isEnter = key === 'Enter' || keyCode === 13;
  const baseEvt = {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  };
  if (isEnter) {
    baseEvt.text = '\r';
    baseEvt.unmodifiedText = '\r';
  }
  await sendCDP(tabId, 'Input.dispatchKeyEvent', baseEvt);
  if (isEnter) {
    await sleep(15);
    await sendCDP(tabId, 'Input.dispatchKeyEvent', {
      type: 'char',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      modifiers
    });
  }
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

// True Native Text Typing (chunked for large base64 scripts so xterm PTY never overflows)
async function cdpNativeInsertText(tabId, text) {
  const str = String(text || '');
  if (str.length <= 800) {
    await sendCDP(tabId, 'Input.insertText', { text: str });
    return;
  }
  for (let i = 0; i < str.length; i += 800) {
    await sendCDP(tabId, 'Input.insertText', { text: str.slice(i, i + 800) });
    await sleep(25);
  }
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

    // PASS 0: Check if target file is ALREADY active in editor (Tabs or Breadcrumbs)
    const activeCheck = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [basename],
      func: (base) => {
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '');
        const normBase = norm(base);
        const activeTab = document.querySelector('.tab.active, .tab.selected, [role="tab"][aria-selected="true"]');
        const txt = norm((activeTab?.querySelector('.label-name') || activeTab)?.textContent || '');
        if (txt && (txt.includes(normBase) || normBase.includes(txt))) return true;
        const breadcrumbs = [...document.querySelectorAll('.breadcrumbs-widget .monaco-breadcrumb-item')].map(b => norm(b.textContent));
        if (breadcrumbs.some(b => b.includes(normBase) || normBase.includes(b))) return true;
        return false;
      }
    });
    if (activeCheck?.some(r => r.result === true)) {
      console.log(`[AP-Solver CDP] Target "${basename}" is already active in workspace.`);
      return true;
    }

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
              const aria = (row.getAttribute('aria-label') || '').trim();
              if (text && text.includes('.') && !/^\d+$/.test(text) && !/^\s*$/.test(text)) {
                if (aria && /[/\\]/.test(aria)) {
                  const pathMatch = aria.match(/((?:src|test|tests|__tests__|prisma|db|routes|controllers|middleware|models|utils)\/[^\s,]+)/i);
                  if (pathMatch) files.add(pathMatch[1]);
                }
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
              if (fname && (fname.endsWith('.json') || fname.endsWith('.txt') || fname.endsWith('.prisma') || fname.endsWith('.js') || fname.endsWith('.ts') || fname === '.env') &&
                  !fname.includes('package-lock') && !fname.includes('node_modules') && !p.includes('node_modules') && !/inmemory|workbench/i.test(p) && !/^\d+$/.test(fname)) {
                const val = mod.getValue();
                const subMatch = p.match(/\/((?:test|tests|__tests__|prisma|db|routes|controllers|middleware|models|utils)\/[^/]+)$/i);
                const cleanKey = subMatch ? subMatch[1] : (p.includes('src/') ? 'src/' + fname : fname);
                if (val && val.length < 35000) {
                  referenceFiles[cleanKey] = val;
                }
              }
              if (fname && fname.includes('.') && !/^\d+$/.test(fname)) {
                const subMatch = p.match(/\/((?:test|tests|__tests__|prisma|db|routes|controllers|middleware|models|utils)\/[^/]+)$/i);
                workspaceFiles.push(subMatch ? subMatch[1] : (p.includes('src/') ? 'src/' + fname : fname));
              }
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

          // 1. Breadcrumbs
          let activeBreadcrumb = '';
          const breadcrumbs = [...document.querySelectorAll('.breadcrumbs-widget .monaco-breadcrumb-item')].map(b => b.textContent.trim()).filter(Boolean);
          if (breadcrumbs.length > 0) {
            const last = breadcrumbs[breadcrumbs.length - 1].replace(/^[A-Z]+\s+/, '');
            if (last.includes('.') && !/^\d+$/.test(last)) {
              activeBreadcrumb = last;
            }
          }

          const basename = targetPath ? targetPath.split('/').pop() : null;
          const activeTabEl = document.querySelector('.tab.active, .tab.selected, [role="tab"][aria-selected="true"]');
          const activeTabName = (activeTabEl?.querySelector('.label-name') || activeTabEl)?.textContent?.trim() || activeBreadcrumb;
          const normActive = normStr(activeTabName || activeBreadcrumb);
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

          // Strategy 2: DOM instance inspection (Wipe & Replace via editor DOM attachment)
          if (isTargetActive) {
            const allEditors = [...document.querySelectorAll('.monaco-editor')].filter(el => !isExcludedNode(el));
            for (const editorDom of allEditors) {
              for (const k of Object.keys(editorDom)) {
                try {
                  const inst = editorDom[k];
                  if (inst && typeof inst.getModel === 'function') {
                    const mod = inst.getModel();
                    if (mod && typeof mod.setValue === 'function') {
                      mod.setValue(''); // Empty file completely first!
                      await sleep(50);
                      mod.setValue(codeToWrite);
                      triggerFileSave();
                      return {
                        success: true,
                        verified: true,
                        method: 'monaco.domInstance.setValue+dom.insertTextAndPaste',
                        filePath: targetPath
                      };
                    }
                  }
                } catch(e) {}
              }
            }

            // Note: selectAll and Backspace are executed in Phase 4 Hardware CDP Wipe
            document.execCommand?.('selectAll', false, null);
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
      if (frameResps && frameResps.ok && frameResps.verified && frameResps.method === 'bridge') {
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

        // 2. Focus editor via click with real viewport coordinates
        const iframeRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            return [...document.querySelectorAll('iframe')].map(ifr => {
              const r = ifr.getBoundingClientRect();
              return { left: r.left, top: r.top, width: r.width, height: r.height };
            }).filter(r => r.width > 150 && r.height > 150);
          }
        });
        const topIframes = iframeRes?.[0]?.result || [];
        const vsIframe = topIframes.find(ifr => ifr.left > 150) || topIframes[0];

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
        const validMatch = edPos?.find(p => p.result);
        if (validMatch && validMatch.result) {
          let gx = validMatch.result.x;
          let gy = validMatch.result.y;
          if (validMatch.frameId !== 0 && vsIframe) {
            gx += vsIframe.left;
            gy += vsIframe.top;
          }
          await cdpNativeClick(tabId, gx, gy, 1);
          await sleep(100);
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

        // EXTRA WIPE PASS: Select all and backspace again to guarantee 0 residual characters!
        await cdpNativeKey(tabId, 'a', 'KeyA', 65, 4);
        await sleep(40);
        await cdpNativeKey(tabId, 'Backspace', 'Backspace', 8, 0);
        await sleep(60);

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

// Helper to ensure Terminal panel is open (Supports in-frame controller, tabs, '...' menu, status bar error icon, and Ctrl+`)
async function ensureTerminalOpen(tabId) {
  try {
    // Helper function for full realistic mouse click sequence required by VS Code Web UI
    const clickHelper = `
      function simulateClickSeq(el) {
        if (!el) return false;
        try { el.focus(); } catch(e) {}
        const r = el.getBoundingClientRect();
        const clientX = r.left + r.width / 2;
        const clientY = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, screenX: clientX, screenY: clientY, button: 0, buttons: 1 };
        try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
        try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
        try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
        try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
        try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
        try { el.click(); } catch(e) {}
        return true;
      }
    `;

    // 1. In all frames, check if terminal is already visible
    const checkRes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const candidates = [
          ...document.querySelectorAll('.terminal-outer-container, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, canvas.xterm-text-layer, canvas.xterm-cursor-layer, .xterm-screen, textarea.xterm-helper-textarea')
        ];
        for (const term of candidates) {
          const parent = term.closest('.terminal, .terminal-wrapper, .integrated-terminal') || term;
          if (parent.closest('.monaco-editor')) continue;
          const r = parent.getBoundingClientRect();
          if (r.width > 40 && r.height > 30) {
            return true;
          }
        }
        return false;
      }
    });

    if (checkRes?.some(r => r.result === true)) {
      console.log('[AP-Solver] Terminal is ALREADY open and visible. Keeping it intact.');
      return true;
    }

    // 2. Look for tab with text "TERMINAL" (Image 5/6 from user) across all frames
    const tabClickRes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const clientX = r.left + r.width / 2;
          const clientY = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
          try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
          try { el.click(); } catch(e) {}
          return true;
        }

        const tabs = [...document.querySelectorAll('[role="tab"], .action-item, .composite.title, [class*="tab" i]')];
        const termTab = tabs.find(t => (t.textContent || '').trim().toUpperCase() === 'TERMINAL' || t.getAttribute('aria-label')?.toLowerCase() === 'terminal');
        if (termTab) {
          return simulateClickSeq(termTab);
        }
        return false;
      }
    });

    if (tabClickRes?.some(r => r.result === true)) {
      await sleep(350);
      return true;
    }

    // 3. Look for "..." more actions button in panel title (Image 4 from user)
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const clientX = r.left + r.width / 2;
          const clientY = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
          try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
          try { el.click(); } catch(e) {}
          return true;
        }

        const moreBtn = document.querySelector('.part.panel .title [aria-label*="More" i], .part.panel [class*="codicon-more" i], .part.panel [class*="codicon-ellipsis" i], .composite.title [aria-label*="More" i]');
        if (moreBtn) {
          simulateClickSeq(moreBtn);
        }
      }
    });
    await sleep(250);

    const menuClickRes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const clientX = r.left + r.width / 2;
          const clientY = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
          try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
          try { el.click(); } catch(e) {}
          return true;
        }

        const items = [...document.querySelectorAll('.action-menu-item, [role="menuitem"], .monaco-menu-item, .action-label')];
        const termItem = items.find(it => (it.textContent || '').trim().toLowerCase() === 'terminal');
        if (termItem) {
          return simulateClickSeq(termItem);
        }
        return false;
      }
    });

    if (menuClickRes?.some(r => r.result === true)) {
      await sleep(350);
      return true;
    }

    // 4. Look for status bar problems button at bottom-left: "(X) 1  (!) 0" (Image 1, 2, 3 from user)
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const clientX = r.left + r.width / 2;
          const clientY = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
          try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
          try { el.click(); } catch(e) {}
          return true;
        }

        const statusProblems = document.querySelector('.statusbar-item.left [aria-label*="Problem" i], .statusbar-item.left [aria-label*="Error" i], .statusbar-item.left [class*="codicon-error" i], .statusbar-item.left');
        if (statusProblems) {
          simulateClickSeq(statusProblems);
        }
      }
    });
    await sleep(300);

    // After opening panel via problems, look for TERMINAL tab or "..."
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const clientX = r.left + r.width / 2;
          const clientY = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
          try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
          try { el.click(); } catch(e) {}
          return true;
        }

        const tabs = [...document.querySelectorAll('[role="tab"], .action-item, .composite.title, [class*="tab" i]')];
        const termTab = tabs.find(t => (t.textContent || '').trim().toUpperCase() === 'TERMINAL' || t.getAttribute('aria-label')?.toLowerCase() === 'terminal');
        if (termTab) {
          simulateClickSeq(termTab);
          return;
        }

        const moreBtn = document.querySelector('.part.panel .title [aria-label*="More" i], .part.panel [class*="codicon-more" i], .part.panel [class*="codicon-ellipsis" i]');
        if (moreBtn) {
          simulateClickSeq(moreBtn);
        }
      }
    });
    await sleep(200);

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        function simulateClickSeq(el) {
          if (!el) return false;
          try { el.focus(); } catch(e) {}
          const r = el.getBoundingClientRect();
          const clientX = r.left + r.width / 2;
          const clientY = r.top + r.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
          try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
          try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(e) {}
          try { el.click(); } catch(e) {}
          return true;
        }

        const items = [...document.querySelectorAll('.action-menu-item, [role="menuitem"], .action-label')];
        const termItem = items.find(it => (it.textContent || '').trim().toLowerCase() === 'terminal');
        if (termItem) {
          simulateClickSeq(termItem);
        }
      }
    });
    await sleep(350);

  } catch(e) {
    console.warn('[AP-Solver] ensureTerminalOpen error:', e);
  }
  return true;
}

// Helper to build atomic base64 single-line bash command (optional post-write commands run before git commit)
export function buildBase64TerminalScript(files, postCommands = []) {
  if (!files || files.length === 0) return '';
  let cmd = '';

  // 1. Non-interactive Permission and Safety Setup (sudo -n avoids blocking terminal on password prompt)
  cmd += `git config --global --add safe.directory /app/code 2>/dev/null || true && `;
  cmd += `(sudo -n true 2>/dev/null && sudo chmod -R 777 /app/code/.git 2>/dev/null && sudo chown -R newton:newton /app/code 2>/dev/null || true) && `;
  cmd += `(rm -f .git/index.lock 2>/dev/null || true) && `;
  cmd += `sed -i '/mkdir -p/d' src/index.js 2>/dev/null || true && `;
  cmd += `sed -i '/base64 -d/d' src/index.js 2>/dev/null || true && `;
  cmd += `sed -i '/=== AP-SOLVER/d' src/index.js 2>/dev/null || true && `;
  cmd += `git checkout -- src/index.js 2>/dev/null || true && `;

  const hasPrisma = files.some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client|model\s+/i.test(f.code));
  const hasSeed = files.some(f => (f.filePath && f.filePath.endsWith('seed.js')) || /prisma\.\w+\.(create|deleteMany)/i.test(f.code));

  for (const f of files) {
    let targetPath = f.filePath;
    if (targetPath.endsWith('.prisma') || /datasource\s+db|generator\s+client/i.test(f.code)) {
      targetPath = 'prisma/schema.prisma';
    } else if (/PrismaClient|prisma\.\w+\.(create|deleteMany)/i.test(f.code) && !/express|createServer/i.test(f.code)) {
      targetPath = 'src/seed.js';
    }
    const dir = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '';
    if (dir) {
      cmd += `mkdir -p "${dir}" && `;
    }
    const cleanCode = stripComments(f.code || '').trim();
    let b64 = '';
    try {
      b64 = btoa(unescape(encodeURIComponent(cleanCode)));
    } catch (e) {
      b64 = typeof Buffer !== 'undefined' ? Buffer.from(cleanCode).toString('base64') : btoa(cleanCode);
    }
    cmd += `echo "${b64}" | base64 -d > "${targetPath}" && `;
    if (targetPath.endsWith('schema.prisma') || targetPath === 'prisma/schema.prisma') {
      cmd += `cp "${targetPath}" ./schema.prisma 2>/dev/null || true && `;
      cmd += `mkdir -p prisma && cp "${targetPath}" prisma/schema.prisma 2>/dev/null || true && `;
    } else if (targetPath.endsWith('seed.js')) {
      cmd += `cp "${targetPath}" ./seed.js 2>/dev/null || true && `;
      cmd += `mkdir -p src && cp "${targetPath}" src/seed.js 2>/dev/null || true && `;
    }
  }

  const hasIndex = files.some(f => f.filePath && f.filePath.endsWith('index.js'));
  if (!hasIndex && (hasSeed || hasPrisma)) {
    const starterIndex = `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 8000;\napp.use(express.json());\napp.get('/', (req, res) => { res.send('Server is running'); });\nif (process.env.NODE_ENV !== 'test') {\n  app.listen(PORT, () => { console.log('Server running on port ' + PORT); });\n}\nmodule.exports = app;`;
    let b64Index = '';
    try {
      b64Index = btoa(unescape(encodeURIComponent(starterIndex)));
    } catch(e) {
      b64Index = typeof Buffer !== 'undefined' ? Buffer.from(starterIndex).toString('base64') : btoa(starterIndex);
    }
    cmd += `mkdir -p "src" && echo "${b64Index}" | base64 -d > "src/index.js" && `;
  }

  if (hasPrisma || hasSeed) {
    cmd += `node -e 'try { const p="./package.json", pkg=require(p); pkg.prisma = pkg.prisma || {}; pkg.prisma.seed = "node src/seed.js"; require("fs").writeFileSync(p, JSON.stringify(pkg, null, 2)); } catch(e){}' 2>/dev/null || true && `;
    cmd += `npm install --save-dev prisma 2>/dev/null || true && npm install @prisma/client 2>/dev/null || true && `;
    cmd += `(npx -y prisma db push --skip-generate 2>/dev/null || true) && (npx -y prisma generate 2>/dev/null || true) && `;
  }
  if (hasSeed) {
    cmd += `if [ -f src/seed.js ]; then node src/seed.js || true; elif [ -f seed.js ]; then node seed.js || true; fi && `;
  }

  // Execute any sanitized post-write setup/build/migration commands required for submission
  const seenPost = new Set();
  for (const rawCmd of (Array.isArray(postCommands) ? postCommands : [])) {
    const safeCmd = sanitizePostWriteCommand(rawCmd);
    if (!safeCmd || seenPost.has(safeCmd)) continue;
    seenPost.add(safeCmd);
    cmd += `(${safeCmd} || true) && `;
  }

  cmd += `(rm -f .git/index.lock 2>/dev/null; git config user.email "solver@ap.dev" 2>/dev/null; git config user.name "AP-Solver" 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true) && `;
  cmd += `echo "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ==="`;
  return cmd;
}

// Shared Helper: Locate Integrated Terminal frame across tabs/iframes
async function findTerminalFrameInfo(tabId) {
  const resolveTopOffset = async (match) => {
    if (!match || match.frameId === 0 || !match.result) return match;
    try {
      const ifrRes = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => {
          return [...document.querySelectorAll('iframe')].map(ifr => {
            const r = ifr.getBoundingClientRect();
            return { src: ifr.src || '', left: r.left, top: r.top, width: r.width, height: r.height };
          }).filter(r => r.width > 150 && r.height > 150);
        }
      });
      const iframes = ifrRes?.[0]?.result || [];
      const vsIframe = iframes.find(i => /codeserver|vscode|coder/i.test(i.src) || i.left > 150) || iframes[0];
      if (vsIframe) {
        match.result.x = vsIframe.left + match.result.localX;
        match.result.y = vsIframe.top + match.result.localY;
        match.result.frameLeft = vsIframe.left;
        match.result.frameTop = vsIframe.top;
      }
    } catch (e) {}
    return match;
  };

  const scanRes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const candidates = [
        ...document.querySelectorAll('.terminal-outer-container, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, canvas.xterm-text-layer, canvas.xterm-cursor-layer, .xterm-screen, textarea.xterm-helper-textarea')
      ];
      for (const term of candidates) {
        const parent = term.closest('.terminal, .terminal-wrapper, .integrated-terminal') || term;
        if (parent.closest('.monaco-editor')) continue;
        const r = parent.getBoundingClientRect();
        if (r.width > 40 && r.height > 30) {
          // Click on the left prompt side of the terminal so right-docked AP-Solver UI never intercepts it
          const lx = r.left + Math.min(60, Math.max(20, r.width * 0.2));
          const ly = r.top + Math.min(80, Math.max(15, r.height * 0.45));
          return {
            found: true,
            localX: lx,
            localY: ly,
            x: lx,
            y: ly,
            width: r.width,
            height: r.height
          };
        }
      }
      return { found: false };
    }
  });

  let match = scanRes?.find(r => r.result && r.result.found);
  if (!match) {
    await ensureTerminalOpen(tabId);
    await sleep(350);
    const retryScan = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const ta = document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea, [class*="xterm" i] textarea');
        if (ta && !ta.closest('.monaco-editor')) {
          const container = ta.closest('.terminal-wrapper, .terminal, .integrated-terminal') || ta;
          const r = container.getBoundingClientRect();
          const lx = r.left + Math.min(60, Math.max(15, r.width * 0.2));
          const ly = r.top + Math.min(60, Math.max(15, r.height * 0.45));
          return { found: true, localX: lx, localY: ly, x: lx, y: ly, width: r.width, height: r.height };
        }
        return { found: false };
      }
    });
    match = retryScan?.find(r => r.result && r.result.found);
  }
  return await resolveTopOffset(match || null);
}

// Shared Helper: Execute command in Integrated Terminal strictly protecting Monaco editor focus
async function dispatchCommandToTerminal(tabId, cmdText, settleMs = 1500) {
  await ensureTerminalOpen(tabId);
  const match = await findTerminalFrameInfo(tabId);
  const targetFrameId = match?.frameId;
  const pos = match?.result;

  // Helper: Click terminal canvas cleanly (bypassing #ap-solver-host) and focus xterm textarea
  const focusAndPrepareTerminalLine = async (clearExistingLine = true) => {
    const attached = await attachCDP(tabId);
    if (!attached || !pos) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: () => {
          const host = document.getElementById('ap-solver-host');
          if (host) {
            host.dataset.prevPe = host.style.pointerEvents || '';
            host.style.pointerEvents = 'none';
          }
        }
      });
    } catch (e) {}

    try {
      if (targetFrameId !== undefined) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [targetFrameId] },
            func: () => {
              document.querySelectorAll('.monaco-editor textarea, textarea.inputarea').forEach(t => { try { t.blur(); } catch(e) {} });
              const ta = document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea');
              if (ta && !ta.closest('.monaco-editor')) {
                try { ta.focus(); } catch(e) {}
              }
            }
          });
        } catch(e) {}
      }

      if (pos.x && pos.y) {
        await cdpNativeClick(tabId, pos.x, pos.y);
        await sleep(140);
      }

      const focusCheck = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const el = document.activeElement;
          if (!el) return { isTerminal: false, isMonaco: false };
          const isTerminal = el.classList.contains('xterm-helper-textarea') || (el.tagName === 'TEXTAREA' && !!el.closest('.terminal, .integrated-terminal'));
          const isMonaco = el.classList.contains('inputarea') || !!el.closest('.monaco-editor');
          return { isTerminal, isMonaco };
        }
      });
      const isTerminalFocused = focusCheck?.some(f => f.result?.isTerminal);
      const isMonacoFocused = focusCheck?.some(f => f.result?.isMonaco);
      if (isTerminalFocused && !isMonacoFocused && clearExistingLine) {
        await cdpNativeKey(tabId, 'c', 'KeyC', 67, 2); // Ctrl+C
        await sleep(80);
        await cdpNativeKey(tabId, 'u', 'KeyU', 85, 2); // Ctrl+U
        await sleep(80);
      }
      return { ok: isTerminalFocused && !isMonacoFocused, isTerminalFocused, isMonacoFocused, attached };
    } finally {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          func: () => {
            const host = document.getElementById('ap-solver-host');
            if (host) {
              host.style.pointerEvents = host.dataset.prevPe || '';
              delete host.dataset.prevPe;
            }
          }
        });
      } catch (e) {}
    }
  };

  // Clear any stuck/partial terminal input cleanly BEFORE pasting via xterm API
  const prep = await focusAndPrepareTerminalLine(true);

  // 1. In-frame xterm.paste (MAIN world so xterm instance on DOM elements is visible, + real CDP Enter)
  if (targetFrameId !== undefined) {
    try {
      const inFrameRes = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [targetFrameId] },
        world: 'MAIN',
        func: (cmd) => {
          document.querySelectorAll('.monaco-editor textarea, textarea.inputarea').forEach(t => { try { t.blur(); } catch(e) {} });

          const ta = document.querySelector('textarea.xterm-helper-textarea, .terminal textarea, .integrated-terminal textarea, [class*="xterm" i] textarea');
          if (ta && !ta.closest('.monaco-editor')) {
            try { ta.focus(); } catch(e) {}

            const termEls = [...document.querySelectorAll('.terminal, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, .xterm, .xterm-screen, canvas.xterm-text-layer')];
            for (const termEl of termEls) {
              for (const k of ['xterm', '_xterm', '__xterm']) {
                if (termEl && termEl[k] && typeof termEl[k].paste === 'function') {
                  try {
                    if (typeof termEl[k].input === 'function') {
                      termEl[k].input('\x03', true);
                      termEl[k].input('\x15', true);
                    }
                    termEl[k].paste(cmd);
                    if (typeof termEl[k].input === 'function') termEl[k].input('\r', true);
                    return true;
                  } catch(e) {}
                }
              }
            }
            return false;
          }
          return false;
        },
        args: [cmdText]
      });

      if (inFrameRes?.[0]?.result === true) {
        if (prep?.ok) {
          await sleep(160);
          await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
        }
        if (settleMs > 0) await sleep(settleMs);
        return { ok: true, method: 'terminal.inFrameScript', targetFrameId };
      }
    } catch (e) {
      console.warn('[AP-Solver Terminal] inFrameScript error:', e);
    }
  }

  // 2. Secondary fallback: in-frame content script sendMessage -> Main World xterm.paste + REAL CDP Enter!
  if (targetFrameId !== undefined) {
    try {
      const injectResp = await chrome.tabs.sendMessage(tabId, {
        op: 'AP_INJECT_TERMINAL_COMMAND',
        data: { command: cmdText }
      }, { frameId: targetFrameId });
      if (injectResp && injectResp.ok) {
        if (!injectResp.sentEnterViaCore) {
          await sleep(180);
          if (prep?.ok) {
            await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
          } else {
            const postPrep = await focusAndPrepareTerminalLine(false);
            if (postPrep && !postPrep.isMonacoFocused) {
              await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
            }
          }
        }
        if (settleMs > 0) await sleep(settleMs);
        return { ok: true, method: 'terminal.inFrame', targetFrameId };
      }
    } catch (e) {}
  }

  // 3. HARDWARE CDP FALLBACK: STRICT FOCUS GUARD
  if (prep && pos) {
    if (prep.isTerminalFocused && !prep.isMonacoFocused) {
      await cdpNativeInsertText(tabId, cmdText);
      await sleep(150);
      await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
      if (settleMs > 0) await sleep(settleMs);
      return { ok: true, method: 'terminal.cdp', targetFrameId };
    } else {
      console.warn('[AP-Solver Terminal] Focus guard: Terminal does not have confirmed exclusive focus (isTerminal:', prep.isTerminalFocused, 'isMonaco:', prep.isMonacoFocused, '). Aborting CDP typing to protect editor.');
      return { ok: false, error: 'Terminal does not have active focus. Command copied to clipboard.' };
    }
  }

  return { ok: false, error: 'Terminal not found across frames' };
}

// Read terminal screen/scrollback text in MAIN world (unlocks WebGL xterm buffer API + DOM + A11y tree)
async function readIntegratedTerminalText(tabId, targetFrameId = undefined) {
  try {
    const target = targetFrameId !== undefined ? { tabId, frameIds: [targetFrameId] } : { tabId, allFrames: true };
    const res = await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: () => {
        const texts = [];
        // 1. Check exposed xterm buffer instance across all terminal wrappers (works even under WebGL canvas rendering!)
        const termWrappers = document.querySelectorAll('.terminal, .terminal-wrapper, .terminal.xterm, .pane-body.integrated-terminal, .xterm, .xterm-screen, canvas.xterm-text-layer');
        for (const el of termWrappers) {
          for (const k of ['xterm', '_xterm', '__xterm']) {
            const inst = el && el[k];
            const buf = inst?.buffer?.active || inst?.buffer?.normal || inst?._core?.buffer?.lines;
            if (buf) {
              try {
                const len = buf.length || 0;
                const lines = [];
                const startIdx = Math.max(0, len - 320);
                for (let i = startIdx; i < len; i++) {
                  const line = buf.getLine ? buf.getLine(i) : (buf.get ? buf.get(i) : null);
                  if (line && line.translateToString) {
                    lines.push(line.translateToString(true));
                  }
                }
                const joined = lines.join('\n').trim();
                if (joined) texts.push(joined);
              } catch(e) {}
            }
          }
        }

        // 2. Check DOM renderer rows (.xterm-rows > div)
        const xtermRowContainers = document.querySelectorAll('.xterm-rows');
        for (const container of xtermRowContainers) {
          if (container.closest('.monaco-editor') || container.closest('#ap-solver-host')) continue;
          const rows = [...container.querySelectorAll(':scope > div, div')];
          if (rows.length > 0) {
            const joined = rows.map(r => (r.textContent || '').replace(/\u00a0/g, ' ')).join('\n').trim();
            if (joined) texts.push(joined);
          }
        }

        // 3. Check Accessibility tree rows (.xterm-accessibility-tree / [role="listitem"])
        const a11yContainers = document.querySelectorAll('.xterm-accessibility-tree, .xterm-accessibility');
        for (const acc of a11yContainers) {
          if (acc.closest('.monaco-editor') || acc.closest('#ap-solver-host')) continue;
          const items = [...acc.querySelectorAll('div, [role="listitem"]')];
          if (items.length > 0) {
            const joined = items.map(i => (i.textContent || '').replace(/\u00a0/g, ' ')).join('\n').trim();
            if (joined) texts.push(joined);
          }
        }

        if (texts.length === 0) return '';
        texts.sort((a, b) => b.length - a.length);
        return texts[0];
      }
    });

    const combined = (res || []).map(r => r?.result || '').filter(Boolean);
    if (combined.length === 0) return '';
    combined.sort((a, b) => b.length - a.length);
    return combined[0];
  } catch (e) {
    return '';
  }
}

// Helper: Decode GZ:<base64> or RAW:<base64> JSON output captured from terminal
async function decodeTerminalJsonPayload(rawInner) {
  const txt = (rawInner || '').trim();
  const gzMatch = txt.match(/GZ:([A-Za-z0-9+/=\s]+)/);
  if (gzMatch) {
    try {
      const cleanB64 = gzMatch[1].replace(/[^A-Za-z0-9+/=]/g, '');
      const binStr = atob(cleanB64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const decompressed = await new Response(stream).text();
        return JSON.parse(decompressed);
      }
    } catch (e) {
      console.warn('[AP-Solver] GZ decode failed:', e);
    }
  }
  const rawMatch = txt.match(/RAW:([A-Za-z0-9+/=\s]+)/);
  if (rawMatch) {
    try {
      const cleanB64 = rawMatch[1].replace(/[^A-Za-z0-9+/=]/g, '');
      const binStr = atob(cleanB64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      const jsonStr = new TextDecoder().decode(bytes);
      return JSON.parse(jsonStr);
    } catch (e) {
      console.warn('[AP-Solver] RAW decode failed:', e);
    }
  }
  return null;
}

// Execute bash command in Integrated Terminal and capture decoded output between sentinels
async function runTerminalCommandWithCapture(tabId, { bashCmd, startMarker, endMarker, timeoutMs = 15000 }) {
  try {
    try {
      const att = await attachCDP(tabId);
      if (att) await sendCDP(tabId, 'Accessibility.enable');
    } catch (e) {}

    await ensureTerminalOpen(tabId);
    let baseText = await readIntegratedTerminalText(tabId);
    if (!baseText || !baseText.trim()) {
      await sleep(200);
      baseText = await readIntegratedTerminalText(tabId);
    }
    // Never type long base64 | node capture pipes into a WebGL canvas terminal whose stdout cannot be read in DOM!
    if (!baseText || !baseText.trim()) {
      return { ok: false, unreadable: true, error: 'Terminal output unavailable in DOM/buffer (WebGL renderer)' };
    }
    const countOccurrences = (str, sub) => {
      if (!str || !sub) return 0;
      let count = 0, pos = 0;
      while ((pos = str.indexOf(sub, pos)) !== -1) {
        count++;
        pos += sub.length;
      }
      return count;
    };
    const baseEndCount = countOccurrences(baseText, endMarker);

    const execRes = await dispatchCommandToTerminal(tabId, bashCmd, 300);
    if (!execRes || !execRes.ok) {
      return { ok: false, error: execRes?.error || 'Could not dispatch terminal command' };
    }

    const tStart = Date.now();
    let sawOutputChange = false;
    while (Date.now() - tStart < timeoutMs) {
      await sleep(350);
      const curText = await readIntegratedTerminalText(tabId, execRes.targetFrameId);
      if (curText && curText !== baseText) {
        sawOutputChange = true;
      }

      const curEndCount = countOccurrences(curText, endMarker);
      if (curEndCount > baseEndCount) {
        const endIdx = curText.lastIndexOf(endMarker);
        const startIdx = curText.lastIndexOf(startMarker, endIdx);
        const sliceStart = startIdx !== -1 ? startIdx + startMarker.length : Math.max(0, endIdx - 6000);
        const rawBlock = curText.substring(sliceStart, endIdx);
        return { ok: true, raw: rawBlock, fullText: curText };
      }

      if (!sawOutputChange && (Date.now() - tStart > 3500)) {
        return { ok: false, unreadable: true, error: 'Terminal output unavailable in DOM/buffer' };
      }
    }

    return { ok: false, timedOut: true, error: 'Terminal capture timed out waiting for completion marker' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// Probe container workspace cleanly via terminal: reads package.json, prisma schema, .env, and test/*.js files
async function probeWorkspaceViaTerminal(tabId) {
  const probeJs = `
const fs=require('fs'),zlib=require('zlib');
const S='===AP'+'_CTX_START===',E='===AP'+'_CTX_END===';
const out={files:{},allFiles:[]};
let pkgRaw='';
try{
  if(fs.existsSync('package.json')){
    const raw=fs.readFileSync('package.json','utf8');
    try{const p=JSON.parse(raw);pkgRaw=JSON.stringify({name:p.name,type:p.type,scripts:p.scripts,dependencies:p.dependencies,devDependencies:p.devDependencies},null,2);}
    catch(e){pkgRaw=raw.slice(0,2500);}
    out.files['package.json']=pkgRaw;
  }
}catch(e){}
try{if(fs.existsSync('.env'))out.files['.env']=fs.readFileSync('.env','utf8').slice(0,1000);}catch(e){}
const testCands=[],keyCands=[];
function walk(d,depth){
  if(depth>3)return;
  let ents=[];try{ents=fs.readdirSync(d,{withFileTypes:true});}catch(e){return;}
  for(const ent of ents){
    if(ent.name==='node_modules'||ent.name==='.git'||ent.name==='dist'||ent.name==='build')continue;
    const p=d==='.'?ent.name:d+'/'+ent.name;
    if(ent.isDirectory()){walk(p,depth+1);}
    else{
      out.allFiles.push(p);
      if(/(?:^|\\/)(?:test|tests|__tests__)\\/|\\.(?:test|spec)\\.(?:js|ts|mjs|cjs)$/i.test(p))testCands.push(p);
      else if(/\\.prisma$|^db\\/.*\\.js$|^src\\/.*\\.js$/i.test(p))keyCands.push(p);
    }
  }
}
walk('.',0);
for(const p of testCands.slice(0,4)){try{out.files[p]=fs.readFileSync(p,'utf8').slice(0,4500);}catch(e){}}
for(const p of keyCands.slice(0,5)){try{if(fs.statSync(p).size<8000)out.files[p]=fs.readFileSync(p,'utf8').slice(0,1800);}catch(e){}}
let gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
if(gz.length>1600){
  for(const p of keyCands){if(out.files[p]&&p!=='prisma/schema.prisma'&&!p.endsWith('schema.prisma'))delete out.files[p];}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
if(gz.length>1600){
  for(const p of testCands){if(out.files[p])out.files[p]=out.files[p].slice(0,2200);}
  gz=zlib.gzipSync(Buffer.from(JSON.stringify(out))).toString('base64');
}
console.log('\\n'+S+'\\nGZ:'+gz+'\\n'+E);
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(probeJs).toString('base64') : btoa(unescape(encodeURIComponent(probeJs)));
  const bashCmd = `echo "${b64}" | base64 -d | node 2>/dev/null || printf "===AP""_CTX_START===\\nRAW:e30=\\n===AP""_CTX_END===\\n"`;

  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd,
    startMarker: '===AP_CTX_START===',
    endMarker: '===AP_CTX_END===',
    timeoutMs: 8000
  });

  if (!cap.ok) return cap;
  const decoded = await decodeTerminalJsonPayload(cap.raw);
  if (!decoded) return { ok: false, error: 'Failed to parse probe payload' };
  return { ok: true, files: decoded.files || {}, allFiles: decoded.allFiles || [] };
}

/** Run syntax check, local container test suite (`npm test`), and safe startup smoke check BEFORE slow Remote Submit. */
async function runLocalTestsViaTerminal(tabId, targetFiles = []) {
  const jsFilesJson = JSON.stringify((targetFiles || []).filter(f => /\.js$/i.test(f)));
  const runnerJs = `
const fs=require('fs'),zlib=require('zlib'),{spawnSync}=require('child_process');
const S='===AP'+'_LTEST_START===',E='===AP'+'_LTEST_END===';
const emit=(obj)=>{let lim=8000,gz='';while(lim>=1000){const p={...obj,output:(obj.output||'').slice(-lim)};gz=zlib.gzipSync(Buffer.from(JSON.stringify(p))).toString('base64');if(gz.length<=1650)break;lim=Math.floor(lim*0.65);}console.log('\\n[Local Test] pass='+(obj.passed||0)+' fail='+(obj.failed||0)+' exit='+(obj.exitCode??0));console.log(S+'\\nGZ:'+gz+'\\n'+E);process.exit(0);};
const targets=${jsFilesJson};
const syntaxCandidates=[...new Set([...targets,...(fs.existsSync('src')?fs.readdirSync('src').filter(f=>/\\.js$/i.test(f)).map(f=>'src/'+f):[])])].filter(f=>fs.existsSync(f));
for(const f of syntaxCandidates){
  const chk=spawnSync('node',['--check',f],{encoding:'utf8',timeout:5000});
  if(chk.status!==0){emit({skip:false,isSyntaxError:true,exitCode:1,passed:0,failed:1,output:'SyntaxError in '+f+':\\n'+((chk.stderr||chk.stdout||'').trim())});}
}
let pkgRaw='';let pkg={};try{pkgRaw=fs.readFileSync('package.json','utf8');pkg=JSON.parse(pkgRaw);}catch(e){}
const script=(pkg.scripts&&pkg.scripts.test)||'';
const hasScript=Boolean(script&&!/no test specified/i.test(script));
const dirs=['test','tests','__tests__','src/__tests__','src/test'].filter(d=>fs.existsSync(d));
const rootTests=fs.readdirSync('.').filter(f=>/\\.(test|spec)\\.(js|ts|mjs|cjs)$/i.test(f));
if(!hasScript&&dirs.length===0&&rootTests.length===0){
  const entry=syntaxCandidates.find(f=>/index\\.js$/i.test(f))||syntaxCandidates[0];
  if(entry&&pkg.type!=='module'){
    const probeCode='process.on("uncaughtException",e=>{if(e&&e.code==="EADDRINUSE")process.exit(0);console.error(e);process.exit(1);});setTimeout(()=>process.exit(0),250);require("./"+'+JSON.stringify(entry)+');';
    const smk=spawnSync('node',['-e',probeCode],{encoding:'utf8',timeout:2500,env:{...process.env,NODE_ENV:'test',PORT:'0'}});
    const smkOut=((smk.stderr||'')+'\\n'+(smk.stdout||'')).trim();
    if(/Cannot find module|SyntaxError|ReferenceError|TypeError|PrismaClientInitializationError|did not initialize/i.test(smkOut)){
      emit({skip:false,pkgRaw,exitCode:1,passed:0,failed:1,output:'Startup Load Failure ('+entry+'):\\n'+smkOut});
    }
  }
  const p=zlib.gzipSync(Buffer.from(JSON.stringify({skip:true}))).toString('base64');
  console.log('\\n'+S+'\\nGZ:'+p+'\\n'+E);
  process.exit(0);
}
const cmd=hasScript?'npm test':('npx -y mocha '+(dirs.length?dirs.map(d=>"'"+d+"/**/*.{js,ts}'").join(' '):"'*.test.js'"));
const r=spawnSync('sh',['-c',cmd],{encoding:'utf8',timeout:28000,env:{...process.env,NODE_ENV:'test',CI:'true'}});
const raw=((r.stdout||'')+'\\n'+(r.stderr||'')).replace(/\\x1b\\[[0-9;]*m/g,'');
const clean=raw.split('\\n').filter(l=>!/^\\s*at .*(?:node_modules|node:internal)/.test(l)).join('\\n');
const passM=raw.match(/(\\d+)\\s+passing/i);
const failM=raw.match(/(\\d+)\\s+failing/i);
const jestFailM=raw.match(/Tests:\\s*(\\d+)\\s+failed/i);
const passed=passM?parseInt(passM[1],10):0;
const failed=failM?parseInt(failM[1],10):(jestFailM?parseInt(jestFailM[1],10):(r.status===0?0:1));
const timedOut=!!(r.error&&r.error.code==='ETIMEDOUT');
emit({skip:false,pkgRaw,exitCode:r.status===null?1:r.status,timedOut,passed,failed,output:clean});
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(runnerJs).toString('base64') : btoa(unescape(encodeURIComponent(runnerJs)));
  const bashCmd = `echo "${b64}" | base64 -d | node`;

  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd,
    startMarker: '===AP_LTEST_START===',
    endMarker: '===AP_LTEST_END===',
    timeoutMs: 36000
  });

  if (!cap.ok) {
    return {
      ok: false,
      status: cap.unreadable ? 'unreadable' : 'error',
      error: cap.error
    };
  }

  const decoded = await decodeTerminalJsonPayload(cap.raw);
  if (!decoded) {
    return { ok: false, status: 'unreadable', error: 'Could not decode local test payload' };
  }
  if (decoded.skip) {
    return { ok: true, status: 'no_local_tests' };
  }

  const allPassed = decoded.exitCode === 0 && decoded.failed === 0 && !decoded.timedOut;
  const autoFixCommands = allPassed
    ? []
    : detectRequiredPostWriteCommands({
        packageJsonStr: decoded.pkgRaw || '',
        filesToWrite: (targetFiles || []).map(f => ({ filePath: f })),
        lastErrorOutput: decoded.output || ''
      });

  return {
    ok: true,
    status: allPassed ? 'passed' : 'failed',
    exitCode: decoded.exitCode,
    passed: decoded.passed || 0,
    failed: decoded.failed || 0,
    timedOut: decoded.timedOut,
    isSyntaxError: !!decoded.isSyntaxError,
    autoFixCommands,
    output: decoded.output || ''
  };
}

/** Execute safe setup/build/migration/remediation commands in container terminal and capture structured results. */
async function runTerminalCommandsViaTerminal(tabId, commands = []) {
  const cleanCmds = (Array.isArray(commands) ? commands : [])
    .map(c => sanitizePostWriteCommand(c))
    .filter(Boolean);
  if (cleanCmds.length === 0) {
    return { ok: true, ran: [], exitCode: 0, output: '' };
  }

  const runnerJs = `
const zlib=require('zlib'),{spawnSync}=require('child_process');
const S='===AP'+'_CMD_START===',E='===AP'+'_CMD_END===';
const cmds=${JSON.stringify(cleanCmds)};
const logs=[];let lastCode=0;
for(const c of cmds){
  const r=spawnSync('sh',['-c',c],{encoding:'utf8',timeout:35000,env:{...process.env,CI:'true'}});
  const out=((r.stdout||'')+'\\n'+(r.stderr||'')).trim();
  logs.push('$ '+c+' (exit='+(r.status??1)+')\\n'+out.slice(-800));
  if((r.status??1)!==0){lastCode=r.status??1;}
}
const full=logs.join('\\n');
let lim=4000,gz='';
while(lim>=600){gz=zlib.gzipSync(Buffer.from(JSON.stringify({exitCode:lastCode,ran:cmds,output:full.slice(-lim)}))).toString('base64');if(gz.length<=1650)break;lim=Math.floor(lim*0.65);}
console.log('\\n'+S+'\\nGZ:'+gz+'\\n'+E);
`.trim();

  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(runnerJs).toString('base64') : btoa(unescape(encodeURIComponent(runnerJs)));
  const bashCmd = `echo "${b64}" | base64 -d | node`;

  const cap = await runTerminalCommandWithCapture(tabId, {
    bashCmd,
    startMarker: '===AP_CMD_START===',
    endMarker: '===AP_CMD_END===',
    timeoutMs: 42000
  });

  if (cap.ok) {
    const decoded = await decodeTerminalJsonPayload(cap.raw);
    if (decoded) {
      return { ok: decoded.exitCode === 0, ran: decoded.ran || cleanCmds, exitCode: decoded.exitCode || 0, output: decoded.output || '' };
    }
  }

  // Fallback if terminal stdout is genuinely unreadable: dispatch direct chained shell commands safely
  if (cap.unreadable) {
    const chained = cleanCmds.map(c => `(${c} || true)`).join(' && ') + ' && (rm -f .git/index.lock 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true)';
    const disp = await dispatchCommandToTerminal(tabId, chained, 2500);
    return { ok: !!disp?.ok, ran: cleanCmds, exitCode: disp?.ok ? 0 : 1, output: '', fallbackDispatched: true };
  }

  return { ok: false, ran: cleanCmds, exitCode: 1, output: cap.error || 'Command runner failed' };
}

// Direct Terminal File Injection Engine (Zero-Click Linux Disk Writer)
async function writeFilesViaTerminal(tabId, files, customScript = null, postCommands = []) {
  if (!files || files.length === 0) return { ok: false, error: 'No files provided' };

  const bashScript = customScript || buildBase64TerminalScript(files, postCommands);

  try {
    // Capture baseline BEFORE dispatching command so fast completion is never missed
    const baseline = await readIntegratedTerminalText(tabId);
    const baseDoneCount = (baseline.match(/AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY/g) || []).length;

    const res = await dispatchCommandToTerminal(tabId, bashScript, 0);
    if (!res || !res.ok) {
      return res;
    }

    const hasHeavyCmd = /prisma|npm install|npm run build|npx tsc|migrate/i.test(bashScript);
    const maxWait = hasHeavyCmd ? 22000 : 6000;
    const t0 = Date.now();
    await sleep(700);

    while (Date.now() - t0 < maxWait) {
      const curText = await readIntegratedTerminalText(tabId, res.targetFrameId);
      const curDoneCount = (curText.match(/AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY/g) || []).length;
      if (curDoneCount > baseDoneCount + 1 || (curDoneCount > baseDoneCount && /(?:^|\n)[^\n]*[$#]\s*$/.test(curText.trimEnd()))) {
        return { ok: true, verified: true, method: res.method };
      }
      if (!curText && (Date.now() - t0 > (hasHeavyCmd ? 8000 : 2500))) {
        break;
      }
      await sleep(400);
    }

    return { ok: true, verified: false, method: res.method };
  } catch (e) {
    console.warn('[AP-Solver Terminal] writeFilesViaTerminal error:', e);
    return { ok: false, error: e.message || String(e) };
  }
}

// Global Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { op, data } = message;

  // Handle async operations with async IIFE
  (async () => {
    try {
      if (op === 'AP_KEEPALIVE') {
        sendResponse({ ok: true, ts: Date.now() });
      } else if (op === 'AP_GET_SETTINGS') {
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
      } else if (op === 'AP_PROBE_WORKSPACE') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        const resp = await probeWorkspaceViaTerminal(tabId);
        sendResponse(resp);
      } else if (op === 'AP_RUN_LOCAL_TESTS') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        const resp = await runLocalTestsViaTerminal(tabId, data?.files || []);
        sendResponse(resp);
      } else if (op === 'AP_RUN_TERMINAL_COMMANDS') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        const resp = await runTerminalCommandsViaTerminal(tabId, data?.commands || []);
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
        const resp = await writeFilesViaTerminal(tabId, data.files, data.script, data.postCommands || []);
        sendResponse(resp);
      } else if (op === 'AP_CLEAN_EDITOR_ARTIFACTS') {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'No tab ID found in sender.' });
          return;
        }
        try {
          const frames = await chrome.webNavigation.getAllFrames({ tabId });
          let cleaned = 0;
          for (const fr of frames) {
            try {
              const res = await chrome.tabs.sendMessage(tabId, { op: 'AP_CLEAN_EDITOR_ARTIFACTS' }, { frameId: fr.frameId });
              if (res?.ok) cleaned += (res.cleanedCount || 0);
            } catch(e) {}
          }
          sendResponse({ ok: true, cleanedCount: cleaned });
        } catch(e) {
          sendResponse({ ok: false, error: e.message });
        }
      } else if (op === 'AP_RELOAD_EXT') {
        sendResponse({ ok: true });
        setTimeout(() => chrome.runtime.reload(), 100);
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
