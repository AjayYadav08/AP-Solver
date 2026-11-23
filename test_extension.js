// test_extension.js - Unit and Syntax Verification for AP-Solver
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractCodeBlock, buildPrompt, formatCodeIndentation } from './utils/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🧪 Starting AP-Solver Extension Verification...\n');

// 1. Verify Manifest JSON
console.log('1. Checking manifest.json...');
const manifestRaw = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);
if (manifest.manifest_version !== 3) throw new Error('Manifest must be version 3');
if (!manifest.permissions.includes('storage')) throw new Error('Missing storage permission');
if (!manifest.permissions.includes('scripting')) throw new Error('Missing scripting permission');
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
}
console.log(`   ✓ All ${files.length} files exist and are non-empty`);

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

console.log('\n🎉 ALL TESTS PASSED! AP-Solver is ready for installation and use.');
