// utils/attempt-history.js - Pre-coding terminal analyzer, categorized error classifier, persistent per-question attempt log & AI-to-AI handoff formatter

const HISTORY_STORAGE_PREFIX = 'ap_attempt_history_v1:';
const MAX_STORED_ATTEMPTS = 25;

/** Build a stable per-question storage key from URL slug and title. */
export function buildQuestionStorageKey(questionUrl = '', questionTitle = '') {
  const cleanUrl = String(questionUrl || '').split(/[?#]/)[0].replace(/\/+$/, '');
  const slug = cleanUrl.split('/').filter(Boolean).slice(-2).join('_').replace(/[^a-zA-Z0-9_-]/g, '');
  const titleKey = String(questionTitle || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48);
  return `${HISTORY_STORAGE_PREFIX}${slug || titleKey || 'default_problem'}`;
}

/** Classify terminal/submission failures strictly into compilation, runtime, assertion, or harness categories. */
export function classifyFailureCategory(terminalOutput = '', subRes = null) {
  const txt = `${terminalOutput || ''} ${(subRes?.failedTests || []).join(' ')} ${(subRes?.tests || []).map(t => t.error || '').join(' ')}`;
  if (subRes?.ok === true) {
    return { category: 'PASSED', label: 'Passed All Tests', guidance: 'All test assertions passed.' };
  }
  if (/SyntaxError|Unexpected token|Cannot use import statement outside a module|TS\d{4}:|error TS|Compilation failed|Build failed|ParseError/i.test(txt)) {
    return {
      category: 'COMPILATION_ERROR',
      label: 'Compilation / Syntax / Module Error',
      guidance: 'Fix syntax, module format (CommonJS require vs ESM import matching package.json type), or TypeScript/build issues first.'
    };
  }
  if (/Cannot find module|MODULE_NOT_FOUND|TypeError:|ReferenceError:|RangeError:|PrismaClient\w*Error|UnhandledPromiseRejection|Uncaught\b|did not initialize/i.test(txt)) {
    return {
      category: 'RUNTIME_ERROR',
      label: 'Runtime / Exception / Dependency Error',
      guidance: 'Fix thrown runtime exceptions, missing installed package imports, null/undefined accesses, or uninitialized Prisma/DB clients.'
    };
  }
  if (/ECONNREFUSED|EADDRINUSE|ETIMEDOUT|timeout of \d+ms exceeded|Async callback was not invoked|Command failed|No test files found|non-zero exit code|Submission Blocked/i.test(txt)) {
    return {
      category: 'SUBMISSION_FAILURE',
      label: 'Submission / Harness / Server Startup Failure',
      guidance: 'Fix server port binding (process.env.PORT), async response termination on every branch, missing post-write setup commands, or entrypoint exports.'
    };
  }
  return {
    category: 'INCORRECT_OUTPUT',
    label: 'Incorrect Output / Assertion Mismatch',
    guidance: 'Inspect expected vs actual values, HTTP status codes, JSON property keys, math rounding, edge cases, and requirement wording verbatim.'
  };
}

/**
 * Analyze initial side/integrated terminal output, README, package.json & question text BEFORE coding Attempt 1.
 * Surfaces existing errors, execution/build rules, and whether extra post-write commands are needed before Submit.
 */
export function analyzePreCodingTerminal({
  sideTerminalText = '',
  integratedTerminalText = '',
  questionDetails = '',
  readmeText = '',
  packageJsonStr = '',
  detectedPostCommands = []
} = {}) {
  const combinedTerm = [sideTerminalText, integratedTerminalText].filter(Boolean).join('\n').trim();
  const combinedInstructions = `${questionDetails || ''}\n${readmeText || ''}\n${combinedTerm}`;

  let pkg = {};
  try { if (packageJsonStr) pkg = JSON.parse(packageJsonStr); } catch (e) {}
  const scripts = pkg.scripts || {};

  const extraCommandReasons = [];
  if (scripts.build) extraCommandReasons.push(`package.json defines "build": "${scripts.build}"`);
  if (scripts.migrate) extraCommandReasons.push(`package.json defines "migrate": "${scripts.migrate}"`);
  if (scripts.seed) extraCommandReasons.push(`package.json defines "seed": "${scripts.seed}"`);
  if (/prisma|@prisma\/client/i.test(JSON.stringify(pkg) + combinedInstructions)) {
    extraCommandReasons.push('Prisma detected: schema push / client generate / seed workflow may be required after file edits');
  }

  // Extract explicit CLI/terminal run commands mentioned in README or terminal hints
  const discoveredCmds = [...new Set(detectedPostCommands || [])];
  for (const m of combinedInstructions.matchAll(/`((?:npm\s+run\s+(?:build|seed|migrate|setup|prepare|db:[a-z0-9:_-]+)|npm\s+(?:ci|install[^`]*)|npx\s+(?:prisma|tsc)[^`]*|node\s+(?:src\/)?(?:seed|setup|init|migrate)[^`]*))`/gi)) {
    const c = m[1].trim();
    if (c && !discoveredCmds.includes(c)) discoveredCmds.push(c);
  }

  // Check if terminal already contains a previous error trace before this run starts
  const hasPriorFailure = /AssertionError|\d+\s+failing|SyntaxError|TypeError|ReferenceError|Cannot find module|ECONNREFUSED|PrismaClient\w*Error|Error:/i.test(combinedTerm);
  const preClassification = hasPriorFailure
    ? classifyFailureCategory(combinedTerm, { ok: false })
    : { category: 'NONE', label: 'Clean Initial Terminal', guidance: '' };

  const submissionNotes = [];
  if (/git\s+commit|git\s+push/i.test(combinedInstructions)) {
    submissionNotes.push('Git-backed grading workflow detected (workspace changes are auto-staged & committed cleanly after terminal write).');
  }
  if (/NODE_ENV|PORT\s*=/.test(combinedInstructions)) {
    submissionNotes.push('Inspect environment/PORT rules carefully before writing server entrypoint.');
  }

  return {
    requiresPostWriteCommands: discoveredCmds.length > 0 || extraCommandReasons.length > 0,
    requiredPostCommands: discoveredCmds,
    commandReasons: extraCommandReasons,
    submissionNotes,
    hasPriorTerminalErrors: hasPriorFailure,
    preErrorCategory: preClassification.category,
    preErrorSummary: hasPriorFailure ? combinedTerm.slice(-1800) : ''
  };
}

/** Summarize concrete file changes between two consecutive attempt snapshots (`whatChangedNext`). */
export function summarizeCodeChanges(prevFiles = [], nextFiles = []) {
  const prevMap = new Map((prevFiles || []).filter(f => f?.filePath).map(f => [f.filePath, f.code || '']));
  const nextMap = new Map((nextFiles || []).filter(f => f?.filePath).map(f => [f.filePath, f.code || '']));
  const changes = [];

  for (const [fp, code] of nextMap.entries()) {
    if (!prevMap.has(fp)) {
      changes.push(`+ Created ${fp} (${code.split('\n').length} lines)`);
    } else {
      const oldCode = prevMap.get(fp);
      if (oldCode.trim() === code.trim()) {
        changes.push(`= Kept ${fp} unchanged`);
      } else {
        const oldLines = oldCode.split('\n').length;
        const newLines = code.split('\n').length;
        const delta = newLines - oldLines;
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
        changes.push(`~ Modified ${fp} (${oldLines}->${newLines} lines, ${deltaStr})`);
      }
    }
  }
  for (const fp of prevMap.keys()) {
    if (!nextMap.has(fp)) changes.push(`- Dropped ${fp}`);
  }
  return changes.join('; ') || 'Refined implementation';
}

/** Normalize compact structured local pre-test telemetry for storage & AI debugging. */
function normalizeLocalTestLogs(localTestResult) {
  if (!localTestResult || typeof localTestResult !== 'object') return null;
  return {
    strategy: localTestResult.strategy || '',
    status: localTestResult.status || '',
    passed: localTestResult.passed ?? 0,
    failed: localTestResult.failed ?? 0,
    executedCommands: [...new Set((localTestResult.executedCommands || []).filter(Boolean))].slice(0, 8),
    compileResult: localTestResult.compileResult ? {
      ok: !!localTestResult.compileResult.ok,
      command: String(localTestResult.compileResult.command || '').slice(0, 140),
      output: String(localTestResult.compileResult.output || '').slice(-400)
    } : null,
    runtimeResult: localTestResult.runtimeResult ? {
      ok: !!localTestResult.runtimeResult.ok,
      command: String(localTestResult.runtimeResult.command || '').slice(0, 140),
      output: String(localTestResult.runtimeResult.output || '').slice(-600)
    } : null,
    cases: Array.isArray(localTestResult.cases)
      ? localTestResult.cases.slice(0, 12).map(c => ({
          name: String(c?.name || '').slice(0, 90),
          input: String(c?.input || '').slice(0, 120),
          expected: String(c?.expected || '').slice(0, 120),
          actual: String(c?.actual || '').slice(0, 160),
          ok: !!c?.ok
        }))
      : [],
    output: String(localTestResult.output || '').slice(-2500)
  };
}

/** Create a complete structured record for an evaluation attempt. */
export function buildAttemptRecord({
  attemptNumber = 1,
  stage = 'remote',
  questionTitle = '',
  submittedFiles = [],
  terminalOutput = '',
  subRes = null,
  commandsExecuted = [],
  localTestResult = null,
  whatWentWrong = '',
  strategyUsed = ''
} = {}) {
  const cls = classifyFailureCategory(terminalOutput, subRes);
  const compactTerm = String(terminalOutput || '').replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();
  const localTestLogs = normalizeLocalTestLogs(localTestResult);

  // Merge failed test names with per-test error strings from Tab 2/Tab 3 so no detail is lost
  const mergedFailedTests = [];
  const seenFail = new Set();
  const pushFail = (line) => {
    const s = String(line || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (!seenFail.has(key)) {
      seenFail.add(key);
      mergedFailedTests.push(s);
    }
  };
  if (Array.isArray(subRes?.tests)) {
    for (const t of subRes.tests) {
      if (t && (t.fail || (!t.pass && (subRes.failedCount > 0 || (subRes.totalCount || 0) > (subRes.passedCount ?? subRes.passed ?? 0))))) {
        pushFail(t.error ? `${t.name} => ${t.error}` : t.name);
      }
    }
  }
  for (const ft of (subRes?.failedTests || [])) {
    if (![...seenFail].some(k => k.startsWith(String(ft || '').toLowerCase()))) {
      pushFail(ft);
    }
  }

  return {
    attemptNumber,
    timestamp: subRes?.timestamp || new Date().toLocaleTimeString(),
    stage,
    questionTitle,
    errorCategory: cls.category,
    errorCategoryLabel: cls.label,
    categoryGuidance: cls.guidance,
    passed: subRes?.passed ?? 0,
    total: subRes?.total ?? 0,
    failedTests: mergedFailedTests,
    submittedFiles: (submittedFiles || []).map(f => ({
      filePath: f.filePath,
      code: f.code || ''
    })),
    commandsExecuted: [...new Set((commandsExecuted || []).filter(Boolean))],
    localTestLogs,
    terminalOutput: compactTerm.slice(-14000),
    whatWentWrong: whatWentWrong || `${cls.label}: ${subRes?.passed ?? 0}/${subRes?.total ?? 0} passed`,
    whatChangedNext: '',
    strategyUsed: strategyUsed || `Attempt ${attemptNumber}`
  };
}

/**
 * Format the chronological cumulative attempt history so Attempts 2..5
 * ALWAYS receive the COMPLETE code of EVERY prior attempt alongside its full errors & commands.
 * Never drops previous attempts' file source code.
 */
export function formatFullCollaborationHistory(records = [], { maxTotalChars = 90000 } = {}) {
  if (!Array.isArray(records) || records.length === 0) return '';

  const formatRecord = (r, idx, termBudget) => {
    const cmdsStr = (r.commandsExecuted && r.commandsExecuted.length > 0)
      ? r.commandsExecuted.join(' && ')
      : 'None required';
    const failList = (r.failedTests && r.failedTests.length > 0)
      ? '\n  ' + r.failedTests.map(ft => `• ❌ ${ft}`).join('\n  ')
      : ' See terminal trace below';

    const codeSnippets = (r.submittedFiles || []).map(f => {
      const c = (f.code || '').trim();
      return `#### Attempt ${r.attemptNumber} Complete Code — \`${f.filePath}\` (${c.split('\n').length} lines):\n\`\`\`\n${c}\n\`\`\``;
    }).join('\n\n');

    const rawTerm = (r.terminalOutput || '').trim();
    const cleanedTermLines = rawTerm
      .split('\n')
      .filter(l => !/^\s*at\s+.*(?:node_modules\/|node:internal\/)/.test(l))
      .join('\n');
    const termSnippet = cleanedTermLines
      ? (cleanedTermLines.length > termBudget ? cleanedTermLines.slice(-termBudget) : cleanedTermLines)
      : '(no terminal error output captured)';

    let localSummaryBlock = '';
    const lt = r.localTestLogs;
    if (lt && lt.status) {
      const ltCmds = (lt.executedCommands || []).join(' && ') || 'None';
      const caseLines = (lt.cases || []).map(c =>
        `  - [${c.ok ? 'PASS' : 'FAIL'}] ${c.name} | in: ${c.input || '-'} | expected: ${c.expected || '-'} | actual: ${c.actual || '-'}`
      );
      localSummaryBlock = [
        `- Local Pre-Test: strategy=${lt.strategy || 'auto'}, status=${lt.status} (${lt.passed} passed, ${lt.failed} failed)`,
        `- Local Test Commands: ${ltCmds}`,
        lt.compileResult ? `- Compile Check: ${lt.compileResult.ok ? 'PASS' : 'FAIL'} (${lt.compileResult.command || 'syntax'})` : '',
        lt.runtimeResult ? `- Runtime Check: ${lt.runtimeResult.ok ? 'PASS' : 'FAIL'} (${lt.runtimeResult.command || 'runtime'})` : '',
        caseLines.length ? `- Local Test Cases:\n${caseLines.join('\n')}` : ''
      ].filter(Boolean).join('\n');
    }

    const stageTag = String(r.stage || 'remote').toUpperCase();
    const entryLines = [
      `### ATTEMPT ${r.attemptNumber} [${stageTag}] — ${r.errorCategoryLabel || r.errorCategory} (${r.passed}/${r.total} passed at ${r.timestamp})`,
      `- Strategy: ${r.strategyUsed}`,
      `- Terminal Commands Executed: ${cmdsStr}`,
      localSummaryBlock,
      `- Failed Tests / Errors:${failList}`,
      `- Root Cause / Diagnosis: ${r.whatWentWrong}`,
      r.whatChangedNext ? `- What Changed in Next Attempt: ${r.whatChangedNext}` : '',
      `- Full Terminal Output & Error Trace (Attempt ${r.attemptNumber}):\n\`\`\`\n${termSnippet}\n\`\`\``,
      codeSnippets
    ].filter(Boolean);

    return entryLines.join('\n');
  };

  let termBudget = 6000;
  let blocks = records.map((r, i) => formatRecord(r, i, i === records.length - 1 ? 8000 : termBudget));
  let out = blocks.join('\n\n---\n\n');

  // If massive terminal logs across 5 attempts exceed maxTotalChars, shrink ONLY raw log excerpts first — preserve ALL file source code intact
  if (out.length > maxTotalChars) {
    termBudget = 2200;
    blocks = records.map((r, i) => formatRecord(r, i, i === records.length - 1 ? 4500 : termBudget));
    out = blocks.join('\n\n---\n\n');
  }
  if (out.length > maxTotalChars) {
    termBudget = 900;
    blocks = records.map((r, i) => formatRecord(r, i, i === records.length - 1 ? 2500 : termBudget));
    out = blocks.join('\n\n---\n\n');
  }
  return out;
}

/** Load persisted attempt history for a specific question from chrome.storage.local. */
export async function loadQuestionAttemptHistory(questionKey) {
  if (!questionKey || typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const res = await chrome.storage.local.get([questionKey]);
    return res?.[questionKey] || null;
  } catch (e) {
    return null;
  }
}

/** Save updated attempt history cleanly for an individual question (preserving all 5 attempts & pre-checks). */
export async function saveQuestionAttemptHistory(questionKey, payload) {
  if (!questionKey || typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try {
    const incoming = Array.isArray(payload?.attempts) ? payload.attempts : [];
    const remoteAttempts = incoming.filter(r => !String(r?.stage || '').startsWith('local-'));
    const localAttempts = incoming.filter(r => String(r?.stage || '').startsWith('local-'));
    // Always preserve ALL remote attempts 1..5 cleanly without eviction by local pre-test retries
    const trimmedLocals = localAttempts.slice(-Math.max(5, MAX_STORED_ATTEMPTS - remoteAttempts.length));
    const localSet = new Set(trimmedLocals);
    const preserved = incoming.filter(r => !String(r?.stage || '').startsWith('local-') || localSet.has(r));

    const record = {
      questionTitle: payload?.questionTitle || '',
      originalQuestion: String(payload?.originalQuestion || '').slice(0, 24000),
      updatedAt: Date.now(),
      solved: !!payload?.solved,
      attempts: preserved
    };
    await chrome.storage.local.set({ [questionKey]: record });
    return true;
  } catch (e) {
    return false;
  }
}
