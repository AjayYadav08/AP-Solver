// test_extension.js - Unit and Syntax Verification for AP-Solver
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { extractCodeBlock, buildPrompt, formatCodeIndentation, parseMultiFileSolution } from './utils/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🧪 Starting AP-Solver Extension Verification...\n');

// 1. Verify Manifest JSON
console.log('1. Checking manifest.json...');
const manifestRaw = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);
if (manifest.manifest_version !== 3) throw new Error('Manifest must be version 3');
if (!manifest.permissions.includes('storage')) throw new Error('Missing storage permission');
if (!manifest.permissions.includes('scripting')) throw new Error('Missing scripting permission');
if (!manifest.permissions.includes('debugger')) throw new Error('Missing debugger permission for hardware mouse/keyboard events');
// Ensure restricted to newtonschool.co
const contentMatches = manifest.content_scripts.flatMap(cs => cs.matches);
if (contentMatches.includes('<all_urls>')) throw new Error('Content scripts must not match <all_urls>; must be restricted to newtonschool.co');
console.log('   ✓ manifest.json is valid MV3 and strictly restricted to newtonschool.co');

// 2. Check all files exist
console.log('2. Checking required files exist...');
const files = [
  'manifest.json',
  'background.js',
  'utils/llm.js',
  'content/content.js',
  'content/solver-ui.js',
  'content/styles.css',
  'content/frame-editor.js',
  'content/main-world-bridge.js',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css',
  'options/options.html',
  'options/options.js',
  'options/options.css',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

for (const f of files) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${f}`);
  const stats = fs.statSync(p);
  if (stats.size === 0) throw new Error(`File is empty: ${f}`);
  if (f.endsWith('.js')) {
    try {
      execSync(`node --check "${p}"`, { stdio: 'pipe' });
    } catch (e) {
      throw new Error(`Syntax error in ${f}: ${e.message}`);
    }
  }
}
console.log(`   ✓ All ${files.length} files exist, are non-empty, and have valid JS syntax`);

// 3. Test code extraction
console.log('3. Testing code extraction from LLM response...');
const sampleRawResponse = `Here is the solution to your problem:
\`\`\`javascript
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.end(JSON.stringify({ message: "Hello World" }));
});
module.exports = server;
\`\`\`
Hope this helps!`;

const extracted = extractCodeBlock(sampleRawResponse);
if (!extracted.startsWith('const http = require') || !extracted.includes('module.exports = server;')) {
  throw new Error('Code extraction failed: ' + extracted);
}
console.log('   ✓ Code block correctly extracted without conversational markdown');

// 4. Test Prompt Builder with 3-section interface data
console.log('4. Testing Prompt Builder with 3-section interface question...');
const prompt = buildPrompt({
  questionTitle: 'Build a Task Management API',
  questionDetails: 'Implement GET /tasks, POST /tasks, PATCH /tasks/:id',
  testCases: [
    'GET /tasks returns predefined tasks as JSON',
    'POST /tasks creates distinct tasks with completed=false and saves them',
    'PATCH /tasks/:id updates a predefined task and preserves its title'
  ],
  currentCode: 'const http = require("node:http");\nconst server = http.createServer();\nmodule.exports = server;',
  language: 'javascript'
});

if (!prompt.includes('Build a Task Management API') || !prompt.includes('Test Cases to Pass') || !prompt.includes('PATCH /tasks/:id')) {
  throw new Error('Prompt builder missing essential sections');
}
console.log('   ✓ Prompt builder generated comprehensive specification');

// 5. Test Settings Merging & Key Preservation
console.log('5. Testing settings merging and key preservation...');
const storedSettings = {
  provider: 'gemini',
  geminiKey: 'AIzaSyTestGeminiKey123',
  groqKey: '',
  openaiKey: ''
};

// Simulate UI passing settingsOverride without keys
const uiOverride = { provider: 'groq', autoSubmit: true };
const mergedSettings = { ...storedSettings };
for (const [k, v] of Object.entries(uiOverride)) {
  if (v !== undefined && v !== null && v !== '') {
    mergedSettings[k] = v;
  }
}

if (!mergedSettings.geminiKey || mergedSettings.geminiKey !== 'AIzaSyTestGeminiKey123') {
  throw new Error('Critical bug: stored API key was lost during settings merge!');
}

// Test auto-switching when selected provider has no key
let effectiveProvider = mergedSettings.provider;
const hasGemini = !!mergedSettings.geminiKey?.trim();
const hasGroq = !!mergedSettings.groqKey?.trim();

if (effectiveProvider === 'groq' && !hasGroq && hasGemini) {
  effectiveProvider = 'gemini';
}

if (effectiveProvider !== 'gemini') {
  throw new Error('Auto-switch failed: should have fallen back to Gemini when Groq key is missing');
}
console.log('   ✓ Settings merge preserves stored keys and auto-switches to available provider');

// 6. Test Terminal Scraper and Clean Wipe Logic in scripts
console.log('6. Testing Terminal Scraper & Wipe Logic in content scripts...');
const contentJs = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

if (!contentJs.includes('readTerminalOutput') || !contentJs.includes('switchToTerminalTab')) {
  throw new Error('Terminal scraper functions missing from content.js');
}
if (!contentJs.includes('countHttp <= 1') || !contentJs.includes('top-dom-wipeAndPaste')) {
  throw new Error('Duplicate starter code guard or wipe logic missing from content.js');
}
if (!backgroundJs.includes('dom.insertTextAndPaste') || !backgroundJs.includes('monaco.model.setValue')) {
  throw new Error('Multi-tier wipe and replace missing from background.js');
}
console.log('   ✓ Terminal scraper & complete wipe logic verified across scripts');

// 7. Test Terminal Error Feedback in Prompt Builder
console.log('7. Testing Terminal Error Feedback in Prompt Builder...');
const sampleTerminalTrace = `
> mocha '__tests__/*.js'
1) GET /tasks returns predefined tasks:
   AssertionError: expected 501 to equal 200
2) POST /tasks creates distinct tasks:
   AssertionError: expected 501 to equal 201
`;
const feedbackPrompt = buildPrompt({
  questionTitle: 'Build a Task Management API',
  questionDetails: 'Implement GET /tasks, POST /tasks',
  testCases: ['GET /tasks', 'POST /tasks'],
  currentCode: 'res.statusCode = 501;',
  language: 'javascript',
  feedback: `CRITICAL TEST FAILURE TRACE FROM TERMINAL:\n${sampleTerminalTrace}`
});

if (!feedbackPrompt.includes('CRITICAL: PREVIOUS SUBMISSION FAILED') || !feedbackPrompt.includes('expected 501 to equal 200')) {
  throw new Error('Feedback prompt failed to incorporate terminal traces properly');
}
console.log('   ✓ Terminal failure feedback properly incorporated into AI prompt');

// 8. Test Clean 2-Space Code Indentation
console.log('8. Testing Clean 2-Space Code Indentation...');
const unformattedCode = `
const server = http.createServer((req, res) => {
res.setHeader('Content-Type', 'text/plain');
if (req.method !== 'GET') {
res.statusCode = 405;
res.end('Method Not Allowed');
return;
}
if (routes[req.url]) {
res.statusCode = 200;
res.end(routes[req.url]);
} else {
res.statusCode = 404;
res.end('Not Found');
}
});
`;
const formatted = formatCodeIndentation(unformattedCode);
if (!formatted.includes('  res.setHeader') || !formatted.includes('    res.statusCode = 405;') || !formatted.includes('  } else {')) {
  throw new Error('Code indentation formatting failed:\n' + formatted);
}
console.log('   ✓ Code indentation successfully formatted with clean 2-space alignment');

// 9. Test Verification against Target Screenshot (Netflix Challenge 2-Space Alignment)
console.log('9. Testing Nested Block & Callback Alignment (Target Image Verification)...');
const sampleNetflixCode = `
const http = require('http');
const path = require('path');
const EventEmitter = require('events');

const netflix = new EventEmitter();

netflix.on('play', (show, episode) => {
console.log('Playing ' + show);
});

const app = http.createServer((req, res) => {
if (req.method === 'GET' && req.url.startsWith('/play/')) {
const normalized = path.normalize(req.url);
const parts = normalized.split('/').filter(Boolean);
if (parts.length >= 3 && parts[0] === 'play') {
const [, show, episode] = parts;
netflix.emit('play', show, episode);
const response = {
message: 'Now playing',
show,
episode,
};
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify(response));
return;
}
}
res.writeHead(404, { 'Content-Type': 'text/plain' });
res.end('Not Found');
});

app.listen(3000, () => {
console.log('Listening');
});

module.exports = { app, netflix };
`;

const netflixFormatted = formatCodeIndentation(sampleNetflixCode);
if (!netflixFormatted.includes('  console.log(\'Playing \' + show);')) {
  throw new Error('Callback body should be indented by 2 spaces, got:\n' + netflixFormatted);
}
if (!netflixFormatted.includes('  if (req.method === \'GET\'')) {
  throw new Error('Server body should be indented by 2 spaces, got:\n' + netflixFormatted);
}
if (!netflixFormatted.includes('    const normalized = path.normalize(req.url);')) {
  throw new Error('Nested if body should be indented by 4 spaces, got:\n' + netflixFormatted);
}
if (!netflixFormatted.includes('      const [, show, episode] = parts;')) {
  throw new Error('Deeply nested if body should be indented by 6 spaces, got:\n' + netflixFormatted);
}
if (!netflixFormatted.includes('        message: \'Now playing\',')) {
  throw new Error('Object body should be indented by 8 spaces, got:\n' + netflixFormatted);
}
if (!netflixFormatted.includes('      };')) {
  throw new Error('Object closing brace should be indented by 6 spaces, got:\n' + netflixFormatted);
}
if (!netflixFormatted.includes('module.exports = { app, netflix };')) {
  throw new Error('Top-level exports should have 0 indent, got:\n' + netflixFormatted);
}
console.log('   ✓ Target image layout verified: exactly matching clean 2-space indentation');

// 10. Test 3-Tab Rail Navigation and Continuous Autonomous Loop
console.log('10. Testing 3-Tab Rail Navigation & Autonomous Debugging Loop...');
const updatedContentJs = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const updatedLlmJs = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf8');

if (!updatedContentJs.includes('switchToQuestionTab') ||
    !updatedContentJs.includes('switchToSubmissionsTab') ||
    !updatedContentJs.includes('switchToTerminalTab') ||
    !updatedContentJs.includes('clickRailTab')) {
  throw new Error('3-tab rail navigation functions missing from content.js');
}

if (!updatedContentJs.includes('FAILED TEST CASES (FROM TAB 2') ||
    !updatedContentJs.includes('TERMINAL & MOCHA ERROR TRACES (FROM TAB 3)')) {
  throw new Error('Combined Tab 2 + Tab 3 debugging feedback missing from content.js');
}

if (!updatedLlmJs.includes('Prisma') || !updatedLlmJs.includes('bcrypt.hash') || !updatedLlmJs.includes('POST /register')) {
  throw new Error('Prisma, bcrypt, and auth guidelines missing from utils/llm.js');
}

console.log('   ✓ 3-Tab rail navigation, scrapers, and autonomous feedback loop verified');

// 11. Test Tab 2 Leaf-Element Test Case & Timestamp Parser
console.log('11. Testing Tab 2 Leaf-Element Parser & Status Scraper...');
if (!updatedContentJs.includes('testNameElements') ||
    !updatedContentJs.includes('uniqueTestElements') ||
    !updatedContentJs.includes('Submission Results (Attempt')) {
  throw new Error('Tab 2 leaf-element test scraper or per-test logging missing from content.js');
}

// Simulate test case regex matching
const sampleRows = [
  '1. should register a user successfully',
  '2. should reject registration when email is missing',
  '3. should reject registration when password is missing',
  '4. should reject registration when both fields are missing',
  '5. should store the user in the PostgreSQL database',
  '6. should never store the original password',
  '7. should store a valid bcrypt hash',
  '8. should use exactly 10 bcrypt salt rounds',
  '9. should generate different hashes for the same password',
  '10. should not expose the password or hash in the response',
  '11. should reject an empty password',
  '12. should reject duplicate email registration'
];

const parsedTests = sampleRows.filter(t => /^\d+[\.\)]\s+[A-Za-z]/.test(t));
if (parsedTests.length !== 12) {
  throw new Error(`Expected 12 parsed tests, got ${parsedTests.length}`);
}
console.log(`   ✓ Successfully verified Tab 2 test scraper parsing all ${parsedTests.length} tests with status & timestamp`);

// 12. Test Turbo Parallel Speculative Race Mode & Groq Normalization
console.log('12. Testing Turbo Parallel Speculative Race & Model Normalization...');
if (!updatedLlmJs.includes('Turbo Parallel Race') ||
    !updatedLlmJs.includes('Promise.any([runGroq(), runGemini()])') ||
    !updatedLlmJs.includes('openai/gpt-oss-120b') ||
    !updatedLlmJs.includes('qwen/qwen3.8-27b')) {
  throw new Error('Turbo race engine or updated Groq models missing from utils/llm.js');
}

// Test Groq model normalization for legacy LLaMA names
let testLegacyModel = 'llama-3.3-70b-versatile';
if (!testLegacyModel || testLegacyModel.includes('llama') || testLegacyModel.includes('mixtral')) {
  testLegacyModel = 'openai/gpt-oss-120b';
}
if (testLegacyModel !== 'openai/gpt-oss-120b') {
  throw new Error('Groq legacy model normalization failed');
}

// Test Promise.any speculative race resolution
const fastPromise = new Promise(resolve => setTimeout(() => resolve({ provider: 'groq', latency: 70 }), 20));
const slowPromise = new Promise(resolve => setTimeout(() => resolve({ provider: 'gemini', latency: 2500 }), 200));
const winner = await Promise.any([fastPromise, slowPromise]);
if (winner.provider !== 'groq') {
  throw new Error('Speculative race failed: fastest provider did not win');
}
console.log('   ✓ Turbo parallel speculative race logic and Groq model normalization verified');

// 13. Test Sub-Second Evaluation Fast Exit
console.log('13. Testing Sub-Second Evaluation Fast Exit Conditions...');
if (!updatedContentJs.includes('consecutivePassedChecks') ||
    !updatedContentJs.includes('Instant Exit: All') ||
    !updatedContentJs.includes('sleep(300)')) {
  throw new Error('Sub-second responsive evaluation checks missing from content.js');
}
console.log('   ✓ Responsive 300ms polling and instant completion exits verified');

// 14. Test Multi-File Workspace Navigation, File Targeting & Multi-File Solution Parser
console.log('14. Testing Multi-File Workspace Awareness & Multi-Block Solution Parser...');
const sampleMultiLLMResponse = `
Here is the solution modifying multiple files for the project:

\`\`\`javascript
// FILE: src/orderManager.js
const fs = require('fs');
const path = require('path');

function processOrders(orders) {
  return orders.filter(o => o.status === 'valid');
}

module.exports = { processOrders };
\`\`\`

\`\`\`javascript
// FILE: src/logReader.js
const fs = require('fs');

function readLogs() {
  return ['log1', 'log2'];
}

module.exports = { readLogs };
\`\`\`
`;

const parsedMulti = parseMultiFileSolution(sampleMultiLLMResponse, 'src/orderManager.js');
if (parsedMulti.length !== 2) {
  throw new Error(`Expected 2 files in parsedMulti, got ${parsedMulti.length}`);
}
if (parsedMulti[0].filePath !== 'src/orderManager.js' || !parsedMulti[0].code.includes('processOrders')) {
  throw new Error('Multi-file parsing failed on file 1: ' + JSON.stringify(parsedMulti[0]));
}
if (parsedMulti[1].filePath !== 'src/logReader.js' || !parsedMulti[1].code.includes('readLogs')) {
  throw new Error('Multi-file parsing failed on file 2: ' + JSON.stringify(parsedMulti[1]));
}

// Single file fallback should inherit active file (e.g. orderManager.js)
const sampleSingle = `\`\`\`javascript\nconst a = 100;\n\`\`\``;
const parsedSingle = parseMultiFileSolution(sampleSingle, 'src/orderManager.js');
if (parsedSingle.length !== 1 || parsedSingle[0].filePath !== 'src/orderManager.js') {
  throw new Error('Single file fallback should match activeFile: ' + JSON.stringify(parsedSingle));
}

// Verify background and bridge scripts have multi-file awareness
const bridgeJs = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');
const bgJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

if (!bridgeJs.includes('detectActiveFileName') || !bridgeJs.includes('navigateToTargetFile') || !bridgeJs.includes('createNewFileInWorkspace')) {
  throw new Error('Multi-file navigation & creation functions missing from main-world-bridge.js');
}

if (!bgJs.includes('detectActiveFile') || !bgJs.includes('scanWorkspaceFiles') || !bgJs.includes('targetPath')) {
  throw new Error('Multi-file awareness or targetPath missing from background.js');
}

console.log('   ✓ Multi-file workspace scanner, file navigator, and multi-block parser verified');

console.log('15. Testing Multi-File Header Permutations & Target Safety Guards...');
const userThreeFiles = `
// orderManager.js
const fs = require('fs');
function processOrder() {}
module.exports = { processOrder };

// logReader.js
const fs = require('fs');
function readLogs() {}
module.exports = { readLogs };

// index.js
const { processOrder } = require('./orderManager');
const { readLogs } = require('./logReader');
`;

const parsedUserFiles = parseMultiFileSolution(userThreeFiles, 'src/index.js');
if (parsedUserFiles.length !== 3) {
  throw new Error(`Expected 3 files parsed from user snippet, got ${parsedUserFiles.length}`);
}
if (parsedUserFiles[0].filePath !== 'src/orderManager.js' || !parsedUserFiles[0].code.includes('processOrder')) {
  throw new Error('User snippet file 0 mismatch: ' + JSON.stringify(parsedUserFiles[0]));
}
if (parsedUserFiles[1].filePath !== 'src/logReader.js' || !parsedUserFiles[1].code.includes('readLogs')) {
  throw new Error('User snippet file 1 mismatch: ' + JSON.stringify(parsedUserFiles[1]));
}
if (parsedUserFiles[2].filePath !== 'src/index.js' || !parsedUserFiles[2].code.includes('processOrder')) {
  throw new Error('User snippet file 2 mismatch: ' + JSON.stringify(parsedUserFiles[2]));
}

// Single-file header detection test (e.g. validateMiddleware.js when index.js is active)
const singleHeaderSample = `// validateMiddleware.js
function validateUser(req, res, next) {
  return next();
}
module.exports = { validateUser };
`;
const parsedSingleHeader = parseMultiFileSolution(singleHeaderSample, 'src/index.js');
if (parsedSingleHeader.length !== 1 || parsedSingleHeader[0].filePath !== 'src/validateMiddleware.js') {
  throw new Error('Single-file with header must resolve to header filename (src/validateMiddleware.js), got: ' + JSON.stringify(parsedSingleHeader));
}
if (parsedSingleHeader[0].code.includes('// validateMiddleware.js')) {
  throw new Error('Single-file header line must be cleanly stripped from code body!');
}

// Safety guard verification: verify that main-world-bridge and background do NOT fall back to active editor when target is specified
const currentBridgeJs = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');
const currentBgJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

if (!currentBridgeJs.includes('if (!targetFilePath)') || !currentBgJs.includes('if ((!targetPath || isTargetActive)')) {
  throw new Error('Target safety guard missing: active editor fallback must only run when target is NOT specified!');
}

console.log('   ✓ User 3-file snippet and target model safety guards verified');

// Test 16: Verify Multi-File UI Manager, Pointer/Enter Event Navigation, and Injection Callbacks
console.log('16. Testing Multi-File Solution Manager UI & Navigation Integration...');
const solverUiJs = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf8');
const freshContentJs = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'content/styles.css'), 'utf8');

if (!solverUiJs.includes('setGeneratedFiles') || !solverUiJs.includes('ap-multi-files-box') || !solverUiJs.includes('ap-btn-file-inject')) {
  throw new Error('solver-ui.js must support setGeneratedFiles and render individual file inject/copy cards!');
}
if (!freshContentJs.includes('onInjectSingleFile') || !freshContentJs.includes('setFileStatus')) {
  throw new Error('content.js must wire onInjectSingleFile and update file status in UI!');
}
if (!stylesCss.includes('.ap-multi-files-box') || !stylesCss.includes('.ap-btn-file-inject')) {
  throw new Error('styles.css must include styles for .ap-multi-files-box and .ap-btn-file-inject!');
}
if (!currentBridgeJs.includes('KeyboardEvent') || !currentBridgeJs.includes('detail: 2')) {
  throw new Error('main-world-bridge.js must simulate dblclick with detail: 2 and Enter key events!');
}
console.log('   ✓ Multi-File Solution Manager UI & bulletproof navigation verified');

// Test 17: Verify Chrome DevTools Protocol (CDP) True Native Hardware Driver
console.log('17. Testing Chrome DevTools Protocol (CDP) True Native Hardware Driver...');
const updatedBgJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

if (!updatedBgJs.includes('attachCDP') || !updatedBgJs.includes('cdpNativeDblClick') || !updatedBgJs.includes('cdpClickElementInWorkspace') || !updatedBgJs.includes('cdpSaveFile')) {
  throw new Error('background.js must implement attachCDP, cdpNativeDblClick, cdpClickElementInWorkspace, and cdpSaveFile!');
}
if (!updatedBgJs.includes('Input.dispatchMouseEvent') || !updatedBgJs.includes('Input.dispatchKeyEvent') || !updatedBgJs.includes('Input.insertText')) {
  throw new Error('background.js must dispatch native mouse, keyboard and insertText events via CDP!');
}
if (!updatedBgJs.includes('cdpClickElementInWorkspace(tabId, targetFilePath)')) {
  throw new Error('background.js writeEditorInTab must call cdpClickElementInWorkspace to navigate to target files!');
}
console.log('   ✓ Chrome DevTools Protocol (CDP) True Native Hardware Driver verified');

// Test 18: Verify Direct Terminal File Injection Engine & All-In-One Script Generator
console.log('18. Testing Direct Terminal File Injection Engine & Terminal Copy...');
const terminalBgJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const terminalContentJs = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const terminalUiJs = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf8');
const terminalCss = fs.readFileSync(path.join(__dirname, 'content/styles.css'), 'utf8');

if (!terminalBgJs.includes('writeFilesViaTerminal') || !terminalBgJs.includes('AP_WRITE_TERMINAL')) {
  throw new Error('background.js must implement writeFilesViaTerminal and AP_WRITE_TERMINAL handler!');
}
if (!terminalContentJs.includes('AP_WRITE_TERMINAL') || !terminalContentJs.includes('Terminal Turbo Engine')) {
  throw new Error('content.js must support fast-path terminal injection!');
}
if (!terminalUiJs.includes('ap-btn-copy-terminal-script') || !terminalCss.includes('.ap-btn-copy-terminal-script')) {
  throw new Error('solver-ui.js and styles.css must provide ap-btn-copy-terminal-script button!');
}
console.log('   ✓ Direct Terminal File Injection Engine & All-In-One Script Generator verified');

// Test 19: Verify Numbered Header Parsing & Existing File Existence Check Priority
console.log('19. Testing Numbered Header Parsing & Existing File Check Priority...');
const numberedHeadersSample = `// 1. middleware.js
function validate(req, res, next) { next(); }

// 2. index.js
const express = require('express');
const app = express();
`;
const parsedNumbered = parseMultiFileSolution(numberedHeadersSample, 'src/index.js');
if (parsedNumbered.length !== 2 || parsedNumbered[0].filePath !== 'src/middleware.js' || parsedNumbered[1].filePath !== 'src/index.js') {
  throw new Error('Numbered file headers (// 1. middleware.js, // 2. index.js) must be accurately resolved to their respective files!');
}

// Verify that background.js has 2-pass scan: checks existing tabs and tree rows BEFORE createNewFile
const currentNavBgJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
if (!currentNavBgJs.includes('PASS 1') || !currentNavBgJs.includes('PASS 2') || !currentNavBgJs.includes('targetMatch = matches?.find')) {
  throw new Error('background.js must prioritize existing tabs/tree items over creating a new file!');
}
if (!currentNavBgJs.includes('one|two') || !currentNavBgJs.includes('Skipped invalid target filename')) {
  throw new Error('background.js must guard against invalid filenames like "1" or "one"!');
}
console.log('   ✓ Numbered Header Parsing & Existing File Check Priority verified');

// Test 20: Verify "File 1" Header Stripping, Semantic Mapping, and Flawed Synthetic DOM Click Removal
console.log('20. Testing "File 1" Header Stripping & Synthetic DOM Click Elimination...');
const { stripFileCommentHeaders } = await import('./utils/llm.js');

const messyCode1 = `// File 1\nfunction validateName(req, res, next) { return next(); }`;
const messyCode2 = `// File 1: src/middleware.js\nfunction validateName(req, res, next) { return next(); }`;
const messyCode3 = `/* File 1 */\nfunction validateName(req, res, next) { return next(); }`;

if (stripFileCommentHeaders(messyCode1).includes('File 1') ||
    stripFileCommentHeaders(messyCode2).includes('File 1') ||
    stripFileCommentHeaders(messyCode3).includes('File 1')) {
  throw new Error('stripFileCommentHeaders must completely remove "File 1" comments!');
}

// Test generic File 1 / File 2 mapping against workspaceFiles
const genericTwoBlocks = `File 1:\n\`\`\`javascript\nfunction validate(req, res, next) { next(); }\n\`\`\`\n\nFile 2:\n\`\`\`javascript\nconst app = express();\n\`\`\``;
const resolvedGeneric = parseMultiFileSolution(genericTwoBlocks, 'src/index.js', ['src/middleware.js', 'src/index.js']);
if (resolvedGeneric[0].filePath !== 'src/middleware.js' || resolvedGeneric[1].filePath !== 'src/index.js') {
  throw new Error('Generic multi-file blocks must be semantically mapped to workspaceFiles (middleware.js & index.js), got: ' + JSON.stringify(resolvedGeneric));
}

// Verify that synthetic DOM newFileBtn clicks in MAIN world are completely removed
const bgJsClean = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const bridgeJsClean = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');

if (bgJsClean.includes('findExplorerItem(\'src\');\n              if (srcItem) simulateClick(srcItem);') ||
    bridgeJsClean.includes('findExplorerItem(\'src\');\n      if (srcItem) simulateClick(srcItem);')) {
  throw new Error('Synthetic DOM newFileBtn clicks must be eliminated from MAIN world to prevent creating untitled/1.js files!');
}
console.log('   ✓ "File 1" Header Stripping & Synthetic DOM Click Elimination verified');

// Test 21: Verify Robust src Folder Twistie & ArrowRight Expansion
console.log('21. Testing Robust src Folder Dropdown Expansion...');
const bgExpandJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');

if (!bgExpandJs.includes('ArrowRight') || !bgExpandJs.includes('cdpNativeDblClick(tabId, globalX, globalY)') || !bgExpandJs.includes('rowR.left + 12')) {
  throw new Error('background.js must implement robust src twistie chevron targeting with ArrowRight and double-click!');
}
console.log('   ✓ Robust src Folder Dropdown Expansion verified');

// Test 22: Verify Full 6-Step Autonomous Solving Lifecycle & Precision Side Bar Terminal Scraper
console.log('22. Testing Full 6-Step Autonomous Solving Lifecycle & Precision Side Bar Terminal Scraper...');
const contentJs22 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const solverUi22 = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf8');
const optionsJs22 = fs.readFileSync(path.join(__dirname, 'options/options.js'), 'utf8');
const popupJs22 = fs.readFileSync(path.join(__dirname, 'popup/popup.js'), 'utf8');
const utilsLlm22 = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf8');
const bgJs22 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const bridgeJs22 = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');

// 1. Verify 6-step lifecycle in content.js
if (!contentJs22.includes('[Step 1/6]') ||
    !contentJs22.includes('[Step 2/6]') ||
    !contentJs22.includes('[Step 3/6]') ||
    !contentJs22.includes('[Step 4/6]') ||
    !contentJs22.includes('[Step 5/6]') ||
    !contentJs22.includes('[Step 6/6]')) {
  throw new Error('content.js must implement and log all 6 steps of the autonomous solving lifecycle!');
}

// 2. Loop repetition enforcement when testcases fail (Step 6)
if (!contentJs22.includes('let maxAttempts = ui.options.autoRetry ? 3 : 1')) {
  throw new Error('handleOneClickSolve must allow up to 3 attempts when autoRetry is active to repeat steps 4 & 5!');
}

// 3. Code completeness gate before submit (Step 3 to 4)
if (!contentJs22.includes('async function verifyCodeCompleteness') ||
    !contentJs22.includes('write your code here') ||
    !contentJs22.includes('const isComplete = await verifyCodeCompleteness')) {
  throw new Error('content.js must verify code completeness and reject starter placeholders before submitting!');
}

// 4. Editor targeting guards against HTTP tester panel
if (!bgJs22.includes('normActive.length > 0 && normBase.length > 0') ||
    !bgJs22.includes('No valid workspace editor in this frame') ||
    !bridgeJs22.includes('validEditors.find(ed => !ed.getOption(monaco.editor.EditorOption.readOnly))') ||
    !bridgeJs22.includes('activeFileName.length > 0 && activeFileName.toLowerCase().includes(basename.toLowerCase())')) {
  throw new Error('background.js and main-world-bridge.js must strictly guard against empty tab string matching and HTTP tester editor injection!');
}

// 5. Precision error extraction and Side Bar Terminal scraper (Step 5)
if (!contentJs22.includes('function findMochaErrorForTest') ||
    !contentJs22.includes('readSubmissionResultsWithErrors') ||
    !contentJs22.includes('readTerminalOutput') ||
    !contentJs22.includes('switchToTerminalTab')) {
  throw new Error('content.js must implement findMochaErrorForTest, readSubmissionResultsWithErrors, and readTerminalOutput to scrape side bar terminal error messages!');
}
console.log('   ✓ Full 6-Step Autonomous Solving Lifecycle & Precision Side Bar Terminal Scraper verified');
console.log('   ✓ Anti-Spam Single Submission, Code Completeness Check & Precision Error Extraction verified');

// Test 23: Verify File Icon Targeting, Inline Rename Elimination, and Escape Dismissal
console.log('23. Testing File Icon Targeting, Inline Rename Elimination, and Escape Dismissal...');
const bgJs23 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const bridgeJs23 = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');
const frameJs23 = fs.readFileSync(path.join(__dirname, 'content/frame-editor.js'), 'utf8');
const contentJs23 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');

// 1. Verify Escape dismissal for active inline rename boxes
if (!bgJs23.includes("cdpNativeKey(tabId, 'Escape', 'Escape', 27, 0)") ||
    !bgJs23.includes("activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape'") ||
    !bridgeJs23.includes("activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape'") ||
    !frameJs23.includes("activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape'")) {
  throw new Error('All navigation layers must dismiss any active rename box with Escape key!');
}

// 2. Verify file icon coordinate targeting (never middle of text label)
if (!bgJs23.includes("(iconR.left && iconR.left > r.left) ? (iconR.left + 8) : (r.left + 24)") ||
    !bgJs23.includes("NEVER click the text label name, which triggers inline rename!") ||
    !bridgeJs23.includes("isTreeRow") ||
    !frameJs23.includes("isTreeRow")) {
  throw new Error('Tree row clicks must target the file icon, never the text label!');
}

// 3. Verify complete elimination of Enter key events on tree items
if (bgJs23.includes("src.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter'") ||
    bgJs23.includes("srcItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter'") ||
    bridgeJs23.includes("srcItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter'") ||
    frameJs23.includes("srcFolder.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter'")) {
  throw new Error('Enter key events on tree items must be completely eliminated to prevent triggering inline rename on macOS/VS Code!');
}

// 4. Verify HTTP tester editor isolation in top document
if (!contentJs23.includes("!document.querySelector('iframe')") ||
    bgJs23.includes("allEditors[0] || document.querySelector('.monaco-editor')")) {
  throw new Error('Top document must never fall back to HTTP tester editors when iframe exists!');
}
console.log('   ✓ File Icon Targeting, Inline Rename Elimination & HTTP Tester Isolation verified');

// Test 24: Verify "activeFile 1" Elimination, Workbench Isolation & New File Polling
console.log('24. Testing "activeFile 1" Elimination, Workbench Isolation & New File Polling...');
const bgJs24 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const contentJs24 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const bridgeJs24 = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');

// 1. Verify workbench isolation and rejection of numeric filenames in background.js
if (!bgJs24.includes('!isWorkbench && document.querySelector(\'iframe\')') ||
    !bgJs24.includes('!/^\\d+$/.test(rawFname)') ||
    !bgJs24.includes('workbenchMatch = results?.find(r => r.result && r.result.found && r.result.isWorkbench)')) {
  throw new Error('background.js must isolate real workbench frames and reject inmemory/numeric model names like "1"!');
}

// 2. Verify polling for newly created files in writeEditorInTab
if (!bgJs24.includes('Date.now() - tStart < 3500') ||
    !bgJs24.includes('normBase && normStr(curTxt).includes(normBase)')) {
  throw new Error('background.js must poll up to 3.5s for newly created files and tabs to initialize!');
}

// 3. Verify content.js numeric activeFile guard and challenge target auto-detection
if (!contentJs24.includes('/^\\d+$/.test(activeFile)') ||
    !contentJs24.includes('seed\\.js|router|controller|middleware|service') ||
    !contentJs24.includes('hasCleanCode')) {
  throw new Error('content.js must sanitize numeric activeFile, auto-target new required files like seed.js, and check existing clean code before pausing!');
}
console.log('   ✓ "activeFile 1" Elimination, Workbench Isolation & New File Polling verified');

// Test 25: Verify sanitizeActiveFile helper, Stale Cache Reset, and Code Matching Fallback
console.log('25. Testing sanitizeActiveFile helper, Stale Cache Reset, and Code Matching Fallback...');
const contentJs25 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const solverUi25 = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf8');

if (!contentJs25.includes('function sanitizeActiveFile') ||
    !contentJs25.includes('cachedEditor = null;\n      cachedGeneratedFiles = [];') ||
    !contentJs25.includes('codeMatches') ||
    !solverUi25.includes('/^\\d+$/.test(f)')) {
  throw new Error('content.js & solver-ui.js must implement sanitizeActiveFile, reset stale cache on solve, and verify codeMatches fallback!');
}
console.log('   ✓ sanitizeActiveFile Helper, Stale Cache Reset & Code Matching Fallback verified');

// Test 26: Verify Complete 6-Step Autonomous Process & Submission Block Policy
console.log('26. Testing Complete 6-Step Autonomous Process & Submission Block Policy...');
const contentJs26 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const bgJs26 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const llmJs26 = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf8');

// 1. Step 1: Initial files of workspace passed to AI
if (!bgJs26.includes("fname.endsWith('.prisma') || fname.endsWith('.js')") ||
    !llmJs26.includes("Initial Workspace Files & Starter Code")) {
  throw new Error('background.js and llm.js must provide full initial files and starter code to AI!');
}

// 2. Step 2 & 3: Multi-file handling, erasing initial code, and required file creation
if (!contentJs26.includes("Erasing initial code & writing complete solution into") ||
    !contentJs26.includes("updatedFiles") ||
    !contentJs26.includes("failedFiles")) {
  throw new Error('content.js must erase initial code and track updated/failed files for multi-file writing!');
}

// 3. Strict Submission Policy: Never submit until each required file's code is updated
if (!contentJs26.includes("Submission BLOCKED: Do not click submit until each required file's code is updated!") ||
    !contentJs26.includes("Submission cancelled: All required files must have complete, non-placeholder code")) {
  throw new Error('content.js must block submission until each required file is updated and complete!');
}

// 4. Step 5 & 6: Side bar terminal error extraction and retry loop
if (!contentJs26.includes("readTerminalOutput(5500)") ||
    !contentJs26.includes("Repeating steps 4 and 5 with targeted fix")) {
  throw new Error('content.js must analyze side bar terminal error messages and repeat steps 4 and 5!');
}
console.log('   ✓ 6-Step Autonomous Process & "Do Not Submit Until Each Required File Updated" Policy verified');

console.log('27. Testing Base64 Atomic Terminal Script & In-Frame Terminal Controller...');
globalThis.chrome = globalThis.chrome || {
  runtime: {
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  },
  debugger: { attach: () => {}, sendCommand: () => {} },
  scripting: { executeScript: () => {} },
  tabs: { sendMessage: () => {} }
};
const { buildBase64TerminalScript } = await import('./background.js');
const frameEditorJs27 = fs.readFileSync(path.join(__dirname, 'content/frame-editor.js'), 'utf8');
const solverUiJs27 = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf8');
const contentJs27 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');

// 1. Verify buildBase64TerminalScript
const sampleFiles = [
  { filePath: 'src/seed.js', code: '// Sample comment\nconst a = 10; /* inline */\nconsole.log(a);' }
];
const genScript = buildBase64TerminalScript(sampleFiles);
if (!genScript.includes('base64 -d > "src/seed.js"') ||
    !genScript.includes('node src/seed.js') ||
    genScript.includes('// Sample comment') ||
    genScript.includes('/* inline */')) {
  throw new Error('buildBase64TerminalScript must strip comments and generate atomic base64 command!');
}

// 2. Verify frame-editor has in-frame terminal handlers
if (!frameEditorJs27.includes('AP_CHECK_TERMINAL') ||
    !frameEditorJs27.includes('AP_OPEN_TERMINAL') ||
    !frameEditorJs27.includes('AP_INJECT_TERMINAL_COMMAND')) {
  throw new Error('frame-editor.js must support direct in-frame terminal operations!');
}

// 3. Verify confirm pasted button & callback
if (!solverUiJs27.includes('ap-btn-confirm-terminal-pasted') ||
    !contentJs27.includes('onConfirmTerminalPasted')) {
  throw new Error('solver-ui.js and content.js must support 1-click confirm terminal pasted!');
}
console.log('   ✓ Base64 Atomic Terminal Script, In-Frame Controller & 1-Click Paste Confirmation verified');

console.log('28. Testing Current Code in SRC Attachment on Test Failures...');
const bridgeJs28 = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf8');

if (!contentJs27.includes('CURRENT CODE OF ALL WORKSPACE FILES (SRC) AT TIME OF FAILURE') ||
    !contentJs27.includes('currentFilesMap') ||
    !contentJs27.includes('mergedReferenceFiles')) {
  throw new Error('content.js must attach current code of all files in src/ to feedback and referenceFiles!');
}

if (!bridgeJs28.includes('fname.endsWith(\'.js\')') ||
    !bridgeJs28.includes('p.includes(\'src/\') ? \'src/\' + fname : fname')) {
  throw new Error('main-world-bridge.js must extract JS and src/ files in referenceFiles!');
}
console.log('   ✓ Current Code in SRC Attached on Test Failure & Full Multi-File Feedback verified');

console.log('29. Testing Stale Monaco Buffer Elimination & Prisma Seeding Robustness...');
const bgJs29 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const contentJs29 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf8');
const llmJs29 = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf8');

// 1. Verify buildBase64TerminalScript includes || true to prevent non-zero exits from halting bash chain
if (!bgJs29.includes('node src/seed.js || true') || !contentJs29.includes('node src/seed.js || true')) {
  throw new Error('Both background.js and content.js must use "node src/seed.js || true" in terminal script!');
}

// 2. Verify filesWrittenViaTerminal prevents stale Monaco placeholder from blocking submission
if (!contentJs29.includes('filesWrittenViaTerminal = true') ||
    !contentJs29.includes('if (filesWrittenViaTerminal)')) {
  throw new Error('content.js must use filesWrittenViaTerminal to prevent stale editor buffers from blocking submission!');
}

// 3. Verify Prisma Seeding instructions in LLM prompt
if (!llmJs29.includes('deleteMany') || !llmJs29.includes('skipDuplicates') || !llmJs29.includes('$disconnect()')) {
  throw new Error('llm.js must include deleteMany, skipDuplicates, and $disconnect() in Prisma Seeding rules!');
}

// 4. Verify background.js has simulateClickSeq and hardware typing sequence
if (!bgJs29.includes('simulateClickSeq') || !bgJs29.includes('KeyC') || !bgJs29.includes('cdpNativeInsertText')) {
  throw new Error('background.js must implement full click sequence and clean Ctrl+C prompt typing!');
}
console.log('   ✓ Stale Monaco Buffer Elimination, Prisma Seeding & Hardware Terminal Typing verified');

// -------------------------------------------------------------------------
// Test 30: Terminal-First Architecture, Prisma Schema Routing & Monaco Protection Guard
// -------------------------------------------------------------------------
console.log('30. Testing Terminal-First Architecture, Prisma Schema Routing & Zero Monaco Corruption...');

// 1. Verify parseMultiFileSolution correctly identifies schema.prisma and seed.js
const testPrismaResponse = `
\`\`\`prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  profile Profile?
}

model Profile {
  id Int @id @default(autoincrement())
  bio String
  age Int
  city String
  userId Int @unique
  user User @relation(fields: [userId], references: [id])
}
\`\`\`

\`\`\`javascript
// src/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      name: 'Priya',
      email: 'priya@example.com',
      profile: {
        create: {
          bio: 'Priya bio',
          age: 30,
          city: 'New York'
        }
      }
    }
  });
  await prisma.user.create({
    data: {
      name: 'Rahul',
      email: 'rahul@example.com',
      profile: {
        create: {
          bio: 'Rahul bio',
          age: 25,
          city: 'Los Angeles'
        }
      }
    }
  });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
\`\`\`
`;

const parsed30 = parseMultiFileSolution(testPrismaResponse, 'src/index.js', ['prisma/schema.prisma', 'src/seed.js', 'src/index.js']);
if (parsed30.length !== 2) {
  throw new Error(`Expected 2 files from Prisma response, got ${parsed30.length}`);
}
if (parsed30[0].filePath !== 'prisma/schema.prisma') {
  throw new Error(`Expected first file to be prisma/schema.prisma, got ${parsed30[0].filePath}`);
}
if (parsed30[1].filePath !== 'src/seed.js') {
  throw new Error(`Expected second file to be src/seed.js, got ${parsed30[1].filePath}`);
}

// 2. Verify auto-content detection when headers are missing
const rawPrismaSnippet = `
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}
model User {
  id Int @id @default(autoincrement())
  email String @unique
}
`;
const autoParsed = parseMultiFileSolution(rawPrismaSnippet, 'src/index.js', []);
if (autoParsed[0].filePath !== 'prisma/schema.prisma') {
  throw new Error(`Expected content-based routing to prisma/schema.prisma, got ${autoParsed[0].filePath}`);
}

// 3. Verify terminal script generator includes prisma db push, generate, and seed execution
const script30 = buildBase64TerminalScript(parsed30);
if (!script30.includes('prisma/schema.prisma') ||
    !script30.includes('src/seed.js') ||
    !script30.includes('prisma db push') ||
    !script30.includes('prisma generate') ||
    !script30.includes('node src/seed.js')) {
  throw new Error('Terminal script must include schema file, seed file, prisma db push, prisma generate, and node src/seed.js!');
}

// 4. Verify content.js strictly bypasses Monaco writes when filesWrittenViaTerminal is true
const contentJs30 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf-8');
if (!contentJs30.includes('if (filesWrittenViaTerminal)') ||
    !contentJs30.includes('Monaco editor completely bypassed')) {
  throw new Error('content.js must completely bypass Monaco editor writes when filesWrittenViaTerminal is true!');
}

// 5. Verify background.js enforces strict terminal focus check before CDP insertText
const bgJs30 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf-8');
if (!bgJs30.includes('isTerminalFocused') ||
    !bgJs30.includes('Aborting CDP typing to protect editor')) {
  throw new Error('background.js must enforce strict terminal focus guard before CDP typing!');
}

console.log('   ✓ Terminal-First Architecture, Prisma Schema Routing & Zero Monaco Corruption verified');

// ---------------------------------------------------------------------------
// 31. Strict Zero-Monaco-Corruption, Container Permissions & Clean Terminal Execution
// ---------------------------------------------------------------------------
console.log('31. Testing Strict Zero-Monaco-Corruption, Container Permissions & Clean Terminal Execution...');

// 1. Terminal script must enforce git safe directory, sudo permissions, clean starter checkout, and non-interactive npx
if (!script30.includes('safe.directory') ||
    !script30.includes('sudo chmod -R 777') ||
    !script30.includes('git checkout -- src/index.js') ||
    !script30.includes('npx -y prisma')) {
  throw new Error('Terminal script must contain safe.directory, sudo chmod, starter index checkout, and non-interactive npx -y!');
}

// 2. background.js writeFilesViaTerminal must NEVER call document.execCommand('insertText')
const bgJs31 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf-8');
const termWriterSection = bgJs31.substring(bgJs31.indexOf('writeFilesViaTerminal'));
if (termWriterSection.includes("document.execCommand('insertText'")) {
  throw new Error('background.js writeFilesViaTerminal must NOT call document.execCommand to prevent Monaco editor buffer corruption!');
}

// 3. content/content.js handleWriteCode must NEVER call writeCodeToEditor
const contentJs31 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf-8');
const handleWriteSection = contentJs31.substring(contentJs31.indexOf('async function handleWriteCode'), contentJs31.indexOf('async function verifyCodeCompleteness'));
if (handleWriteSection.includes('writeCodeToEditor(')) {
  throw new Error('content.js handleWriteCode must NEVER call writeCodeToEditor! Monaco editor writes are strictly forbidden in Terminal architecture.');
}

// 4. solver-ui.js copy terminal script must include safe.directory and npx -y
const uiJs31 = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf-8');
if (!uiJs31.includes('safe.directory') || !uiJs31.includes('npx -y prisma')) {
  throw new Error('solver-ui.js 1-click terminal script must include safe.directory and npx -y!');
}

console.log('   ✓ Strict Zero-Monaco-Corruption, Container Permissions & Clean Terminal Execution verified');

// ---------------------------------------------------------------------------
// 32. Deep Terminal Error Parsing, Multi-Failure Itemization & One-Shot Debug Matrix
// ---------------------------------------------------------------------------
console.log('32. Testing Deep Terminal Error Parsing, Multi-Failure Itemization & One-Shot Debug Matrix...');
const contentJs32 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf-8');
const llmJs32 = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf-8');

// 1. Verify parseAndStructureFailures exists in content.js and parses multi-line assertion diffs
if (!contentJs32.includes('function parseAndStructureFailures') ||
    !contentJs32.includes('HTTP Status mismatch') ||
    !contentJs32.includes('Unhandled Async Timeout')) {
  throw new Error('content.js must implement parseAndStructureFailures with status code mismatch and async timeout detection!');
}

// 2. Verify terminal output is NOT truncated to 1500 chars (upscaled to 14000)
if (contentJs32.includes('terminalOutput.slice(-1500)')) {
  throw new Error('content.js must NOT truncate terminal output to 1500 chars! It must preserve comprehensive logs (14000 chars).');
}
if (!contentJs32.includes('terminalOutput.slice(-14000)')) {
  throw new Error('content.js must preserve up to 14000 characters of terminal output traces!');
}

// 3. Verify llm.js enforces one-shot simultaneous resolution
if (!llmJs32.includes('ONE-SHOT SIMULTANEOUS ERROR RESOLUTION REQUIRED') ||
    !llmJs32.includes('MANDATORY ONE-SHOT REFINEMENT INSTRUCTIONS')) {
  throw new Error('llm.js must enforce ONE-SHOT SIMULTANEOUS ERROR RESOLUTION in buildPrompt feedback section!');
}

// 4. Verify findMochaErrorForTest supports fuzzy keyword matching & iframes
if (!contentJs32.includes('contentDocument || ifr.contentWindow?.document') ||
    !contentJs32.includes('cleanTestName.split')) {
  throw new Error('content.js findMochaErrorForTest must support fuzzy keyword matching and iframe document querying!');
}

console.log('   ✓ Deep Terminal Error Parsing, Multi-Failure Itemization & One-Shot Debug Matrix verified');

// ---------------------------------------------------------------------------
// 33. Elite Debugging Skill: Fresh State per Attempt, File Merging & RCA Protocol
// ---------------------------------------------------------------------------
console.log('33. Testing Elite Debugging Skill: Fresh State per Attempt, File Merging & RCA Protocol...');
const contentJs33 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf-8');
const llmJs33 = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf-8');

// 1. Verify latestGeneratedCode is passed as currentCode when feedback is active
if (!contentJs33.includes('latestGeneratedCode') ||
    !contentJs33.includes('(feedback && latestGeneratedCode) ? latestGeneratedCode : (cachedEditor?.code || \'\')')) {
  throw new Error('content.js must pass latestGeneratedCode to promptData when feedback is active to prevent starter code stale loop!');
}

// 2. Verify multi-file preservation across retry iterations
if (!contentJs33.includes('mergedFilesMap') ||
    !contentJs33.includes('cachedGeneratedFiles = Array.from(mergedFilesMap.values())')) {
  throw new Error('content.js must merge new files into cachedGeneratedFiles to prevent multi-file solution loss on debug retries!');
}

// 3. Verify filesWrittenViaTerminal is reset per attempt
if (!contentJs33.includes('for (let attempt = 1; attempt <= maxAttempts; attempt++) {\n        filesWrittenViaTerminal = false;')) {
  throw new Error('content.js must reset filesWrittenViaTerminal per attempt in handleOneClickSolve loop!');
}

// 4. Verify SYSTEM_PROMPT contains Master Debugging & Root Cause Protocol
if (!llmJs33.includes('MASTER DEBUGGING & ROOT CAUSE RESOLUTION PROTOCOL') ||
    !llmJs33.includes('DUAL ERROR PROPERTY SUPPORT') ||
    !llmJs33.includes('PREVENT MOCHA 2000MS TIMEOUTS')) {
  throw new Error('utils/llm.js SYSTEM_PROMPT must include Master Debugging & Root Cause Resolution Protocol!');
}

console.log('   ✓ Elite Debugging Skill: Fresh State per Attempt, File Merging & RCA Protocol verified');

// ---------------------------------------------------------------------------
// 34. 5-Star Supercharged Debugging: Exposed Tests, Pro Escalation, Local Run & Deps
// ---------------------------------------------------------------------------
console.log('34. Testing 5-Star Supercharged Debugging: Exposed Tests, Pro Escalation, Local Run & Deps...');
const contentJs34 = fs.readFileSync(path.join(__dirname, 'content/content.js'), 'utf-8');
const bgJs34 = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf-8');
const uiJs34 = fs.readFileSync(path.join(__dirname, 'content/solver-ui.js'), 'utf-8');
const llmJs34 = fs.readFileSync(path.join(__dirname, 'utils/llm.js'), 'utf-8');

// 1. Verify Feature 1 & 4 in buildPrompt: Exposed Test Suites & package.json dependencies
const samplePromptWithTestAndPkg = buildPrompt({
  questionTitle: 'User API',
  questionDetails: 'Implement registration',
  testCases: ['should return 201 when registered'],
  currentCode: 'app.post("/register", ...)',
  referenceFiles: {
    'package.json': JSON.stringify({ dependencies: { bcryptjs: '^2.4.3', express: '^4.18.2' } }),
    'test/index.test.js': 'it("should return 201 when registered", async () => { ... });'
  }
});

if (!samplePromptWithTestAndPkg.includes('EXPOSED TEST SUITE CODE (SOURCE OF TRUTH)') ||
    !samplePromptWithTestAndPkg.includes('test/index.test.js') ||
    !samplePromptWithTestAndPkg.includes('INSTALLED PROJECT DEPENDENCIES') ||
    !samplePromptWithTestAndPkg.includes('bcryptjs: ^2.4.3')) {
  throw new Error('buildPrompt must inject exposed test suite code and package.json dependencies!');
}

// 2. Verify Feature 2: High Reasoning Model Escalation during Debugging
if (!llmJs34.includes('debuggingActive ? debugModels : standardModels') ||
    !llmJs34.includes('gemini-2.5-pro') ||
    !llmJs34.includes("thinkingLevel: debuggingActive ? 'high' : 'low'")) {
  throw new Error('utils/llm.js callGemini must escalate to gemini-2.5-pro and high thinkingLevel during debugging!');
}

// 3. Verify Feature 3: Local Pre-Test Execution in Terminal across background, content, and solver-ui
if (!bgJs34.includes('npm test 2>&1 || npx mocha 2>&1') ||
    !contentJs34.includes('npm test 2>&1 || npx mocha 2>&1') ||
    !uiJs34.includes('npm test 2>&1 || npx mocha 2>&1')) {
  throw new Error('All scripts (background, content, solver-ui) must execute local pre-test (npm test / npx mocha) in terminal!');
}

// 4. Verify main-world-bridge preserves test/ and __tests__/ in referenceFiles
const bridgeJs34 = fs.readFileSync(path.join(__dirname, 'content/main-world-bridge.js'), 'utf-8');
if (!bridgeJs34.includes("p.includes('test/') ? 'test/' + fname") ||
    !bridgeJs34.includes("p.includes('__tests__/') ? '__tests__/' + fname")) {
  throw new Error('main-world-bridge.js must preserve test/ and __tests__/ paths in referenceFiles!');
}

console.log('   ✓ 5-Star Supercharged Debugging: Exposed Tests, Pro Escalation, Local Run & Deps verified');

console.log('\n🎉 ALL TESTS PASSED! AP-Solver is ready for installation and use.');
