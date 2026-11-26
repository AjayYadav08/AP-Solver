// utils/file-planner.js - Deterministic pre-implementation workspace analysis, locked file plan builder & runtime gate

const PROTECTED_ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  '.env',
  '.gitignore',
  'nodemon.json',
  'readme.md',
  '.gitkeep',
  'tsconfig.json',
  'jsconfig.json'
]);

const KNOWN_LAYER_RE = /^(?:middleware|middlewares|routes|controllers|services|models|utils|helpers|validators|handlers)$/i;
const TEST_FILE_RE = /(?:^|\/)(?:test|tests|__tests__)\/|(?:\.test|\.spec)\.(?:js|ts|mjs|cjs)$/i;
const VALID_REL_EXT_RE = /\.(?:js|ts|mjs|cjs|json|txt|prisma|sql|env|graphql|html?|css|svg|md)$/i;

/** Clean a raw workspace-relative path (strips ./, /app/code/, quotes). */
export function normalizePlannerPath(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/^\/?(?:app\/code|workspace|code)\//i, '')
    .replace(/^\.\//, '')
    .replace(/[),:;]+$/, '')
    .replace(/\/{2,}/g, '/');
}

/** Remove bare filename entries when a deeper canonical workspace path already exists for that filename. */
export function dedupeFlatVsNested(files = []) {
  const clean = [...new Set((files || []).map(normalizePlannerPath).filter(Boolean))];
  return clean.filter(f => {
    if (f.includes('/') || /^index\.(?:js|ts)$/i.test(f) || PROTECTED_ROOT_FILES.has(f.toLowerCase())) {
      return true;
    }
    const baseLow = f.toLowerCase();
    return !clean.some(other => other !== f && other.includes('/') && other.toLowerCase().endsWith('/' + baseLow));
  });
}

function isProtectedFile(filePath, bootstrapIndexPath = '') {
  const low = normalizePlannerPath(filePath).toLowerCase();
  if (!low) return true;
  if (PROTECTED_ROOT_FILES.has(low.split('/').pop())) return true;
  if (TEST_FILE_RE.test(low)) return true;
  if (bootstrapIndexPath && low === bootstrapIndexPath.toLowerCase()) return true;
  return false;
}

/** Extract valid workspace file mentions from problem title/description (ignoring JS properties & prose abbreviations). */
function extractQuestionFileMentions(questionText = '') {
  const text = String(questionText || '');
  const mentions = [];
  const seen = new Set();
  const re = /(?:^|[\s(`'"/])((?:[a-zA-Z0-9_.\-]+\/)*[a-zA-Z0-9_\-]+\.(?:js|ts|mjs|cjs|prisma|html?|css|sql|json|txt))\b/gi;
  for (const m of text.matchAll(re)) {
    const cand = normalizePlannerPath(m[1]);
    if (!cand || cand.includes('..')) continue;
    const low = cand.toLowerCase();
    const base = low.split('/').pop();
    if (PROTECTED_ROOT_FILES.has(base) || TEST_FILE_RE.test(low)) continue;
    if (/^(?:e\.g|i\.e|vs|etc|node|express|react|next|vue|req|res|process|env|math|json|object|array|console|promise|fs|path|http|https|app|router|next)\.[a-z0-9]+$/i.test(low)) {
      continue;
    }
    if (/^\d+\.\d+$/.test(low) || /^(?:v?\d+\.\d+|localhost\.\d+)$/i.test(low)) continue;
    if (!seen.has(low)) {
      seen.add(low);
      mentions.push(cand);
    }
  }
  return mentions;
}

/** Extract local relative require/import targets from starter code to trace existing module wiring. */
function extractStarterLocalImports(referenceFiles = {}, hasSrcDir = true) {
  const found = [];
  for (const [owner, code] of Object.entries(referenceFiles || {})) {
    if (!code || TEST_FILE_RE.test(owner) || !/\.(?:js|ts|mjs|cjs)$/i.test(owner)) continue;
    const ownerDir = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/')) : '';
    const relRe = /(?:require\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+[^'"]*['"](\.[^'"]+)['"])/g;
    for (const m of String(code).matchAll(relRe)) {
      const rawRel = m[1] || m[2];
      if (!rawRel) continue;
      const parts = (ownerDir ? ownerDir.split('/') : []).concat(rawRel.split('/'));
      const resolvedParts = [];
      for (const seg of parts) {
        if (!seg || seg === '.') continue;
        if (seg === '..') resolvedParts.pop();
        else resolvedParts.push(seg);
      }
      let joined = resolvedParts.join('/');
      if (!VALID_REL_EXT_RE.test(joined)) joined += '.js';
      if (hasSrcDir && !joined.includes('/') && !/^index\./i.test(joined)) joined = 'src/' + joined;
      if (joined && !found.includes(joined)) found.push(joined);
    }
  }
  return found;
}

/** Match a singular/generic mention (e.g. "service.js") to an existing structured layer file (e.g. "src/services/ride.service.js"). */
function findLayerRoleMatch(candPath, editableExisting) {
  const base = normalizePlannerPath(candPath).split('/').pop().toLowerCase();
  const stem = base.replace(/\.(?:js|ts|mjs|cjs)$/i, '');
  const roleRules = [
    { token: /controller/i, dirRe: /(?:^|\/)controllers?\//i, fileRe: /\.controller\./i },
    { token: /service/i, dirRe: /(?:^|\/)services?\//i, fileRe: /\.service\./i },
    { token: /model/i, dirRe: /(?:^|\/)models?\//i, fileRe: /\.model\./i },
    { token: /route/i, dirRe: /(?:^|\/)routes?\//i, fileRe: /\.routes?\./i },
    { token: /(?:middleware|validate|auth)/i, dirRe: /(?:^|\/)middlewares?\//i, fileRe: /\.(?:middleware|validate|auth)\./i }
  ];
  for (const r of roleRules) {
    if (!r.token.test(stem)) continue;
    const matched = editableExisting.filter(ex => r.dirRe.test(ex) || r.fileRe.test(ex));
    if (matched.length === 1) return matched[0];
    const specificWord = stem.split('.')[0];
    if (specificWord && matched.length > 1) {
      const exactNamed = matched.find(ex => ex.toLowerCase().includes(specificWord));
      if (exactNamed) return exactNamed;
    }
  }
  return null;
}

/**
 * Analyze the problem specification and existing workspace files BEFORE code generation
 * to produce a deterministic, locked file modification plan (Step 1..6 workflow).
 */
export function analyzeFileModificationPlan({
  questionTitle = '',
  questionDetails = '',
  activeFile = 'src/index.js',
  workspaceFiles = [],
  referenceFiles = {}
} = {}) {
  const rawCombined = [
    ...(workspaceFiles || []),
    ...Object.keys(referenceFiles || {})
  ].map(normalizePlannerPath).filter(Boolean);

  const diskFiles = dedupeFlatVsNested(rawCombined);
  const hasSrcDir = diskFiles.some(f => f.startsWith('src/'));

  const rootIdxCode = referenceFiles?.['index.js'] || '';
  const hasThinRootLoader = diskFiles.includes('index.js') && diskFiles.includes('src/index.js') &&
    (!rootIdxCode || (rootIdxCode.trim().length < 140 && /src\/index/i.test(rootIdxCode)));
  const bootstrapIndexPath = hasThinRootLoader ? 'index.js' : '';

  const protectedFiles = diskFiles.filter(f => isProtectedFile(f, bootstrapIndexPath));
  const editableExisting = diskFiles.filter(f => !isProtectedFile(f, bootstrapIndexPath) && VALID_REL_EXT_RE.test(f));

  // Describe workspace structure for prompt transparency
  const folders = [...new Set(editableExisting.filter(f => f.includes('/')).map(f => f.slice(0, f.lastIndexOf('/'))))];
  const architectureSummary = folders.length > 0
    ? `Structured layout (${folders.join(', ')})`
    : (hasSrcDir ? 'Single-folder src/ layout' : 'Root-level workspace layout');

  const fullQuestionText = `${questionTitle || ''}\n${questionDetails || ''}`;
  const isPrisma = /prisma|schema\.prisma|seed\.js|one-to-one/i.test(fullQuestionText);
  const mentions = extractQuestionFileMentions(fullQuestionText);
  const starterImports = extractStarterLocalImports(referenceFiles, hasSrcDir);

  const targetsMap = new Map();
  const addTarget = (filePath, mode, reason, exists) => {
    const clean = normalizePlannerPath(filePath);
    if (!clean || isProtectedFile(clean, bootstrapIndexPath)) return;
    if (!targetsMap.has(clean)) {
      targetsMap.set(clean, { filePath: clean, mode, reason, exists });
    }
  };

  // Resolve any candidate name against existing workspace files first (Priority 3: Existing Files First)
  const resolveExistingOnly = (cand) => {
    const c = normalizePlannerPath(cand);
    const cLow = c.toLowerCase();
    const base = cLow.split('/').pop();

    const exact = editableExisting.find(e => e.toLowerCase() === cLow);
    if (exact) return exact;

    const suffix = editableExisting.filter(e => {
      const eLow = e.toLowerCase();
      return eLow.endsWith('/' + cLow) || (!c.includes('/') && eLow.split('/').pop() === base);
    });
    if (suffix.length > 0) {
      suffix.sort((a, b) => b.split('/').length - a.split('/').length);
      return suffix[0];
    }

    return findLayerRoleMatch(c, editableExisting);
  };

  // 1. Resolve files explicitly named in the problem prompt
  for (const m of mentions) {
    const existingHit = resolveExistingOnly(m);
    if (existingHit) {
      addTarget(existingHit, 'edit', 'Existing workspace file matched from problem specification', true);
      continue;
    }

    // Strict File Creation Rule: allow creating ONLY when missing and genuinely requested
    const isStaticAsset = /\.(?:html?|css|txt|svg|md)$/i.test(m);
    const explicitCreateCue = isStaticAsset || isPrisma ||
      m.includes('/') ||
      /create\b|add the following|new file|seed\.js|router|controller|middleware|model|service/i.test(fullQuestionText);
    if (explicitCreateCue) {
      let dest = m;
      if (!isStaticAsset) {
        if (m.endsWith('.prisma')) dest = m.startsWith('prisma/') ? m : 'prisma/' + m.split('/').pop();
        else if (!dest.includes('/') && hasSrcDir) dest = 'src/' + dest;
        else if (dest.includes('/') && hasSrcDir && KNOWN_LAYER_RE.test(dest.split('/')[0])) dest = 'src/' + dest;
      }
      addTarget(dest, 'create', 'Required new file requested by problem (not present in workspace)', false);
    }
  }

  // 2. Include starter local imports (existing or missing files wired by index.js)
  for (const imp of starterImports) {
    const existingHit = resolveExistingOnly(imp);
    if (existingHit) {
      addTarget(existingHit, 'edit', 'Referenced via starter code import/require', true);
    } else if (/seed\.js|route|controller|model|service|middleware|util|helper/i.test(imp)) {
      addTarget(imp, 'create', 'Imported by starter code but not yet present', false);
    }
  }

  // 3. Always ensure Prisma multi-file requirements when problem uses Prisma
  if (isPrisma) {
    addTarget('prisma/schema.prisma', resolveExistingOnly('prisma/schema.prisma') ? 'edit' : 'create', 'Prisma schema required by problem', !!resolveExistingOnly('prisma/schema.prisma'));
    addTarget('src/seed.js', resolveExistingOnly('src/seed.js') ? 'edit' : 'create', 'Prisma seed script required by problem', !!resolveExistingOnly('src/seed.js'));
  }

  // 4. Include primary active file & existing structured starter files when relevant
  const activeHit = resolveExistingOnly(activeFile);
  if (activeHit) {
    addTarget(activeHit, 'edit', 'Active workspace entry/target file', true);
  } else if (targetsMap.size === 0) {
    const fallbackEntry = resolveExistingOnly('src/index.js') || resolveExistingOnly('index.js') || normalizePlannerPath(activeFile) || 'src/index.js';
    const exists = editableExisting.includes(fallbackEntry);
    addTarget(fallbackEntry, exists ? 'edit' : 'create', exists ? 'Primary workspace entrypoint' : 'Default solution target', exists);
  }

  // Include all editable existing source files inside structured MVC/modular layers when problem involves multi-file architecture or refactor
  if (/refactor|mvc|controller|service|model|router|middleware/i.test(fullQuestionText) || editableExisting.length > 1) {
    for (const ex of editableExisting) {
      if (/\.(?:js|ts|mjs|cjs|prisma)$/i.test(ex)) {
        addTarget(ex, 'edit', 'Existing workspace implementation file', true);
      }
    }
  }

  const targets = Array.from(targetsMap.values());
  const staticAssets = targets.filter(t => /\.(?:html?|css|txt|svg)$/i.test(t.filePath));
  const primaryFile = targets.find(t => /index\.(?:js|ts)$/i.test(t.filePath))?.filePath ||
    (activeHit || targets[0]?.filePath || 'src/index.js');

  return {
    locked: true,
    primaryFile,
    architectureSummary,
    hasSrcDir,
    allowStaticHtmlCreation: staticAssets.length > 0 || /\.html?\b/i.test(fullQuestionText),
    staticAssetBasenames: staticAssets.map(t => t.filePath.split('/').pop().toLowerCase()),
    targets,
    allowedPaths: targets.map(t => t.filePath),
    protectedFiles: [...new Set(protectedFiles)],
    allExistingFiles: diskFiles
  };
}

/**
 * Deterministic Pre-Implementation & Post-Generation Gate:
 * Pass 1 claims all exact canonical plan targets first (order-independent);
 * Pass 2 remaps near-miss paths onto unclaimed plan targets and blocks duplicates, protected, or unapproved files.
 */
export function enforceFilePlan(parsedFiles = [], filePlan = null) {
  if (!filePlan || !Array.isArray(filePlan.allowedPaths) || filePlan.allowedPaths.length === 0) {
    return { files: parsedFiles || [], blockedFiles: [], remappedFiles: [] };
  }

  const allowedSet = new Set(filePlan.allowedPaths.map(normalizePlannerPath));
  const allowedByLow = new Map(filePlan.allowedPaths.map(p => [normalizePlannerPath(p).toLowerCase(), normalizePlannerPath(p)]));
  const protectedSet = new Set((filePlan.protectedFiles || []).map(p => normalizePlannerPath(p).toLowerCase()));
  const protectedBaseSet = new Set([...PROTECTED_ROOT_FILES]);
  const staticBases = new Set((filePlan.staticAssetBasenames || []).map(s => s.toLowerCase()));

  const accepted = new Map();
  const blockedFiles = [];
  const remappedFiles = [];
  const deferred = [];

  for (const item of (parsedFiles || [])) {
    if (!item || !item.code) continue;
    const rawFp = normalizePlannerPath(item.filePath);
    const lowFp = rawFp.toLowerCase();
    const baseLow = lowFp.split('/').pop();

    // 1. Hard block protected files (package.json, .env, nodemon.json, tests, etc.)
    if (protectedBaseSet.has(baseLow) || TEST_FILE_RE.test(lowFp) || (protectedSet.has(lowFp) && baseLow !== 'index.js')) {
      blockedFiles.push({ filePath: rawFp, reason: 'Protected workspace/config/test file cannot be modified' });
      continue;
    }

    // 2. Claim exact canonical plan matches first (Pass 1)
    if (allowedByLow.has(lowFp)) {
      const canonical = allowedByLow.get(lowFp);
      accepted.set(canonical, { ...item, filePath: canonical });
      continue;
    }

    // 3. Claim approved static asset alignments (e.g. project/services.html)
    if (filePlan.allowStaticHtmlCreation && staticBases.has(baseLow)) {
      accepted.set(rawFp, { ...item, filePath: rawFp });
      continue;
    }

    deferred.push({ item, rawFp, lowFp, baseLow });
  }

  // Pass 2: Remap or block non-exact paths deterministically
  for (const { item, rawFp, lowFp, baseLow } of deferred) {
    // Locked root index.js bootstrapper
    if (protectedSet.has(lowFp) && baseLow === 'index.js') {
      const srcIdx = allowedByLow.get('src/index.js');
      if (srcIdx && !accepted.has(srcIdx) && item.code.trim().length > 140) {
        remappedFiles.push({ from: rawFp, to: srcIdx });
        accepted.set(srcIdx, { ...item, filePath: srcIdx });
      } else {
        blockedFiles.push({ filePath: rawFp, reason: 'Root bootstrapper index.js is locked; edits belong in src/index.js' });
      }
      continue;
    }

    const suffixMatches = filePlan.allowedPaths.filter(ap => {
      const apLow = ap.toLowerCase();
      return apLow.endsWith('/' + lowFp) || apLow.split('/').pop() === baseLow;
    });
    const canonicalTarget = suffixMatches.length > 0 ? suffixMatches[0] : findLayerRoleMatch(rawFp, filePlan.allowedPaths);

    if (canonicalTarget && allowedSet.has(canonicalTarget)) {
      if (accepted.has(canonicalTarget)) {
        blockedFiles.push({ filePath: rawFp, reason: `Duplicate sibling suppressed (already modifying canonical "${canonicalTarget}")` });
      } else {
        remappedFiles.push({ from: rawFp, to: canonicalTarget });
        accepted.set(canonicalTarget, { ...item, filePath: canonicalTarget });
      }
      continue;
    }

    blockedFiles.push({ filePath: rawFp, reason: 'Unapproved file creation outside locked file modification plan' });
  }

  return {
    files: Array.from(accepted.values()),
    blockedFiles,
    remappedFiles
  };
}
