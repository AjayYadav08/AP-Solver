// utils/orchestrator.js - Situation-aware dynamic multi-model orchestration, key validation & health telemetry

export const OPENAI_COMPAT_PRESETS = {
  nvidia_nim: {
    label: 'NVIDIA NIM (DeepSeek / Nemotron — Free Credits)',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'deepseek-ai/deepseek-v3.2',
    keyPrefix: 'nvapi-',
    signupUrl: 'https://build.nvidia.com'
  },
  openrouter_free: {
    label: 'OpenRouter (:free Multi-Model Router)',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    keyPrefix: 'sk-or-',
    signupUrl: 'https://openrouter.ai/keys'
  },
  openai: {
    label: 'OpenAI Official',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    keyPrefix: 'sk-',
    signupUrl: 'https://platform.openai.com/api-keys'
  }
};

export const PROVIDER_CAPABILITIES = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    maxContextTokens: 1000000,
    safePromptBudget: 180000,
    reasoningStrength: 94,
    codeStrength: 91,
    multiFileStrength: 93,
    speedScore: 76,
    quotaSustainability: 84,
    signupUrl: 'https://aistudio.google.com/apikey'
  },
  groq: {
    id: 'groq',
    label: 'Groq LPU',
    maxContextTokens: 32768,
    safePromptBudget: 6200,
    reasoningStrength: 84,
    codeStrength: 86,
    multiFileStrength: 78,
    speedScore: 98,
    quotaSustainability: 72,
    signupUrl: 'https://console.groq.com/keys'
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras Inference',
    maxContextTokens: 65536,
    safePromptBudget: 16000,
    reasoningStrength: 89,
    codeStrength: 91,
    multiFileStrength: 88,
    speedScore: 99,
    quotaSustainability: 97,
    signupUrl: 'https://cloud.cerebras.ai'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI / NIM / OpenRouter',
    maxContextTokens: 128000,
    safePromptBudget: 64000,
    reasoningStrength: 92,
    codeStrength: 91,
    multiFileStrength: 90,
    speedScore: 74,
    quotaSustainability: 80,
    signupUrl: 'https://openrouter.ai/keys'
  }
};

/** Runtime health & latency telemetry store per provider (in-memory across solves). */
const providerTelemetry = {
  gemini: { successes: 0, failures: 0, consecutiveFailures: 0, totalLatencyMs: 0, avgLatencyMs: 2800, rateLimitedUntil: 0, lastError: '', lastUsedAt: 0 },
  groq: { successes: 0, failures: 0, consecutiveFailures: 0, totalLatencyMs: 0, avgLatencyMs: 950, rateLimitedUntil: 0, lastError: '', lastUsedAt: 0 },
  cerebras: { successes: 0, failures: 0, consecutiveFailures: 0, totalLatencyMs: 0, avgLatencyMs: 750, rateLimitedUntil: 0, lastError: '', lastUsedAt: 0 },
  openai: { successes: 0, failures: 0, consecutiveFailures: 0, totalLatencyMs: 0, avgLatencyMs: 2400, rateLimitedUntil: 0, lastError: '', lastUsedAt: 0 }
};

/** Validate API key format cleanly without rejecting valid custom provider keys. */
export function validateApiKeyFormat(provider, rawKey = '') {
  const key = String(rawKey || '').trim();
  if (!key) {
    return { valid: false, level: 'empty', message: `${provider} key is empty.` };
  }
  if (/\s/.test(key) || key.length < 14) {
    return { valid: false, level: 'invalid', message: `${provider} key appears too short or contains spaces.` };
  }
  if (provider === 'gemini' && !/^AIza/i.test(key)) {
    return { valid: true, level: 'warn', message: 'Gemini keys usually start with "AIza..."' };
  }
  if (provider === 'groq' && !/^gsk_/i.test(key)) {
    return { valid: true, level: 'warn', message: 'Groq keys usually start with "gsk_..."' };
  }
  if (provider === 'cerebras' && !/^csk-/i.test(key)) {
    return { valid: true, level: 'warn', message: 'Cerebras keys usually start with "csk-..."' };
  }
  return { valid: true, level: 'ok', message: 'Key format valid' };
}

/** Return list of configured provider IDs from user settings. */
export function getConfiguredProviders(settings = {}) {
  const configured = [];
  if (String(settings.geminiKey || '').trim()) configured.push('gemini');
  if (String(settings.groqKey || '').trim()) configured.push('groq');
  if (String(settings.cerebrasKey || '').trim()) configured.push('cerebras');
  if (String(settings.openaiKey || '').trim()) configured.push('openai');
  return configured;
}

/** Infer effective capability overrides when Custom/OpenAI points to NVIDIA NIM or OpenRouter. */
export function resolveEffectiveCapabilities(providerId, settings = {}) {
  const base = { ...(PROVIDER_CAPABILITIES[providerId] || PROVIDER_CAPABILITIES.openai) };
  if (providerId === 'openai') {
    const url = String(settings.openaiBaseUrl || '').toLowerCase();
    const model = String(settings.openaiModel || '').toLowerCase();
    if (url.includes('nvidia.com')) {
      base.label = 'NVIDIA NIM';
      base.maxContextTokens = 256000;
      base.reasoningStrength = /deepseek|nemotron/i.test(model) ? 95 : 90;
      base.codeStrength = 93;
      base.speedScore = 80;
    } else if (url.includes('openrouter.ai')) {
      base.label = 'OpenRouter';
      base.maxContextTokens = 200000;
      base.reasoningStrength = /deepseek|qwen|nemotron|claude/i.test(model) ? 94 : 89;
      base.codeStrength = 92;
      base.quotaSustainability = 78;
    }
  }
  return base;
}

/** Inspect prompt & task metadata to classify complexity, context weight, and reasoning depth. */
export function analyzeTaskProfile(promptData = {}, promptStr = '', settings = {}) {
  const title = String(promptData?.questionTitle || '');
  const details = String(promptData?.questionDetails || '');
  const collab = String(promptData?.collaborationHistory || '');
  const attemptNumber = Math.max(1, Number(promptData?.attemptNumber) || (promptData?.feedback ? 2 : 1));
  const isDebug = !!(promptData?.feedback && String(promptData.feedback).trim().length > 0);
  const fileCount = Math.max(1, Number(settings?.filePlan?.filesToModify?.length) || Number(promptData?.workspaceFiles?.length) || 1);
  const estPromptTokens = Math.ceil((String(promptStr || '').length + details.length + collab.length * 0.2) / 3.2);

  let stage = 'code_generation';
  if (/test api connection/i.test(title) || promptData?.isConnectionTest) {
    stage = 'connection_test';
  } else if (isDebug && attemptNumber >= 3) {
    stage = 'collaboration_audit';
  } else if (isDebug && /SyntaxError|Cannot find module/i.test(String(promptData.feedback || ''))) {
    stage = 'quick_error_fix';
  } else if (isDebug) {
    stage = 'deep_debugging';
  } else if (fileCount >= 3 || /refactor|architecture|prisma|microservice|middleware/i.test(`${title}\n${details}`)) {
    stage = 'multi_file_architecture';
  }

  let complexityScore = 30;
  if (fileCount >= 2) complexityScore += Math.min(25, fileCount * 6);
  if (/prisma|jwt|bcrypt|middleware|mongodb|postgres|transaction|stream|socket|auth|surge|mvc/i.test(`${title}\n${details}`)) {
    complexityScore += 20;
  }
  if (isDebug) complexityScore += 18 + Math.min(20, (attemptNumber - 1) * 7);
  if (estPromptTokens > 5500) complexityScore += 12;
  complexityScore = Math.min(100, complexityScore);

  const needsLargeContext = estPromptTokens > 5500 || collab.length > 2600 || fileCount >= 4;
  const needsDeepReasoning = stage === 'deep_debugging' || stage === 'collaboration_audit' || complexityScore >= 65;
  const preferFastExecution = stage === 'connection_test' || stage === 'quick_error_fix' || (!needsLargeContext && !needsDeepReasoning && attemptNumber === 1);

  return {
    stage,
    attemptNumber,
    isDebug,
    fileCount,
    estPromptTokens,
    complexityScore,
    needsLargeContext,
    needsDeepReasoning,
    preferFastExecution
  };
}

/** Update live provider health and latency statistics after a request succeeds or fails. */
export function recordProviderOutcome(providerId, { ok, latencyMs = 0, status = 0, errorMsg = '', isRateLimit = false } = {}) {
  const t = providerTelemetry[providerId];
  if (!t) return;
  const now = Date.now();
  t.lastUsedAt = now;

  if (ok) {
    t.successes += 1;
    t.consecutiveFailures = 0;
    t.rateLimitedUntil = 0;
    t.lastError = '';
    if (latencyMs > 0) {
      t.totalLatencyMs += latencyMs;
      t.avgLatencyMs = t.successes === 1
        ? latencyMs
        : Math.round(t.avgLatencyMs * 0.65 + latencyMs * 0.35);
    }
    return;
  }

  t.failures += 1;
  t.consecutiveFailures += 1;
  t.lastError = String(errorMsg || '').slice(0, 180);

  const isDailyLimit = /TPD|tokens per day|daily limit/i.test(t.lastError);
  if (status === 429 || isRateLimit || /rate limit|TPM|RPM|quota/i.test(t.lastError)) {
    const cooldownMs = isDailyLimit ? 180000 : 25000;
    t.rateLimitedUntil = Math.max(t.rateLimitedUntil, now + cooldownMs);
  } else if (status === 401 || status === 403 || /invalid api key|unauthorized/i.test(t.lastError)) {
    t.rateLimitedUntil = Math.max(t.rateLimitedUntil, now + 120000);
  }
}

export function getProviderTelemetrySnapshot() {
  const copy = {};
  for (const [k, v] of Object.entries(providerTelemetry)) {
    copy[k] = { ...v };
  }
  return copy;
}

export function resetProviderTelemetry() {
  for (const k of Object.keys(providerTelemetry)) {
    providerTelemetry[k] = {
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      totalLatencyMs: 0,
      avgLatencyMs: k === 'cerebras' ? 750 : k === 'groq' ? 950 : k === 'openai' ? 2400 : 2800,
      rateLimitedUntil: 0,
      lastError: '',
      lastUsedAt: 0
    };
  }
}

/**
 * Score a configured provider dynamically for the current task (zero hardcoded fixed priority).
 * Balances task complexity, model capability fit, context budget, speed, quota sustainability,
 * and live session health telemetry.
 */
export function scoreProviderForTask(providerId, taskProfile, settings = {}, telemetryOverride = null) {
  const caps = resolveEffectiveCapabilities(providerId, settings);
  const tel = (telemetryOverride && telemetryOverride[providerId]) || providerTelemetry[providerId] || {
    successes: 0, failures: 0, consecutiveFailures: 0, avgLatencyMs: 1500, rateLimitedUntil: 0
  };
  const now = Date.now();
  const reasons = [];

  // Weighted task fit: shifts dynamically with stage & prompt requirements
  let wReason = 0.28;
  let wCode = 0.30;
  let wMulti = 0.16;
  let wSpeed = 0.14;
  let wQuota = 0.12;

  if (taskProfile.preferFastExecution) {
    wSpeed = 0.34; wQuota = 0.20; wCode = 0.24; wReason = 0.14; wMulti = 0.08;
  } else if (taskProfile.needsDeepReasoning) {
    wReason = 0.38; wCode = 0.28; wMulti = 0.22; wSpeed = 0.05; wQuota = 0.07;
  } else if (taskProfile.stage === 'multi_file_architecture') {
    wMulti = 0.30; wCode = 0.32; wReason = 0.24; wSpeed = 0.06; wQuota = 0.08;
  }

  let score =
    caps.reasoningStrength * wReason +
    caps.codeStrength * wCode +
    caps.multiFileStrength * wMulti +
    caps.speedScore * wSpeed +
    caps.quotaSustainability * wQuota;

  // Context requirement adjustment (avoid choking strict TPM limits on big attempt histories)
  if (taskProfile.estPromptTokens > caps.safePromptBudget) {
    const overflowRatio = Math.min(1, (taskProfile.estPromptTokens - caps.safePromptBudget) / Math.max(1000, caps.safePromptBudget));
    const ctxPenalty = 12 + Math.round(overflowRatio * 20);
    score -= ctxPenalty;
    reasons.push(`-${ctxPenalty} compact-context`);
  } else if (taskProfile.needsLargeContext && caps.safePromptBudget >= 64000) {
    score += 7;
    reasons.push('+7 large-context fit');
  }

  // Live latency & reliability learning
  const totalRuns = tel.successes + tel.failures;
  if (totalRuns > 0) {
    const reliabilityRate = tel.successes / totalRuns;
    score += (reliabilityRate - 0.5) * 14;
  }
  if (tel.avgLatencyMs > 0) {
    if (tel.avgLatencyMs <= 1200) score += 3;
    else if (tel.avgLatencyMs >= 8000) score -= 4;
  }

  // Failure / rate-limit cooldown penalty (automatic load shedding without failing workflow)
  const inCooldown = tel.rateLimitedUntil && tel.rateLimitedUntil > now;
  if (inCooldown) {
    score -= 65;
    reasons.push('-65 cooldown');
  } else if (tel.consecutiveFailures > 0) {
    const failPen = Math.min(45, tel.consecutiveFailures * 18);
    score -= failPen;
    reasons.push(`-${failPen} recent-fail`);
  }

  // If the exact previous attempt already used a provider and tests still failed, slightly diversify on Attempt 3+
  const lastUsedSameModelPenalty = (
    taskProfile.attemptNumber >= 3 &&
    settings?.lastFailedProvider === providerId
  ) ? 6 : 0;
  if (lastUsedSameModelPenalty) {
    score -= lastUsedSameModelPenalty;
    reasons.push(`-${lastUsedSameModelPenalty} diversify-collaborator`);
  }

  if (taskProfile.preferFastExecution && caps.speedScore >= 95) reasons.push('fast-LPU/wafer');
  if (taskProfile.needsDeepReasoning && caps.reasoningStrength >= 90) reasons.push('deep-reasoning');
  if (caps.quotaSustainability >= 95) reasons.push('high-daily-quota');

  return {
    provider: providerId,
    label: caps.label,
    score: Number(score.toFixed(2)),
    inCooldown: !!inCooldown,
    avgLatencyMs: tel.avgLatencyMs,
    reason: reasons.join(', ') || 'balanced-fit'
  };
}

/**
 * Build the complete ordered execution strategy for any combination of configured API keys.
 * Supports explicit user lock (falling back to all other configured models) AND full dynamic
 * `'auto'` / `'race'` orchestration with zero hardcoded fixed priority.
 */
export function planModelOrchestration(promptData = {}, promptStr = '', settings = {}, telemetryOverride = null) {
  const configured = getConfiguredProviders(settings);
  if (configured.length === 0) {
    return { configured: [], ranked: [], executionMode: 'none', taskProfile: null, parallelCandidates: [], fallbackCandidates: [] };
  }

  const taskProfile = analyzeTaskProfile(promptData, promptStr, settings);
  const scored = configured
    .map(p => scoreProviderForTask(p, taskProfile, settings, telemetryOverride))
    .sort((a, b) => b.score - a.score);

  const requestedMode = String(settings.provider || 'auto').trim().toLowerCase();

  // Explicit single-provider selection puts chosen provider first, with dynamic fallbacks across ALL others
  if (requestedMode !== 'auto' && requestedMode !== 'race' && configured.includes(requestedMode)) {
    const preferred = scored.find(s => s.provider === requestedMode);
    const others = scored.filter(s => s.provider !== requestedMode);
    const ordered = [preferred, ...others];
    return {
      configured,
      taskProfile,
      executionMode: 'explicit_with_fallback',
      ranked: ordered,
      parallelCandidates: [],
      fallbackCandidates: ordered
    };
  }

  // Dynamic Orchestrator ('auto' or 'race'): no fixed primary model
  const healthy = scored.filter(s => !s.inCooldown);
  const pool = healthy.length > 0 ? healthy : scored;
  const shouldRaceTopTwo =
    pool.length >= 2 &&
    (requestedMode === 'race' || (taskProfile.preferFastExecution && (pool[0].score - pool[1].score) <= 10)) &&
    !taskProfile.isConnectionTest;

  const parallelCandidates = shouldRaceTopTwo ? [pool[0], pool[1]] : [];
  const parallelSet = new Set(parallelCandidates.map(c => c.provider));
  const fallbackCandidates = shouldRaceTopTwo
    ? scored.filter(s => !parallelSet.has(s.provider))
    : scored;

  return {
    configured,
    taskProfile,
    executionMode: shouldRaceTopTwo ? 'adaptive_race' : 'dynamic_route',
    ranked: scored,
    parallelCandidates,
    fallbackCandidates
  };
}

/** Verify generated AI response contains usable code (guards against silent stubs or empty completions). */
export function isUsableProviderResult(res) {
  if (!res) return false;
  const checkText = (txt) => {
    const s = String(txt || '').trim();
    if (s.length <= 5) return false;
    // Reject stub-only placeholder outputs
    if (/^(?:\/\/|#|\/\*)\s*(?:todo|implement|your code here|placeholder)[^a-zA-Z0-9]*$/i.test(s)) return false;
    return true;
  };
  if (checkText(res.code)) return true;
  if (Array.isArray(res.files) && res.files.some(f => checkText(f?.code))) return true;
  return false;
}
