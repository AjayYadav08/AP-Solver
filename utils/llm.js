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
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  callGemini,
  callGroq,
  callOpenAI,
  generateSolution
} from './providers.js';
