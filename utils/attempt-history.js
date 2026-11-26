// utils/attempt-history.js - Pre-coding terminal analyzer, categorized error classifier, persistent per-question attempt log & AI-to-AI handoff formatter

const HISTORY_STORAGE_PREFIX = 'ap_attempt_history_v1:';
const MAX_STORED_ATTEMPTS = 5;

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

/** Create a complete structured record for an evaluation attempt. */
export function buildAttemptRecord({
  attemptNumber = 1,
  stage = 'remote',
  questionTitle = '',
  submittedFiles = [],
  terminalOutput = '',
  subRes = null,
  commandsExecuted = [],
  whatWentWrong = '',
  strategyUsed = ''
} = {}) {
  const cls = classifyFailureCategory(terminalOutput, subRes);
  const compactTerm = String(terminalOutput || '').replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();
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
    failedTests: [...(subRes?.failedTests || [])],
    submittedFiles: (submittedFiles || []).map(f => ({
      filePath: f.filePath,
      code: f.code || ''
    })),
    commandsExecuted: [...new Set((commandsExecuted || []).filter(Boolean))],
    terminalOutput: compactTerm.slice(-6000),
    whatWentWrong: whatWentWrong || `${cls.label}: ${subRes?.passed ?? 0}/${subRes?.total ?? 0} passed`,
    whatChangedNext: '',
    strategyUsed: strategyUsed || `Attempt ${attemptNumber}`
  };
}

/**
 * Format the chronological AI-to-AI attempt history so later agents (especially Attempt 3+)
 * see original question context reminder, submitted code per attempt, errors, commands, and deltas.
 */
export function formatFullCollaborationHistory(records = [], { maxTotalChars = 14000 } = {}) {
  if (!Array.isArray(records) || records.length === 0) return '';

  const blocks = [];
  const totalCount = records.length;
  for (let i = 0; i < totalCount; i++) {
    const r = records[i];
    const isLatest = i === totalCount - 1;
    const cmdsStr = (r.commandsExecuted && r.commandsExecuted.length > 0)
      ? r.commandsExecuted.join(' && ')
      : 'None required';
    const failList = (r.failedTests && r.failedTests.length > 0)
      ? r.failedTests.slice(0, 6).join(', ')
      : 'See terminal trace';

    // Include complete code snapshots for prior attempts when budget permits (always full on recent attempts)
    const codeBudgetPerFile = isLatest ? 3500 : (totalCount <= 3 ? 2200 : 1200);
    const codeSnippets = (r.submittedFiles || []).map(f => {
      const c = (f.code || '').trim();
      const body = c.length > codeBudgetPerFile ? c.slice(0, codeBudgetPerFile) + '\n// ... (truncated)' : c;
      return `#### Attempt ${r.attemptNumber} Code — \`${f.filePath}\`:\n\`\`\`\n${body}\n\`\`\``;
    }).join('\n');

    const termSnippet = (r.terminalOutput || '').slice(isLatest ? -2500 : -900) || '(no terminal trace captured)';

    const entryLines = [
      `### ATTEMPT ${r.attemptNumber} [${r.stage.toUpperCase()}] — ${r.errorCategoryLabel || r.errorCategory} (${r.passed}/${r.total} passed at ${r.timestamp})`,
      `- Strategy: ${r.strategyUsed}`,
      `- Post-Write Commands Executed: ${cmdsStr}`,
      `- Failed Tests: ${failList}`,
      `- Root Cause / What Went Wrong: ${r.whatWentWrong}`,
      r.whatChangedNext ? `- What Changed in Next Attempt: ${r.whatChangedNext}` : '',
      `- Terminal Error Snippet:\n\`\`\`\n${termSnippet}\n\`\`\``,
      codeSnippets
    ].filter(Boolean);

    blocks.push(entryLines.join('\n'));
  }

  let out = blocks.join('\n\n---\n\n');
  if (out.length > maxTotalChars) {
    // Preserve full latest attempt and compact summaries of oldest attempts first
    const compactOlder = records.slice(0, -1).map(r => (
      `### ATTEMPT ${r.attemptNumber} [${r.errorCategoryLabel || r.errorCategory} | ${r.passed}/${r.total} passed]\n` +
      `- Commands: ${(r.commandsExecuted || []).join(' && ') || 'None'}\n` +
      `- What Went Wrong: ${r.whatWentWrong}\n` +
      (r.whatChangedNext ? `- Change Applied Next: ${r.whatChangedNext}\n` : '') +
      `- Error Excerpt: ${(r.terminalOutput || '').slice(-400).replace(/\s+/g, ' ')}\n` +
      `- Submitted Files: ${(r.submittedFiles || []).map(f => `${f.filePath}(${(f.code || '').split('\n').length}L)`).join(', ')}`
    )).join('\n\n');
    const combined = compactOlder + '\n\n---\n\n' + blocks[blocks.length - 1];
    out = combined.length > maxTotalChars ? combined.slice(-maxTotalChars) : combined;
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

/** Save updated attempt history cleanly for an individual question (capped at 5 attempts). */
export async function saveQuestionAttemptHistory(questionKey, payload) {
  if (!questionKey || typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try {
    const record = {
      questionTitle: payload?.questionTitle || '',
      originalQuestion: String(payload?.originalQuestion || '').slice(0, 12000),
      updatedAt: Date.now(),
      solved: !!payload?.solved,
      attempts: Array.isArray(payload?.attempts) ? payload.attempts.slice(-MAX_STORED_ATTEMPTS) : []
    };
    await chrome.storage.local.set({ [questionKey]: record });
    return true;
  } catch (e) {
    return false;
  }
}
