// background/cdp.js - Chrome DevTools Protocol (CDP) Native Hardware Driver & Visual Targeting

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function attachCDP(tabId) {
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

export function sendCDP(tabId, method, params = {}) {
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

/** True native OS mouse click (isTrusted=true). */
export async function cdpNativeClick(tabId, x, y, clickCount = 1) {
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

/** True native OS double-click. */
export async function cdpNativeDblClick(tabId, x, y) {
  await cdpNativeClick(tabId, x, y, 1);
  await sleep(60);
  await cdpNativeClick(tabId, x, y, 2);
}

/** True native key press (uses keyDown + text:'\r'/char for Enter so xterm.js & Monaco register Enter cleanly). */
export async function cdpNativeKey(tabId, key, code, keyCode, modifiers = 0) {
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

/** Chunked native text insert so xterm PTY never drops large base64 scripts. */
export async function cdpNativeInsertText(tabId, text) {
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

export async function cdpQuickOpenFile(tabId, targetFilePath) {
  if (!targetFilePath) return false;
  const basename = targetFilePath.split('/').pop().trim();
  try {
    const attached = await attachCDP(tabId);
    if (!attached) return false;
    await cdpNativeKey(tabId, 'p', 'KeyP', 80, 4);
    await sleep(250);
    await cdpNativeInsertText(tabId, basename);
    await sleep(250);
    await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
    await sleep(350);
    console.log(`[AP-Solver CDP] Quick Open triggered for "${basename}".`);
    return true;
  } catch (err) {
    console.warn('[AP-Solver CDP] Quick Open error:', err);
    return false;
  }
}

export async function showVisualTargetBeacon(tabId, x, y, basename, elType) {
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

/** True native CDP click on VS Code tab or Explorer tree item across iframes. */
export async function cdpClickElementInWorkspace(tabId, targetFilePath) {
  if (!targetFilePath) return false;
  let cleanPath = targetFilePath.trim();
  const basename = cleanPath.split('/').pop().trim();

  if (!basename || !basename.includes('.') || /^(1|2|3|4|5|one|two)(\.(js|ts))?$/i.test(basename)) {
    console.warn(`[AP-Solver CDP] Skipped invalid target filename: "${targetFilePath}"`);
    return false;
  }

  try {
    const attached = await attachCDP(tabId);

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

    // PASS 0: Check if target file is already active
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

    // PASS 1: Check existing tabs, Explorer rows, or collapsed src folder
    const scanResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [basename],
      func: (base) => {
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '');
        const normBase = norm(base);

        const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
        for (const t of tabs) {
          const aria = norm(t.getAttribute('aria-label'));
          const txt = norm((t.querySelector('.label-name') || t).textContent);
          if (aria.includes(normBase) || txt.includes(normBase)) {
            try {
              t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              t.click();
              t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
              t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
              t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
            } catch(e) {}

            try {
              const m = window.monaco || (typeof window.require === 'function' ? window.require('vs/editor/editor.main') : null);
              if (m && m.editor) {
                const models = m.editor.getModels ? m.editor.getModels() : [];
                const match = models.find(mod => (mod.uri?.path || '').toLowerCase().includes(normBase));
                const editors = m.editor.getEditors ? m.editor.getEditors() : [];
                if (match && editors[0]) editors[0].setModel(match);
              }
            } catch(e) {}

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

    const matches = scanResults?.filter(s => s.result && ['tab', 'treeItem', 'expandSrc'].includes(s.result.type));
    let targetMatch = matches?.find(s => s.result.type === 'tab') ||
                      matches?.find(s => s.result.type === 'treeItem') ||
                      matches?.find(s => s.result.type === 'expandSrc');

    // PASS 2: New File button if file doesn't exist
    if (!targetMatch) {
      const newFileScan = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const workbench = document.querySelector('.monaco-workbench, .part.sidebar, .explorer-viewlet');
          if (!workbench) return null;
          const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
          const srcRow = rows.find(r => (r.querySelector('.label-name') || r).textContent.trim().toLowerCase() === 'src');
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
      const vsIframe = iframes.find(ifr => ifr.left > 150) || iframes[0];
      if (vsIframe) {
        globalX = vsIframe.left + localX;
        globalY = vsIframe.top + localY;
      }
    }

    console.log(`[AP-Solver CDP] Targeting "${basename}" (${type}) at viewport pixel (${Math.round(globalX)}, ${Math.round(globalY)})`);
    await showVisualTargetBeacon(tabId, globalX, globalY, basename, type);

    if (attached) {
      if (type === 'expandSrc') {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const rows = [...document.querySelectorAll('.monaco-list-row, [role="treeitem"]')];
            const src = rows.find(r => (r.querySelector('.label-name') || r).textContent.trim().toLowerCase() === 'src');
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

        await cdpNativeClick(tabId, globalX, globalY, 1);
        await sleep(60);
        await cdpNativeDblClick(tabId, globalX, globalY);
        await sleep(60);
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
        await cdpNativeKey(tabId, 'Escape', 'Escape', 27, 0);
        await sleep(60);
        await cdpNativeDblClick(tabId, globalX, globalY);
        await sleep(250);
        return true;
      }

      if (type === 'createNewFile') {
        await cdpNativeClick(tabId, globalX, globalY, 1);
        await sleep(350);
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
        await cdpNativeInsertText(tabId, basename);
        await sleep(150);
        await cdpNativeKey(tabId, 'Enter', 'Enter', 13, 0);
        await sleep(800);
        return true;
      }
    }

    return true;
  } catch (err) {
    console.warn('[AP-Solver CDP] cdpClickElementInWorkspace error:', err);
    return false;
  }
}

export async function cdpSaveFile(tabId) {
  try {
    await cdpNativeKey(tabId, 's', 'KeyS', 83, 4);
    await sleep(50);
    await cdpNativeKey(tabId, 's', 'KeyS', 83, 2);
  } catch (e) {}
}
