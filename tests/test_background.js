// tests/test_background.js - Tests for manifest, syntax across all modules, CDP driver, editor/terminal isolation & workspace runner
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ROOT_DIR, readRepoFile, readBundle, assert, installChromeMock } from './helpers.js';
import { stripComments } from '../utils/code-format.js';

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
  assert(edSrc.includes('extractWorkspaceRelPath'), 'background/editor.js missing extractWorkspaceRelPath');

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
    wsSrc.includes('probeWorkspaceViaTerminal') &&
    wsSrc.includes('runLocalTestsViaTerminal') &&
    wsSrc.includes('runTerminalCommandsViaTerminal') &&
    wsSrc.includes('no_local_tests') &&
    !stripComments(wsSrc).includes('document.execCommand'),
    'background/workspace.js missing workspace probe, local pre-tests, or command runner'
  );

  // 8. Message router operations
  for (const op of ['AP_KEEPALIVE', 'AP_GENERATE', 'AP_QUERY_EDITOR', 'AP_PROBE_WORKSPACE', 'AP_RUN_LOCAL_TESTS', 'AP_RUN_TERMINAL_COMMANDS', 'AP_WRITE_TERMINAL', 'AP_CLEAN_EDITOR_ARTIFACTS']) {
    assert(routerSrc.includes(op), `background.js router missing op: ${op}`);
  }
  assert(allBgSrc.includes('monaco.model.setValue') && allBgSrc.includes('dom.insertTextAndPaste'), 'Missing fallback editor strategies');
  console.log('   ✓ CDP driver, editor isolation, MAIN-world terminal reader & command handlers verified');
}
