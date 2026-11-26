// tests/test_content.js - Tests for content/ scrapers, error parser, UI delegation & autonomous 5-attempt lifecycle
import { readRepoFile, readBundle, assert } from './helpers.js';

export async function runContentTests() {
  console.log('🖥️  [Suite 3/3] Running content/, frame & UI tests...');

  const sharedSrc = readRepoFile('content/shared.js');
  const scraperSrc = readRepoFile('content/dom-scrapers.js');
  const parserSrc = readRepoFile('content/error-parser.js');
  const uiSrc = readRepoFile('content/solver-ui.js');
  const contentSrc = readRepoFile('content/content.js');
  const frameSrc = readRepoFile('content/frame-editor.js');
  const bridgeSrc = readRepoFile('content/main-world-bridge.js');
  const cssSrc = readRepoFile('content/styles.css');
  const optionsHtml = readRepoFile('options/options.html');
  const allTopContent = readBundle(['content/shared.js', 'content/dom-scrapers.js', 'content/error-parser.js', 'content/solver-ui.js', 'content/content.js']);

  // 1. Scrapers, 3-tab navigation & sub-second exits
  assert(
    scraperSrc.includes('switchToQuestionTab') &&
    scraperSrc.includes('switchToSubmissionsTab') &&
    scraperSrc.includes('switchToTerminalTab') &&
    scraperSrc.includes('clickRailTab') &&
    scraperSrc.includes('testNameElements') &&
    scraperSrc.includes('uniqueTestElements') &&
    scraperSrc.includes('findMochaErrorForTest') &&
    scraperSrc.includes('readSubmissionResultsWithErrors') &&
    scraperSrc.includes('readTerminalOutput'),
    'content/dom-scrapers.js missing navigation or extraction helpers'
  );
  const switchTermSec = scraperSrc.substring(scraperSrc.indexOf('function switchToTerminalTab'), scraperSrc.indexOf('async function readTerminalOutput'));
  assert(!switchTermSec.includes("'button, [role=\"tab\"], div'"), 'switchToTerminalTab must only match rail tab/button elements');

  // 2. Main-world bridge & frame-editor isolation + xterm CR execution
  assert(
    bridgeSrc.includes('detectActiveFileName') &&
    bridgeSrc.includes('navigateToTargetFile') &&
    bridgeSrc.includes('createNewFileInWorkspace') &&
    bridgeSrc.includes('AP_CLEAN_EDITOR_ARTIFACTS') &&
    bridgeSrc.includes('sentEnterViaCore') &&
    bridgeSrc.includes("sendRaw('\\r')") &&
    bridgeSrc.includes('isTreeRow') &&
    frameSrc.includes('AP_CHECK_TERMINAL') &&
    frameSrc.includes('AP_OPEN_TERMINAL') &&
    frameSrc.includes('AP_INJECT_TERMINAL_COMMAND') &&
    frameSrc.includes('AP_CLEAN_EDITOR_ARTIFACTS') &&
    frameSrc.includes('sentEnterViaCore'),
    'content/main-world-bridge.js or frame-editor.js missing required handlers'
  );
  const frameTermSec = frameSrc.substring(frameSrc.indexOf('AP_INJECT_TERMINAL_COMMAND'), frameSrc.indexOf('function findIntegratedTerminal'));
  assert(!frameTermSec.includes("new ClipboardEvent('paste'") && !frameTermSec.includes("document.execCommand('insertText'"), 'frame-editor terminal injector must never use synthetic paste or execCommand');

  // 3. UI & Shared Bash Script Delegation (zero duplicate builders)
  assert(
    uiSrc.includes('ap-multi-files-box') &&
    uiSrc.includes('ap-btn-copy-terminal-script') &&
    uiSrc.includes('buildTerminalBashScript') &&
    !uiSrc.includes('ap-info-box') &&
    !uiSrc.includes('ap-btn-copy-terminal-big') &&
    !uiSrc.includes('ap-btn-confirm-terminal-pasted') &&
    cssSrc.includes('min-height: 320px') &&
    sharedSrc.includes('safe.directory') &&
    sharedSrc.includes('npx -y prisma') &&
    sharedSrc.includes('sed -i') &&
    optionsHtml.includes('gemini-2.5-pro') &&
    optionsHtml.includes('up to 5 attempts'),
    'UI layout, script delegation, or options.html checks failed'
  );

  // 4. Content orchestrator 6-step loop, 5 attempts, anti-spam & zero Monaco corruption
  assert(
    contentSrc.includes('[Step 1/6]') &&
    contentSrc.includes('[Step 2/6]') &&
    contentSrc.includes('[Step 3/6]') &&
    contentSrc.includes('[Step 4/6]') &&
    contentSrc.includes('[Step 5/6]') &&
    contentSrc.includes('[Step 6/6]') &&
    contentSrc.includes('let maxAttempts = ui.options.autoRetry ? 5 : 1') &&
    contentSrc.includes('for (let attempt = 1; attempt <= maxAttempts; attempt++) {\n        filesWrittenViaTerminal = false;') &&
    contentSrc.includes('maxLocalTries') &&
    contentSrc.includes('async function verifyCodeCompleteness') &&
    contentSrc.includes('Submission BLOCKED: Do not click submit until each required file\'s code is updated!') &&
    contentSrc.includes('consecutivePassedChecks') &&
    contentSrc.includes('Instant Exit: All') &&
    contentSrc.includes("sendMsg({ op: 'AP_PROBE_WORKSPACE' }") &&
    contentSrc.includes("sendMsg({ op: 'AP_RUN_LOCAL_TESTS'") &&
    contentSrc.includes('AP_RUN_TERMINAL_COMMANDS') &&
    allTopContent.includes('CURRENT CODE OF ALL WORKSPACE FILES (SRC) AT TIME OF FAILURE') &&
    allTopContent.includes('terminalOutput.slice(-14000)') &&
    !allTopContent.includes('terminalOutput.slice(-1500)'),
    'content/content.js 6-step autonomous lifecycle or debugging contract failed'
  );
  const handleWriteSec = contentSrc.substring(contentSrc.indexOf('async function handleWriteCode'), contentSrc.indexOf('async function verifyCodeCompleteness'));
  const verifySec = contentSrc.substring(contentSrc.indexOf('async function verifyCodeCompleteness'), contentSrc.indexOf('async function handleSubmit'));
  assert(!handleWriteSec.includes('writeCodeToEditor(') && !verifySec.includes('writeCodeToEditor('), 'Automated flow must never call writeCodeToEditor!');

  // 5. Execute error-parser runtime tests (Mocha EOF, ANSI fallback & 0/13 PENDING recovery)
  assert(!parserSrc.includes('\\z'), 'Invalid RegExp escape \\z detected');
  const dStart = parserSrc.indexOf('  function diagnoseErrorMessage(');
  const bStart = parserSrc.indexOf('  // Shared helper: Builds comprehensive debugging prompt');
  assert(dStart !== -1 && bStart !== -1, 'Could not locate error-parser slice');
  const runParser = new Function('terminalOutput', 'subRes', `${parserSrc.slice(dStart, bStart)}\nreturn parseAndStructureFailures(terminalOutput, subRes);`);

  const mochaNoFooter = [
    '  1) POST /login: should set session cookie',
    '  2) Protected route: returns 401 without token',
    '',
    '  1) Auth API',
    '       POST /login: should set session cookie:',
    '     AssertionError: expected 500 to equal 200',
    '      at Context.<anonymous> (test/auth.test.js:25:16)',
    '',
    '  2) Protected route: returns 401 without token:',
    '     AssertionError: expected 200 to equal 401'
  ].join('\n');
  const parsedMocha = runParser(mochaNoFooter, null);
  assert(parsedMocha.length === 2 && parsedMocha[0].title.includes('POST /login') && parsedMocha[1].title.includes('Protected route'), 'Mocha EOF parser failed');

  const rawAnsi = '\u001b[31mAssertionError: expected 400 to equal 201\u001b[0m\n    at Context.<anonymous> (test/api.test.js:12:10)';
  const parsedAnsi = runParser(rawAnsi, null);
  assert(parsedAnsi.length > 0 && parsedAnsi[0].diagnosis.includes('HTTP Status mismatch'), 'ANSI AssertionError parser failed');

  const subResPending0of13 = {
    passed: 0,
    total: 13,
    passedCount: 0,
    totalCount: 13,
    tests: [
      { name: '1. should set HTTP-only session cookie on login', pass: false, fail: false, status: 'PENDING', error: '' },
      { name: '2. should restore user session from cookie', pass: false, fail: false, status: 'PENDING', error: '' }
    ]
  };
  const buildOnlyLog = Array.from({ length: 65 }, (_, i) => `step log line ${i + 1}`).join('\n') + '\nProcess finished with non-zero exit code 1';
  const recovered = runParser(buildOnlyLog, subResPending0of13);
  assert(recovered.length >= 3 && recovered.some(item => item.title.includes('HTTP-only session cookie')), '0/13 PENDING failure recovery failed');

  console.log('   ✓ Content scrapers, UI delegation, Mocha/ANSI & 0/13 PENDING recovery verified');
}
