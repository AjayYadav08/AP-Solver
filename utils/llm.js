// utils/llm.js - Public barrel re-exporting modular AI engine, prompt builder, parsers & command utilities
export {
  stripComments,
  formatCodeIndentation,
  stripFileCommentHeaders,
  extractCodeBlock,
  parseMultiFileSolution
} from './code-format.js';

export {
  sanitizePostWriteCommand,
  extractCommandsFromResponse,
  detectRequiredPostWriteCommands,
  buildBase64TerminalScript
} from './commands.js';

export {
  SYSTEM_PROMPT,
  buildPrompt,
  getContextGatedSystemPrompt,
  buildCompactGroqMessages
} from './prompts.js';

export {
  normalizePlannerPath,
  dedupeFlatVsNested,
  analyzeFileModificationPlan,
  enforceFilePlan
} from './file-planner.js';

export {
  buildQuestionStorageKey,
  classifyFailureCategory,
  analyzePreCodingTerminal,
  summarizeCodeChanges,
  buildAttemptRecord,
  formatFullCollaborationHistory,
  loadQuestionAttemptHistory,
  saveQuestionAttemptHistory
} from './attempt-history.js';

export {
  detectRuntimeEnvironment,
  extractFileContentChecks,
  extractExpectedModuleExports,
  extractHttpProbes,
  extractSampleIoCases,
  buildLocalTestSpec
} from './local-test-planner.js';

export {
  OPENAI_COMPAT_PRESETS,
  PROVIDER_CAPABILITIES,
  validateApiKeyFormat,
  getConfiguredProviders,
  analyzeTaskProfile,
  scoreProviderForTask,
  planModelOrchestration,
  recordProviderOutcome,
  getProviderTelemetrySnapshot,
  resetProviderTelemetry,
  isUsableProviderResult
} from './orchestrator.js';

export {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  callGemini,
  callGroq,
  callCerebras,
  callOpenAI,
  testProviderConnections,
  generateSolution
} from './providers.js';
