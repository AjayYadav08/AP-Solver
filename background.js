// background.js - AP-Solver MV3 Service Worker Entry & Message Router
import {
  generateSolution,
  getSettings,
  saveSettings,
  buildBase64TerminalScript,
  analyzeFileModificationPlan,
  enforceFilePlan,
  buildQuestionStorageKey,
  analyzePreCodingTerminal,
  summarizeCodeChanges,
  buildAttemptRecord,
  formatFullCollaborationHistory,
  loadQuestionAttemptHistory,
  saveQuestionAttemptHistory,
  buildLocalTestSpec
} from './utils/llm.js';
import { queryEditorInTab, writeEditorInTab } from './background/editor.js';
import { writeFilesViaTerminal, readIntegratedTerminalText } from './background/terminal.js';
import { probeWorkspaceViaTerminal, runLocalTestsViaTerminal, runTerminalCommandsViaTerminal } from './background/workspace.js';

export { buildBase64TerminalScript, analyzeFileModificationPlan, enforceFilePlan, analyzePreCodingTerminal, buildLocalTestSpec };

console.log('[AP-Solver] Background service worker initialized.');

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AP-Solver] Installed/Updated:', details.reason);
  const current = await getSettings();
  if (!current.provider) {
    await saveSettings({ provider: 'race' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { op, data } = message;

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
      } else if (op === 'AP_BUILD_FILE_PLAN') {
        const plan = analyzeFileModificationPlan(data || {});
        sendResponse({ ok: true, plan });
      } else if (op === 'AP_ENFORCE_FILE_PLAN') {
        const verified = enforceFilePlan(data?.files || [], data?.filePlan || null);
        sendResponse({ ok: true, ...verified });
      } else if (op === 'AP_ANALYZE_TERMINAL') {
        const analysis = analyzePreCodingTerminal(data || {});
        sendResponse({ ok: true, analysis });
      } else if (op === 'AP_READ_INTEGRATED_TERMINAL') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        const text = await readIntegratedTerminalText(tabId);
        sendResponse({ ok: true, text: text || '' });
      } else if (op === 'AP_LOAD_ATTEMPT_HISTORY') {
        const key = buildQuestionStorageKey(data?.url || sender.tab?.url || '', data?.questionTitle || '');
        const history = await loadQuestionAttemptHistory(key);
        const priorCollab = (history && !history.solved && Array.isArray(history.attempts) && history.attempts.length > 0)
          ? formatFullCollaborationHistory(history.attempts, { maxTotalChars: 6000 })
          : '';
        sendResponse({ ok: true, questionKey: key, history, priorCollab });
      } else if (op === 'AP_RECORD_ATTEMPT') {
        const { questionKey, existingRecords = [], ...recArgs } = data || {};
        const key = questionKey || buildQuestionStorageKey(sender.tab?.url || '', recArgs.questionTitle || '');
        const records = [...(Array.isArray(existingRecords) ? existingRecords : [])];
        if (records.length > 0 && recArgs.submittedFiles) {
          const prev = records[records.length - 1];
          records[records.length - 1] = {
            ...prev,
            whatChangedNext: summarizeCodeChanges(prev.submittedFiles, recArgs.submittedFiles)
          };
        }
        const rec = buildAttemptRecord(recArgs);
        records.push(rec);
        await saveQuestionAttemptHistory(key, {
          questionTitle: recArgs.questionTitle,
          originalQuestion: recArgs.originalQuestion,
          solved: rec.errorCategory === 'PASSED',
          attempts: records
        });
        sendResponse({
          ok: true,
          questionKey: key,
          record: rec,
          records,
          collaborationHistory: formatFullCollaborationHistory(records, { maxTotalChars: 14000 })
        });
      } else if (op === 'AP_SAVE_ATTEMPT_HISTORY') {
        const ok = await saveQuestionAttemptHistory(data?.questionKey, data?.payload);
        sendResponse({ ok });
      } else if (op === 'AP_QUERY_EDITOR') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        sendResponse(await queryEditorInTab(tabId));
      } else if (op === 'AP_PROBE_WORKSPACE') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        sendResponse(await probeWorkspaceViaTerminal(tabId));
      } else if (op === 'AP_RUN_LOCAL_TESTS') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        sendResponse(await runLocalTestsViaTerminal(tabId, data || []));
      } else if (op === 'AP_RUN_TERMINAL_COMMANDS') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        sendResponse(await runTerminalCommandsViaTerminal(tabId, data?.commands || []));
      } else if (op === 'AP_WRITE_EDITOR') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        sendResponse(await writeEditorInTab(tabId, data.code, data.filePath));
      } else if (op === 'AP_WRITE_TERMINAL') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
        sendResponse(await writeFilesViaTerminal(tabId, data.files, data.script, data.postCommands || []));
      } else if (op === 'AP_CLEAN_EDITOR_ARTIFACTS') {
        const tabId = sender.tab?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No tab ID found in sender.' });
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

  return true;
});
