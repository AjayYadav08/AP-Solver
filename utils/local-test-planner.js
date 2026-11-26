// utils/local-test-planner.js - Question-specific local test strategy analyzer & probe builder

const EXCLUDED_ROUTE_PREFIXES = /^\/(?:src|app|usr|etc|var|tmp|home|node_modules|dev|test|tests|__tests__|public|views|assets|text|application|image|multipart)\b/i;
const ASSET_EXT_RE = /\.(?:js|mjs|cjs|ts|tsx|jsx|json|html?|css|scss|md|txt|png|jpe?g|svg|prisma|py|yml|yaml|env|lock)$/i;

/** Normalize a workspace relative path consistently without introducing extra dependencies. */
function normPath(p = '') {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Detect language, module system, runtime framework, entrypoint, and required checks. */
export function detectRuntimeEnvironment({
  questionTitle = '',
  questionDetails = '',
  filesToWrite = [],
  referenceFiles = [],
  packageJsonStr = '',
  terminalPreAnalysis = null
} = {}) {
  let pkg = {};
  let hasPkg = false;
  try {
    if (packageJsonStr && typeof packageJsonStr === 'string') {
      pkg = JSON.parse(packageJsonStr);
      hasPkg = true;
    }
  } catch (e) {}

  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const allFilePaths = [...new Set([
    ...(filesToWrite || []).map(f => normPath(typeof f === 'string' ? f : f?.filePath)),
    ...(referenceFiles || []).map(f => normPath(typeof f === 'string' ? f : f?.filePath)),
    ...(terminalPreAnalysis?.discoveredFiles || []).map(f => normPath(f))
  ].filter(Boolean))];

  const pyFiles = allFilePaths.filter(f => /\.py$/i.test(f));
  const tsFiles = allFilePaths.filter(f => /\.tsx?$/i.test(f) && !/\.d\.ts$/i.test(f));
  const jsFiles = allFilePaths.filter(f => /\.(?:js|mjs|cjs)$/i.test(f));
  const htmlFiles = allFilePaths.filter(f => /\.html?$/i.test(f));
  const prismaFiles = allFilePaths.filter(f => /\.prisma$/i.test(f));

  const qLower = `${questionTitle}\n${questionDetails}`.toLowerCase();
  const isPython = pyFiles.length > 0 && jsFiles.length === 0 && !hasPkg;
  const isTypeScript = tsFiles.length > 0 || Boolean(deps.typescript);
  const language = isPython ? 'python' : isTypeScript ? 'typescript' : 'javascript';
  const moduleSystem = pkg.type === 'module' || jsFiles.some(f => /\.mjs$/i.test(f)) ? 'esm' : 'commonjs';

  const hasExpress = Boolean(deps.express) || /\bexpress\s*\(/i.test(questionDetails) || /\brequire\(['"]express['"]\)/i.test(questionDetails);
  const hasHttpServer = hasExpress ||
    /\bcreateServer\b|\bhttp\.createServer\b|\bVisiting\s+http:\/\/localhost/i.test(questionDetails) ||
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[a-zA-Z0-9:_-]*/i.test(questionDetails);
  const hasPrisma = prismaFiles.length > 0 || Boolean(deps['@prisma/client'] || deps.prisma) || /\bprisma\b/i.test(qLower);

  let framework = 'node-cli';
  if (isPython) {
    framework = 'python-cli';
  } else if (hasExpress) {
    framework = 'express';
  } else if (hasHttpServer && htmlFiles.length > 0) {
    framework = 'node-http-static';
  } else if (hasHttpServer) {
    framework = 'node-http';
  } else if (hasPrisma) {
    framework = 'prisma-node';
  }

  // Determine canonical entry file
  const entryCandidates = [
    normPath(pkg.main),
    'src/index.js', 'index.js', 'src/server.js', 'server.js', 'src/app.js', 'app.js',
    'src/index.ts', 'index.ts', 'main.py', 'app.py', 'solution.py'
  ].filter(Boolean);

  let entryFile = '';
  for (const cand of entryCandidates) {
    if (allFilePaths.includes(cand)) {
      entryFile = cand;
      break;
    }
  }
  if (!entryFile) {
    entryFile = jsFiles[0] || tsFiles[0] || pyFiles[0] || allFilePaths[0] || '';
  }

  const testScript = String(scripts.test || '').trim();
  const hasTestScript = Boolean(testScript && !/no test specified/i.test(testScript));
  const testDirsPresent = allFilePaths.some(f => /(?:^|\/)(?:__tests__|tests?)\//i.test(f) || /\.(?:test|spec)\.(?:js|mjs|cjs|ts|py)$/i.test(f));

  const buildCommands = [];
  if (scripts.build && !/no build/i.test(scripts.build)) {
    buildCommands.push('npm run build');
  } else if (isTypeScript) {
    buildCommands.push('npx tsc --noEmit');
  }
  if (hasPrisma) {
    buildCommands.push('npx prisma validate');
  }
  for (const cmd of (terminalPreAnalysis?.requiredCommands || [])) {
    if (cmd && !buildCommands.includes(cmd)) buildCommands.push(cmd);
  }

  return {
    language,
    moduleSystem,
    framework,
    entryFile,
    hasTestScript,
    testScript,
    testDirsPresent,
    hasExpress,
    hasHttpServer,
    hasPrisma,
    htmlFiles,
    jsFiles,
    tsFiles,
    pyFiles,
    allFilePaths,
    deps: Object.keys(deps),
    buildCommands: buildCommands.slice(0, 6)
  };
}

/** Extract concrete file checks (e.g., required HTML files and exact page text expectations). */
export function extractFileContentChecks(questionDetails = '', filesToWrite = []) {
  const checks = [];
  const seen = new Set();
  const text = String(questionDetails || '');

  // Match HTML / static file tables: e.g. `services.html  Welcome to Services Page` or `services.html | Welcome to Services Page`
  const lineRegex = /(?:^|\n)\s*[-*|]?\s*`?([a-zA-Z0-9_./-]+\.(?:html?|css|txt))`?\s*(?:\t|\||:|->|—|-)\s*`?([^\n|`]{4,120})`?/gi;
  for (const m of text.matchAll(lineRegex)) {
    const fileName = normPath(m[1]);
    const expectedText = (m[2] || '').trim().replace(/^["']|["']$/g, '');
    if (!fileName || !expectedText || /^(?:file|page|content|description)$/i.test(fileName)) continue;
    if (/^(?:html file content|file structure)/i.test(expectedText)) continue;
    const key = fileName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push({ filePath: fileName, mustContain: expectedText });
  }

  // Also ensure any .html files mentioned directly in filesToWrite exist on disk
  for (const f of (filesToWrite || [])) {
    const fp = normPath(typeof f === 'string' ? f : f?.filePath);
    if (!fp || !/\.html?$/i.test(fp)) continue;
    const base = fp.split('/').pop().toLowerCase();
    if (![...seen].some(k => k === fp.toLowerCase() || k.endsWith('/' + base) || base === k)) {
      seen.add(fp.toLowerCase());
      checks.push({ filePath: fp, mustContain: '' });
    }
  }

  return checks.slice(0, 10);
}

/** Extract explicitly requested module exports scoped to exact workspace JS files. */
export function extractExpectedModuleExports(questionDetails = '', filesToWrite = []) {
  const results = [];
  const seen = new Set();
  const text = String(questionDetails || '');
  const targetFiles = new Set((filesToWrite || []).map(f => normPath(typeof f === 'string' ? f : f?.filePath)).filter(Boolean));

  // Match sections starting with a JS file path like `src/models/driver.model.js:` followed by `Exports foo(), bar(...)`
  const sectionRegex = /(?:^|\n)\s*(?:[-*#]+\s*)?`?((?:src\/)?[a-zA-Z0-9_./-]+\.(?:js|mjs|cjs))`?\s*:?\s*([^\n]+(?:\n(?!\s*(?:src\/)?[a-zA-Z0-9_./-]+\.(?:js|mjs|cjs)\s*:)[^\n]+){0,8})/gi;
  for (const m of text.matchAll(sectionRegex)) {
    const relPath = normPath(m[1]);
    const block = m[2] || '';
    if (!relPath || (/^\d/.test(relPath))) continue;
    // Prefer files we actually expect in the workspace or targets
    const matchingTarget = [...targetFiles].find(t => t === relPath || t.endsWith('/' + relPath)) || relPath;

    const exportsFound = [];
    // Pattern 1: "Exports findAvailableDriver(), updateDriverAvailability(id, status)"
    for (const expMatch of block.matchAll(/\bExports?\s+([a-zA-Z_$][\w$]*(?:\s*\([^)]*\))?(?:\s*,\s*[a-zA-Z_$][\w$]*(?:\s*\([^)]*\))?)*)/g)) {
      for (const part of expMatch[1].split(',')) {
        const sym = part.trim().replace(/\([^)]*\)$/, '').trim();
        if (sym && !/^(?:a|an|the|function|middleware|router|object|and|or)$/i.test(sym) && !exportsFound.includes(sym)) {
          exportsFound.push(sym);
        }
      }
    }
    // Pattern 2: "`authenticateToken` middleware" or "exports `foo`"
    for (const mwMatch of block.matchAll(/\bexports?\s+(?:a\s+)?`?([a-zA-Z_$][\w$]*)`?/gi)) {
      const sym = mwMatch[1].trim();
      if (sym && !/^(?:an?|the|function|middleware|router|express|app|default|module)$/i.test(sym) && !exportsFound.includes(sym)) {
        exportsFound.push(sym);
      }
    }

    if (exportsFound.length > 0 && !seen.has(matchingTarget)) {
      seen.add(matchingTarget);
      results.push({ filePath: matchingTarget, symbols: exportsFound.slice(0, 8) });
    }
  }

  return results.slice(0, 8);
}

/** Check whether a extracted string looks like a valid HTTP route path (not a filename/MIME type). */
function isCleanHttpRoute(route) {
  if (!route || typeof route !== 'string') return false;
  if (!route.startsWith('/')) return false;
  if (route.startsWith('//')) return false;
  if (EXCLUDED_ROUTE_PREFIXES.test(route)) return false;
  if (ASSET_EXT_RE.test(route)) return false;
  if (route.length > 100) return false;
  return true;
}

/** Build deterministic HTTP endpoint probes directly from question specs and test case descriptions. */
export function extractHttpProbes(questionDetails = '', testCases = [], fileChecks = []) {
  const probes = [];
  const seenKey = new Set();
  const text = String(questionDetails || '');
  const tcLines = Array.isArray(testCases) ? testCases.map(tc => typeof tc === 'string' ? tc : (tc?.name || tc?.title || '')).filter(Boolean) : [];
  const combined = `${text}\n${tcLines.join('\n')}`;

  const addProbe = (probe) => {
    const method = (probe.method || 'GET').toUpperCase();
    const path = probe.path || '/';
    const tag = `${method}:${path}:${probe.kind || 'basic'}`;
    if (seenKey.has(tag)) return;
    seenKey.add(tag);
    probes.push({ ...probe, method, path });
  };

  // 1. Static HTML Page Routing probes: e.g. `Visiting http://localhost:8080/team should display the Team page`
  for (const m of combined.matchAll(/Visiting\s+https?:\/\/localhost(?::\d+)?(\/[^\s"'`,)]*)\s+should\s+(?:display|serve|show|return)\s+(?:the\s+)?([^\n.]+)/gi)) {
    const routePath = (m[1] || '/').trim() || '/';
    const targetPhrase = (m[2] || '').trim();
    if (!isCleanHttpRoute(routePath)) continue;
    const matchedHtml = (fileChecks || []).find(fc => {
      const stem = fc.filePath.replace(/^.*\//, '').replace(/\.html?$/i, '').toLowerCase();
      return targetPhrase.toLowerCase().includes(stem);
    });
    const expectsHtml = /\btext\/html\b/i.test(combined) || Boolean(matchedHtml);
    addProbe({
      name: `GET ${routePath} serves ${targetPhrase.slice(0, 40)}`,
      kind: 'static_page',
      method: 'GET',
      path: routePath,
      expectedStatuses: [200],
      expectedContentType: expectsHtml ? 'text/html' : '',
      expectedBodyIncludes: matchedHtml?.mustContain || ''
    });
  }

  // Test case descriptions for HTML routes: `should serve Team Page for "/team" route`
  for (const tc of tcLines) {
    const serveMatch = tc.match(/should\s+(?:serve|display|return)\s+(.+?)\s+for\s+["'`]([^"'`]+)["'`]/i);
    if (serveMatch) {
      const label = (serveMatch[1] || '').trim();
      const routePath = (serveMatch[2] || '').trim();
      if (/undefined/i.test(label) || /undefined/i.test(routePath)) continue;
      if (!isCleanHttpRoute(routePath)) continue;
      const matchedHtml = (fileChecks || []).find(fc => {
        const stem = fc.filePath.replace(/^.*\//, '').replace(/\.html?$/i, '').toLowerCase();
        return label.toLowerCase().includes(stem);
      });
      addProbe({
        name: tc.slice(0, 70),
        kind: 'static_page',
        method: 'GET',
        path: routePath,
        expectedStatuses: [200],
        expectedContentType: /\btext\/html\b/i.test(combined) ? 'text/html' : '',
        expectedBodyIncludes: matchedHtml?.mustContain || ''
      });
    }
  }

  // 2. Explicit HTTP method + route pairs (`POST /login`, `GET /protected`, `POST /api/rides/request`)
  const routeMethodRegex = /\b(GET|POST|PUT|PATCH|DELETE)\s+`?(\/[a-zA-Z0-9_/:.-]*)`?/g;
  const discoveredMethodRoutes = [];
  for (const m of text.matchAll(routeMethodRegex)) {
    const method = m[1].toUpperCase();
    const rawPath = m[2].replace(/[),.;:`'"]+$/, '');
    if (!isCleanHttpRoute(rawPath)) continue;
    discoveredMethodRoutes.push({ method, path: rawPath, index: m.index || 0 });
  }

  // Also detect standalone route paths in specs like `/login` route or `/protected` route when HTTP API is discussed
  for (const m of text.matchAll(/(?:the\s+|route\s+|endpoint\s+|for\s+)`?(\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_:-]+)*)`?\s+(?:route|endpoint)\b/gi)) {
    const rawPath = m[1].replace(/[),.;:`'"]+$/, '');
    if (!isCleanHttpRoute(rawPath)) continue;
    if (!discoveredMethodRoutes.some(r => r.path === rawPath)) {
      const windowSlice = text.slice(Math.max(0, (m.index || 0) - 120), (m.index || 0) + 180);
      const inferredMethod = /\blogin|register|signup|create|submit|request\b/i.test(rawPath + ' ' + windowSlice) ? 'POST' : 'GET';
      discoveredMethodRoutes.push({ method: inferredMethod, path: rawPath, index: m.index || 0 });
    }
  }

  for (const { method, path, index } of discoveredMethodRoutes) {
    const resolvedPath = path.replace(/:([a-zA-Z_][\w]*)/g, '1');
    const localCtx = text.slice(Math.max(0, index - 80), index + 380);

    // Check if unauthenticated access to protected route expects 401/403
    if (method === 'GET' && /\b(?:protected|authenticateToken|401|403|unauthorized|forbidden|missing\s+token)\b/i.test(resolvedPath + ' ' + localCtx)) {
      addProbe({
        name: `GET ${resolvedPath} rejects unauthenticated request`,
        kind: 'auth_guard',
        method: 'GET',
        path: resolvedPath,
        headers: {},
        expectedStatuses: [401, 403]
      });
    } else if (method === 'GET' && !/:/.test(path)) {
      // Safe non-500 GET liveness probe for non-parameterized GET endpoints
      addProbe({
        name: `GET ${resolvedPath} responds without 5xx crash`,
        kind: 'get_liveness',
        method: 'GET',
        path: resolvedPath,
        expectedMaxStatus: 499
      });
    }

    // Check if POST/PUT/PATCH mentions missing required fields -> 400
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && /\b400\b|\bmissing\b|\brequired\b/i.test(localCtx)) {
      addProbe({
        name: `${method} ${resolvedPath} with empty body returns 400`,
        kind: 'missing_fields_400',
        method,
        path: resolvedPath,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        expectedStatuses: [400, 422]
      });
    }
  }

  // 3. Invalid JSON body crash check on first discovered POST/PUT route (ensures Express invalid-JSON handler works & never throws 500)
  const firstWriteRoute = discoveredMethodRoutes.find(r => r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH');
  if (firstWriteRoute) {
    const resolvedPath = firstWriteRoute.path.replace(/:([a-zA-Z_][\w]*)/g, '1');
    addProbe({
      name: `${firstWriteRoute.method} ${resolvedPath} handles malformed JSON safely (<500)`,
      kind: 'malformed_json',
      method: firstWriteRoute.method,
      path: resolvedPath,
      headers: { 'Content-Type': 'application/json' },
      body: '{"__malformed_json":',
      expectedMaxStatus: 499
    });
  }

  // 4. Undefined route -> 404 probe (explicitly required when 404 or undefined routes appear in spec/testCases)
  if (/\b404\b|\bundefined\s+routes?\b|\bnot\s+found\b/i.test(combined)) {
    const errHtml = (fileChecks || []).find(fc => /error\.html/i.test(fc.filePath));
    addProbe({
      name: 'GET undefined route returns 404',
      kind: 'not_found_404',
      method: 'GET',
      path: '/__ap_probe_undefined_route_404__',
      expectedStatuses: [404],
      expectedBodyIncludes: errHtml?.mustContain || ''
    });
  }

  return probes.slice(0, 12);
}

/** Extract sample stdin -> stdout CLI test cases for script/algorithm tasks. */
export function extractSampleIoCases(questionDetails = '', testCases = []) {
  const cases = [];
  const text = String(questionDetails || '');
  const ioRegex = /(?:Sample\s+)?Input\s*(?:\d+)?\s*:?\s*\n```[^\n]*\n([\s\S]*?)```\s*(?:Sample\s+)?Output\s*(?:\d+)?\s*:?\s*\n```[^\n]*\n([\s\S]*?)```/gi;
  for (const m of text.matchAll(ioRegex)) {
    const input = (m[1] || '').trimEnd();
    const expectedOutput = (m[2] || '').trim();
    if (expectedOutput && input.length <= 2000) {
      cases.push({
        name: `Sample CLI case #${cases.length + 1}`,
        input,
        expectedOutput
      });
    }
  }

  if (Array.isArray(testCases)) {
    for (const tc of testCases) {
      if (tc && typeof tc === 'object' && tc.input !== undefined && tc.expected !== undefined) {
        cases.push({
          name: tc.name || `TestCase CLI #${cases.length + 1}`,
          input: String(tc.input),
          expectedOutput: String(tc.expected).trim()
        });
      }
    }
  }

  return cases.slice(0, 6);
}

/**
 * Analyze the current coding question and repository structure to build a
 * deterministic, question-specific local verification plan executed inside Terminal.
 */
export function buildLocalTestSpec({
  questionTitle = '',
  questionDetails = '',
  testCases = [],
  filesToWrite = [],
  referenceFiles = [],
  packageJsonStr = '',
  terminalPreAnalysis = null
} = {}) {
  const env = detectRuntimeEnvironment({
    questionTitle,
    questionDetails,
    filesToWrite,
    referenceFiles,
    packageJsonStr,
    terminalPreAnalysis
  });

  const fileChecks = extractFileContentChecks(questionDetails, filesToWrite);
  const expectedExports = extractExpectedModuleExports(questionDetails, filesToWrite);
  const httpProbes = env.hasHttpServer ? extractHttpProbes(questionDetails, testCases, fileChecks) : [];
  const sampleIoCases = !env.hasHttpServer ? extractSampleIoCases(questionDetails, testCases) : [];

  let strategy = 'compile_and_smoke';
  if (env.testDirsPresent && env.hasTestScript) {
    strategy = 'project_test_suite';
  } else if (env.language === 'python') {
    strategy = sampleIoCases.length > 0 ? 'python_cli_io' : 'python_compile';
  } else if (env.hasPrisma) {
    strategy = httpProbes.length > 0 || env.hasHttpServer ? 'prisma_and_http' : 'prisma_and_exports';
  } else if (env.framework === 'node-http-static' || (fileChecks.some(c => /\.html$/i.test(c.filePath)) && env.hasHttpServer)) {
    strategy = 'http_static_routing';
  } else if (env.hasHttpServer) {
    strategy = expectedExports.length > 0 ? 'http_routes_and_exports' : 'http_routes';
  } else if (sampleIoCases.length > 0) {
    strategy = 'node_cli_io';
  } else if (expectedExports.length > 0) {
    strategy = 'module_exports';
  }

  const tcSummary = (Array.isArray(testCases) ? testCases : [])
    .map(tc => typeof tc === 'string' ? tc.trim() : (tc?.name || tc?.title || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  return {
    version: 1,
    questionTitle: String(questionTitle || '').slice(0, 120),
    strategy,
    language: env.language,
    moduleSystem: env.moduleSystem,
    framework: env.framework,
    entryFile: env.entryFile,
    buildCommands: env.buildCommands,
    fileChecks,
    expectedExports,
    httpProbes,
    sampleIoCases,
    testCasesSummary: tcSummary
  };
}
