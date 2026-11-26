// tests/test_background.js - Tests for manifest, syntax across all modules, CDP driver, editor/terminal isolation & workspace runner
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { execSync, spawnSync } from 'child_process';
import { ROOT_DIR, readRepoFile, readBundle, assert, installChromeMock } from './helpers.js';
import { stripComments } from '../utils/code-format.js';
import { buildLocalTestSpec } from '../utils/local-test-planner.js';
import { buildLocalTestRunnerScript } from '../background/workspace.js';

export async function runBackgroundTests() {
  console.log('🛠️  [Suite 2/3] Running manifest, syntax & background/ tests...');

  // 1. Manifest MV3 validation
  const manifest = JSON.parse(readRepoFile('manifest.json'));
  assert(manifest.manifest_version === 3, 'Manifest must be v3');
  for (const perm of ['storage', 'scripting', 'debugger']) {
    assert(manifest.permissions.includes(perm), `Missing ${perm} permission`);
  }
  const contentMatches = manifest.content_scripts.flatMap(cs => cs.matches);
  assert(!contentMatches.includes('<all_urls>'), 'Content scripts must stay restricted to newtonschool.co');
  for (const cs of manifest.content_scripts) {
    for (const jsFile of cs.js) {
      assert(fs.existsSync(path.join(ROOT_DIR, jsFile)), `Manifest references missing script: ${jsFile}`);
    }
  }
  console.log('   ✓ manifest.json valid MV3 & all declared content scripts exist');

  // 2. Verify all source & test files exist, are non-empty & pass `node --check`
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'background/cdp.js',
    'background/editor.js',
    'background/terminal.js',
    'background/workspace.js',
    'utils/llm.js',
    'utils/code-format.js',
    'utils/commands.js',
    'utils/file-planner.js',
    'utils/attempt-history.js',
    'utils/local-test-planner.js',
    'utils/orchestrator.js',
    'utils/prompts.js',
    'utils/providers.js',
    'content/shared.js',
    'content/dom-scrapers.js',
    'content/error-parser.js',
    'content/solver-ui.js',
    'content/content.js',
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
    'icons/icon128.png',
    'tests/helpers.js',
    'tests/test_utils.js',
    'tests/test_background.js',
    'tests/test_content.js'
  ];
  for (const f of requiredFiles) {
    const p = path.join(ROOT_DIR, f);
    assert(fs.existsSync(p), `Missing required file: ${f}`);
    assert(fs.statSync(p).size > 0, `Empty file: ${f}`);
    if (f.endsWith('.js')) {
      execSync(`node --check "${p}"`, { stdio: 'pipe' });
    }
  }
  console.log(`   ✓ All ${requiredFiles.length} modular files exist, are non-empty, and pass syntax checks`);

  // 3. Import background.js cleanly in Node
  installChromeMock();
  const bgMod = await import('../background.js');
  assert(typeof bgMod.buildBase64TerminalScript === 'function', 'background.js must export buildBase64TerminalScript');

  const cdpSrc = readRepoFile('background/cdp.js');
  const edSrc = readRepoFile('background/editor.js');
  const termSrc = readRepoFile('background/terminal.js');
  const wsSrc = readRepoFile('background/workspace.js');
  const routerSrc = readRepoFile('background.js');
  const allBgSrc = readBundle(['background.js', 'background/cdp.js', 'background/editor.js', 'background/terminal.js', 'background/workspace.js']);

  // 4. CDP Driver & Safe Explorer Targeting
  assert(
    cdpSrc.includes('attachCDP') &&
    cdpSrc.includes('cdpNativeDblClick') &&
    cdpSrc.includes('cdpClickElementInWorkspace') &&
    cdpSrc.includes('cdpSaveFile') &&
    cdpSrc.includes('Input.dispatchMouseEvent') &&
    cdpSrc.includes('Input.dispatchKeyEvent') &&
    cdpSrc.includes('Input.insertText') &&
    cdpSrc.includes("type: 'keyDown'") &&
    cdpSrc.includes("text = '\\r'") &&
    cdpSrc.includes("type: 'char'") &&
    cdpSrc.includes('cdpNativeInsertText') &&
    cdpSrc.includes('KeyC') &&
    cdpSrc.includes('PASS 1') &&
    cdpSrc.includes('PASS 2') &&
    cdpSrc.includes('Skipped invalid target filename') &&
    cdpSrc.includes('ArrowRight') &&
    cdpSrc.includes('rowR.left + 12') &&
    cdpSrc.includes("(iconR.left && iconR.left > r.left) ? (iconR.left + 8) : (r.left + 24)"),
    'background/cdp.js missing native CDP hardware driver or safe tree icon navigation'
  );
  assert(
    !cdpSrc.includes("src.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter'"),
    'Must never dispatch Enter on folder tree rows'
  );

  // 5. Editor isolation & target guards
  assert(
    edSrc.includes('detectActiveFile') &&
    edSrc.includes('scanWorkspaceFiles') &&
    edSrc.includes('if ((!targetPath || isTargetActive)') &&
    edSrc.includes('normActive.length > 0 && normBase.length > 0') &&
    edSrc.includes('No valid workspace editor in this frame') &&
    edSrc.includes("!isWorkbench && document.querySelector('iframe')") &&
    edSrc.includes('Date.now() - tStart < 3500') &&
    !edSrc.includes("allEditors[0] || document.querySelector('.monaco-editor')"),
    'background/editor.js missing workbench isolation, nested path extractor, or target guards'
  );
  assert(edSrc.includes('extractWorkspaceRelPath') && edSrc.includes('pruneFlatTabDuplicates'), 'background/editor.js missing extractWorkspaceRelPath or pruneFlatTabDuplicates');

  // 6. Terminal MAIN world reader, WebGL safety & zero-Monaco-corruption guarantee
  const readTermSec = termSrc.substring(termSrc.indexOf('export async function readIntegratedTerminalText'), termSrc.indexOf('export async function decodeTerminalJsonPayload'));
  const capSec = termSrc.substring(termSrc.indexOf('export async function runTerminalCommandWithCapture'), termSrc.indexOf('export async function writeFilesViaTerminal'));
  const writerSec = termSrc.substring(termSrc.indexOf('export async function writeFilesViaTerminal'));

  assert(
    readTermSec.includes("world: 'MAIN'") &&
    termSrc.includes('resolveTopOffset') &&
    termSrc.includes("pointerEvents = 'none'") &&
    termSrc.includes('isTerminalFocused') &&
    termSrc.includes('Aborting CDP typing to protect editor') &&
    capSec.includes('!baseText || !baseText.trim()') &&
    capSec.includes('unreadable: true') &&
    !stripComments(writerSec).includes('document.execCommand'),
    'background/terminal.js missing MAIN-world buffer read, WebGL safety, or focus protection'
  );

  // 7. Workspace probe, local tests & setup command runner
  assert(
    wsSrc.includes("const S='===AP'+'_CTX_START==='") &&
    wsSrc.includes('main:p.main') &&
    wsSrc.includes('nodemon.json') &&
    wsSrc.includes('README.md') &&
    wsSrc.includes('needsMissingTestDir') &&
    wsSrc.includes('probeWorkspaceViaTerminal') &&
    wsSrc.includes('runLocalTestsViaTerminal') &&
    wsSrc.includes('runTerminalCommandsViaTerminal') &&
    wsSrc.includes('no_local_tests') &&
    !stripComments(wsSrc).includes('document.execCommand'),
    'background/workspace.js missing workspace probe, root entrypoint scan, missing-test-dir check, or command runner'
  );

  // 8. Message router operations
  for (const op of ['AP_KEEPALIVE', 'AP_GENERATE', 'AP_BUILD_FILE_PLAN', 'AP_ENFORCE_FILE_PLAN', 'AP_ANALYZE_TERMINAL', 'AP_READ_INTEGRATED_TERMINAL', 'AP_LOAD_ATTEMPT_HISTORY', 'AP_RECORD_ATTEMPT', 'AP_SAVE_ATTEMPT_HISTORY', 'AP_QUERY_EDITOR', 'AP_PROBE_WORKSPACE', 'AP_RUN_LOCAL_TESTS', 'AP_RUN_TERMINAL_COMMANDS', 'AP_WRITE_TERMINAL', 'AP_CLEAN_EDITOR_ARTIFACTS', 'AP_TEST_CONNECTIONS']) {
    assert(routerSrc.includes(op), `background.js router missing op: ${op}`);
  }
  assert(allBgSrc.includes('monaco.model.setValue') && allBgSrc.includes('dom.insertTextAndPaste'), 'Missing fallback editor strategies');

  // 9. Real in-terminal Node local test runner execution on static HTML routing + CLI I/O + failing HTTP/export cases
  const runRunnerInTmp = (filesMap, spec) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ltest-'));
    try {
      for (const [rel, body] of Object.entries(filesMap)) {
        const full = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body, 'utf8');
      }
      const script = buildLocalTestRunnerScript(Object.keys(filesMap), spec);
      const res = spawnSync('node', ['-e', script], { cwd: tmpDir, encoding: 'utf8', timeout: 15000 });
      const out = (res.stdout || '') + '\n' + (res.stderr || '');
      const m = out.match(/===AP_LTEST_START===\s*GZ:([A-Za-z0-9+/=\s]+?)\s*===AP_LTEST_END===/);
      assert(Boolean(m), 'Real local test runner failed to emit GZ payload:\n' + out);
      return JSON.parse(zlib.gunzipSync(Buffer.from(m[1].replace(/\s+/g, ''), 'base64')).toString('utf8'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  const htmlSpec = buildLocalTestSpec({
    questionTitle: 'Multi-Page Website Routing',
    questionDetails: [
      'services.html | Welcome to Services Page',
      'team.html | Welcome to Team Page',
      'error.html | 404 Page does not exist',
      'Visiting http://localhost:8080/ should display the Services page.',
      'Visiting http://localhost:8080/team should display the Team page.',
      'Visiting any undefined route should display the Error page and return status code 404.'
    ].join('\n'),
    testCases: ['should serve Services Page for "/" route', 'should return status code 404 for undefined routes'],
    filesToWrite: ['src/index.js', 'services.html', 'team.html', 'error.html'],
    packageJsonStr: JSON.stringify({ main: 'src/index.js', scripts: { test: 'mocha __tests__' } })
  });
  const htmlPass = runRunnerInTmp({
    'package.json': JSON.stringify({ main: 'src/index.js', scripts: { test: 'mocha __tests__' } }),
    'services.html': '<h1>Welcome to Services Page</h1>',
    'team.html': '<h1>Welcome to Team Page</h1>',
    'error.html': '<h1>404 Page does not exist</h1>',
    'src/index.js': `
      const http = require('http');
      const fs = require('fs');
      const path = require('path');
      const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const server = http.createServer((req, res) => {
        if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(read('services.html')); }
        if (req.url === '/team') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(read('team.html')); }
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end(read('error.html'));
      });
      server.listen(8080);
    `
  }, htmlSpec);
  assert(
    htmlPass.skip === false &&
    htmlPass.exitCode === 0 &&
    htmlPass.failed === 0 &&
    htmlPass.passed >= 4 &&
    htmlPass.cases.some(c => c.kind === 'http' && c.ok && c.input.includes('GET /team')),
    'Real HTTP static server pre-test should pass all routes: ' + JSON.stringify(htmlPass)
  );

  // Verify real failure detection when server returns 500 and symbol export is missing
  const mvcSpec = buildLocalTestSpec({
    questionTitle: 'Ride Share Engine',
    questionDetails: 'src/models/driver.model.js: Exports findAvailableDriver(), updateDriverAvailability(id, status)\nGET /team route',
    filesToWrite: ['src/index.js', 'src/models/driver.model.js'],
    packageJsonStr: JSON.stringify({ main: 'src/index.js', scripts: { test: 'mocha __tests__' } })
  });
  const mvcFail = runRunnerInTmp({
    'package.json': JSON.stringify({ main: 'src/index.js', scripts: { test: 'mocha __tests__' } }),
    'src/models/driver.model.js': 'module.exports = { findAvailableDriver: () => ({ id: 1 }) };',
    'src/index.js': 'require("http").createServer((req, res) => { res.writeHead(500); res.end("boom"); }).listen(3000);'
  }, mvcSpec);
  assert(
    mvcFail.exitCode === 1 &&
    mvcFail.failed >= 2 &&
    mvcFail.cases.some(c => !c.ok && c.kind === 'export' && c.name.includes('updateDriverAvailability')) &&
    mvcFail.cases.some(c => !c.ok && c.kind === 'http'),
    'Real pre-test must detect missing exports & HTTP 5xx failure: ' + JSON.stringify(mvcFail)
  );

  // Verify CLI stdin/stdout real execution
  const cliSpec = buildLocalTestSpec({
    questionTitle: 'Sum Two Numbers CLI',
    questionDetails: 'Sample Input:\n```\n4 9\n```\nSample Output:\n```\n13\n```',
    filesToWrite: ['index.js'],
    packageJsonStr: JSON.stringify({ main: 'index.js' })
  });
  const cliPass = runRunnerInTmp({
    'package.json': JSON.stringify({ main: 'index.js' }),
    'index.js': 'const fs = require("fs"); const [a,b] = fs.readFileSync(0,"utf8").trim().split(/\\s+/).map(Number); console.log(a + b);'
  }, cliSpec);
  assert(
    cliPass.exitCode === 0 && cliPass.passed >= 2 && cliPass.cases.some(c => c.kind === 'cli' && c.ok && c.actual === '13'),
    'Real CLI stdin/stdout pre-test failed: ' + JSON.stringify(cliPass)
  );

  console.log('   ✓ CDP driver, editor isolation, MAIN-world terminal reader, command handlers & live local runner verified');
}
