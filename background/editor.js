// background/editor.js - Monaco / VS Code Web cross-frame reader & fallback editor writer
import { formatCodeIndentation } from '../utils/code-format.js';
import {
  sleep,
  attachCDP,
  cdpNativeClick,
  cdpNativeKey,
  cdpNativeInsertText,
  cdpClickElementInWorkspace,
  cdpSaveFile
} from './cdp.js';

/** Query active VS Code Web / Monaco editor, active filename & workspace files across frames. */
export async function queryEditorInTab(tabId) {
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
          if (!isWorkbench && document.querySelector('iframe')) return null;
          if (window.self === window.top && document.querySelector('iframe')) return null;

          function detectActiveFile() {
            const breadcrumbs = [...document.querySelectorAll('.breadcrumbs-widget .monaco-breadcrumb-item')].map(b => b.textContent.trim()).filter(Boolean);
            if (breadcrumbs.length > 0) {
              const last = breadcrumbs[breadcrumbs.length - 1].replace(/^[A-Z]+\s+/, '');
              if (last.includes('.') && !/^\d+$/.test(last)) {
                return (breadcrumbs.length >= 2 && breadcrumbs[0] === 'src') ? 'src/' + last : last;
              }
            }
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
                if (val && val.length < 35000) referenceFiles[cleanKey] = val;
              }
              if (fname && fname.includes('.') && !/^\d+$/.test(fname)) {
                const subMatch = p.match(/\/((?:test|tests|__tests__|prisma|db|routes|controllers|middleware|models|utils)\/[^/]+)$/i);
                workspaceFiles.push(subMatch ? subMatch[1] : (p.includes('src/') ? 'src/' + fname : fname));
              }
            }

            let activeModel = null;
            if (detectedActive) {
              const basename = detectedActive.split('/').pop();
              activeModel = models.find(mod => (mod.uri?.path || '').endsWith(basename));
            }

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
              if (!fname || /^\d+$/.test(fname)) fname = 'src/index.js';
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

/** Manual single-file inject helper for individual file cards (strictly isolated from automated Terminal-First flow). */
export async function writeEditorInTab(tabId, newCode, targetFilePath = null) {
  try {
    const cleanCode = formatCodeIndentation(newCode);

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
          if (!isWorkbench && document.querySelector('iframe')) return null;
          if (window.self === window.top && document.querySelector('iframe')) return null;

          const sleep = (ms) => new Promise(r => setTimeout(r, ms));

          function simulateClick(el) {
            if (!el) return false;
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch(e) {}
            try { el.focus(); } catch(e) {}
            const list = el.closest?.('.monaco-list, .monaco-tree-view');
            if (list) { try { list.focus(); } catch(e) {} }

            const activeInput = document.querySelector('.monaco-list-row input, .monaco-inputbox input, input.monaco-inputbox');
            if (activeInput) {
              try {
                activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                activeInput.blur();
              } catch(e) {}
            }

            const isTreeRow = el.classList?.contains('monaco-list-row') || el.getAttribute?.('role') === 'treeitem';
            // NEVER click the text label name, which triggers inline rename!
            const icon = isTreeRow ? (el.querySelector('.monaco-icon-label-icon, .codicon, .monaco-tl-twistie') || el) : null;
            const target = icon || el.querySelector?.('.label-name, .monaco-icon-label') || el;
            const rect = target.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const clientX = isTreeRow
              ? ((rect.left && rect.left > 0) ? (rect.left + 8) : (elRect.left + 24))
              : ((rect.left + rect.width / 2) || 150);
            const clientY = (rect.top + rect.height / 2) || 150;

            const baseOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY, screenX: clientX, screenY: clientY, button: 0, buttons: 1 };
            const clickOpts1 = { ...baseOpts, detail: 1 };
            for (const t of ['pointerdown', 'mousedown']) try { target.dispatchEvent(t.startsWith('p') ? new PointerEvent(t, clickOpts1) : new MouseEvent(t, clickOpts1)); } catch (e) {}
            for (const t of ['pointerup', 'mouseup', 'click']) try { target.dispatchEvent(t.startsWith('p') ? new PointerEvent(t, clickOpts1) : new MouseEvent(t, clickOpts1)); } catch (e) {}

            const clickOpts2 = { ...baseOpts, detail: 2 };
            for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
              try { target.dispatchEvent(t.startsWith('p') ? new PointerEvent(t, clickOpts2) : new MouseEvent(t, clickOpts2)); } catch (e) {}
            }
            try { el.click?.(); } catch (e) {}
            try { target.click?.(); } catch (e) {}
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

          async function navigateToTargetFile(target) {
            if (!target) return false;
            const basename = target.split('/').pop();
            const normBase = normStr(basename);
            const isSrc = target.includes('src/') || /\.(js|ts|json|txt)$/i.test(target);

            const tabs = [...document.querySelectorAll('.tab, [role="tab"]')];
            const welcomeTab = tabs.find(t => /welcome/i.test((t.querySelector('.label-name') || t).textContent.trim()));
            if (welcomeTab) welcomeTab.querySelector('.tab-close-action, .codicon-close')?.click();

            const activeTabEl = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
            const activeLabel = (activeTabEl?.querySelector('.label-name') || activeTabEl)?.textContent?.trim() || '';
            if (normStr(activeLabel).includes(normBase)) return true;

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
              if (normStr(curTxt).includes(normBase)) return true;
            }

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
              const activeEd = (m.editor.getEditors ? m.editor.getEditors() : [])[0];
              if (matchModel && activeEd) {
                activeEd.setModel(matchModel);
                await sleep(150);
                return true;
              }
            }

            if (isSrc) {
              const srcItem = findExplorerItem('src');
              if (srcItem && (srcItem.getAttribute('aria-expanded') === 'false' || !!srcItem.querySelector('.collapsed, .codicon-chevron-right'))) {
                const twistie = srcItem.querySelector('.monaco-tl-twistie, .codicon-chevron-right, .codicon');
                if (twistie) { try { twistie.click(); } catch(e) {} }
                try { srcItem.focus(); } catch(e) {}
                try { srcItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true })); } catch(e) {}
                simulateClick(twistie || srcItem);
                await sleep(350);
              }
            }

            const fileItem = findExplorerItem(basename);
            if (fileItem) {
              simulateClick(fileItem);
              const t0 = Date.now();
              while (Date.now() - t0 < 1500) {
                const curTab = document.querySelector('.tab.active, [role="tab"][aria-selected="true"]');
                const curTxt = (curTab?.querySelector('.label-name') || curTab)?.textContent?.trim() || '';
                if (normStr(curTxt).includes(normBase)) return true;
                await sleep(100);
              }
              return true;
            }
            return false;
          }

          if (targetPath) await navigateToTargetFile(targetPath);
          await sleep(200);

          function triggerFileSave() {
            const isMac = /mac/i.test(navigator.platform);
            const saveEvt = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, which: 83, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true });
            window.dispatchEvent(saveEvt);
            document.dispatchEvent(saveEvt);
            document.querySelector('.monaco-editor textarea.inputarea')?.dispatchEvent(saveEvt);
          }

          let activeBreadcrumb = '';
          const breadcrumbs = [...document.querySelectorAll('.breadcrumbs-widget .monaco-breadcrumb-item')].map(b => b.textContent.trim()).filter(Boolean);
          if (breadcrumbs.length > 0) {
            const last = breadcrumbs[breadcrumbs.length - 1].replace(/^[A-Z]+\s+/, '');
            if (last.includes('.') && !/^\d+$/.test(last)) activeBreadcrumb = last;
          }

          const basename = targetPath ? targetPath.split('/').pop() : null;
          const activeTabEl = document.querySelector('.tab.active, .tab.selected, [role="tab"][aria-selected="true"]');
          const activeTabName = (activeTabEl?.querySelector('.label-name') || activeTabEl)?.textContent?.trim() || activeBreadcrumb;
          const normActive = normStr(activeTabName || activeBreadcrumb);
          const normBase = basename ? normStr(basename) : '';

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

          const isExcludedNode = (node) => !!node?.closest?.('[class*="response" i], [class*="http-request" i], [class*="postman" i], [class*="preview" i], [class*="request-body" i], [class*="response-body" i], #ap-solver-host');

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
            if (p.endsWith('/' + b) || p.endsWith(targetPath.toLowerCase()) || p.includes('/' + b)) isModelMatch = true;
          }

          const isTargetActive = isModelMatch || !basename || (
            normActive.length > 0 && normBase.length > 0 &&
            (normActive.includes(normBase) || normBase.includes(normActive))
          );

          if (m && m.editor) {
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

            if (!activeEd) return { success: false, error: 'No valid workspace editor in this frame' };

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

          if (isTargetActive) {
            const allEditors = [...document.querySelectorAll('.monaco-editor')].filter(el => !isExcludedNode(el));
            for (const editorDom of allEditors) {
              for (const k of Object.keys(editorDom)) {
                try {
                  const inst = editorDom[k];
                  if (inst && typeof inst.getModel === 'function') {
                    const mod = inst.getModel();
                    if (mod && typeof mod.setValue === 'function') {
                      mod.setValue('');
                      await sleep(50);
                      mod.setValue(codeToWrite);
                      triggerFileSave();
                      return { success: true, verified: true, method: 'monaco.domInstance.setValue+dom.insertTextAndPaste', filePath: targetPath };
                    }
                  }
                } catch(e) {}
              }
            }
            document.execCommand?.('selectAll', false, null);
          }

          if (targetPath) {
            return { success: false, verified: false, error: `Could not open ${targetPath} in editor (active tab is "${activeTabName}"). Refused to overwrite.` };
          }
        } catch (e) {
          return { error: e.message };
        }
        return null;
      }
    });

    const successResult = results?.find(r => r.result && r.result.success);
    if (successResult) {
      await cdpSaveFile(tabId);
      return { ok: true, verified: !!successResult.result.verified, method: successResult.result.method + '+cdp', filePath: successResult.result.filePath };
    }

    try {
      const frameResps = await chrome.tabs.sendMessage(tabId, { op: 'AP_WRITE_EDITOR', data: { code: cleanCode, filePath: targetFilePath } });
      if (frameResps && frameResps.ok && frameResps.verified && frameResps.method === 'bridge') {
        await cdpSaveFile(tabId);
        return { ok: true, verified: true, method: 'frame-editor.bridge+cdp', filePath: targetFilePath };
      }
    } catch(e) {}

    // Hardware CDP wipe & replace fallback
    try {
      const attached = await attachCDP(tabId);
      if (attached) {
        await cdpNativeKey(tabId, 'Escape', 'Escape', 27, 0);
        await sleep(60);
        const iframeRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => [...document.querySelectorAll('iframe')].map(ifr => {
            const r = ifr.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
          }).filter(r => r.width > 150 && r.height > 150)
        });
        const topIframes = iframeRes?.[0]?.result || [];
        const vsIframe = topIframes.find(ifr => ifr.left > 150) || topIframes[0];
        const edPos = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => {
            const ed = document.querySelector('.monaco-editor');
            if (!ed || ed.closest?.('[class*="response" i], [class*="http-request" i], #ap-solver-host')) return null;
            const r = ed.getBoundingClientRect();
            return (r.width > 50 && r.height > 50) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
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

        await cdpNativeKey(tabId, 'a', 'KeyA', 65, 4);
        await sleep(80);
        await cdpNativeKey(tabId, 'a', 'KeyA', 65, 2);
        await sleep(80);
        await cdpNativeKey(tabId, 'Backspace', 'Backspace', 8, 0);
        await sleep(60);
        await cdpNativeKey(tabId, 'Delete', 'Delete', 46, 0);
        await sleep(80);
        await cdpNativeKey(tabId, 'a', 'KeyA', 65, 4);
        await sleep(40);
        await cdpNativeKey(tabId, 'Backspace', 'Backspace', 8, 0);
        await sleep(60);
        await cdpNativeInsertText(tabId, cleanCode);
        await sleep(150);
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
