// utils/code-format.js - Code cleanup, 2-space indentation, comment stripping, and multi-file solution parser

const NON_COMMENT_STRIP_EXT_RE = /\.(?:html?|txt|md|json|env|svg|xml|yml|yaml)$/i;
const JS_LIKE_INDENT_EXT_RE = /\.(?:js|ts|jsx|tsx|mjs|cjs|json|css|prisma)$/i;

/** Strip all single-line and multi-line comments from generated JS/TS/Prisma code while preserving strings. */
export function stripComments(code, filePath = '') {
  if (!code) return '';
  if (filePath && NON_COMMENT_STRIP_EXT_RE.test(filePath)) {
    return code.trim();
  }
  let clean = code.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = clean.split('\n');
  const result = [];
  for (const line of lines) {
    let inQuote = false;
    let quoteChar = '';
    let commentIdx = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if ((c === '"' || c === "'" || c === '`') && (i === 0 || line[i - 1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = c;
        } else if (c === quoteChar) {
          inQuote = false;
        }
      } else if (!inQuote && c === '/' && line[i + 1] === '/') {
        commentIdx = i;
        break;
      }
    }
    const processed = commentIdx !== -1 ? line.substring(0, commentIdx).trimEnd() : line;
    if (commentIdx !== -1 && !processed.trim() && line.trim().startsWith('//')) {
      continue;
    }
    result.push(processed);
  }
  return result.join('\n');
}

/** Normalize code indentation strictly to 2 spaces using brace depth tracking. */
export function formatCodeIndentation(code) {
  if (!code) return '';
  const lines = code.split('\n');
  let currentIndent = 0;
  const indentSize = 2;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      result.push('');
      continue;
    }

    let closes = 0;
    if (/^(\}|\)|\])+/.test(trimmed)) {
      const match = trimmed.match(/^(\}+|\]+|\)+)/);
      closes = match ? match[1].length : 1;
    } else if (/^(else|catch|finally)\b/.test(trimmed)) {
      closes = 1;
    }

    const currentLineIndent = Math.max(0, currentIndent - closes);
    result.push(' '.repeat(currentLineIndent * indentSize) + trimmed);

    const stripped = trimmed
      .replace(/\/\/.*/, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');

    let net = 0;
    for (let j = 0; j < stripped.length; j++) {
      const c = stripped[j];
      if (c === '{' || c === '[') net++;
      if (c === '}' || c === ']') net--;
    }

    currentIndent = Math.max(0, currentIndent + net);
  }

  return result.join('\n');
}

/** Remove generic "File 1" or filename header comment lines from top of code blocks (supports //, /*, #, <!-- -->). */
export function stripFileCommentHeaders(code) {
  if (!code) return '';
  return code
    .replace(/^\s*(?:\/\/|\/\*|#+|<!--)\s*file\s*\d+[^\n]*(?:\*\/|-->)?\s*\n?/gim, '')
    .replace(/^\s*(?:\/\/|\/\*|#+|<!--)\s*(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:[a-zA-Z0-9_.\-]+\/)*[a-zA-Z0-9_\-]+\.(?:js|ts|mjs|cjs|json|txt|prisma|sql|env|graphql|html?|css)[^\n]*(?:\*\/|-->)?\s*\n?/gi, '')
    .trim();
}

/** Extract single clean executable code block from LLM markdown output. */
export function extractCodeBlock(rawText) {
  if (!rawText) return '';
  const parseSource = String(rawText)
    .replace(/```(?:[a-zA-Z0-9_\-]+)?(?::[^\n]+)?[^\n]*\n\s*(?:(?:\/\/|#)\s*(?:__commands__|RUN_COMMANDS)\b[\s\S]*?)```/gi, '')
    .replace(/```ap-commands[^\n]*\n[\s\S]*?```/gi, '')
    .trim() || rawText;
  let extracted = '';
  const match = parseSource.match(/```(?:javascript|js|typescript|ts|node)?\s*\n([\s\S]*?)```/i);
  if (match && match[1]) {
    extracted = match[1].trim();
  } else {
    const genericMatch = parseSource.match(/```\s*\n([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
      extracted = genericMatch[1].trim();
    } else {
      extracted = parseSource.trim();
    }
  }

  extracted = stripComments(stripFileCommentHeaders(extracted));
  return formatCodeIndentation(extracted);
}

/** Clean workspace-relative file path (strips leading ./ or /app/code/ prefixes). */
function normalizeRelPath(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/^\/?(?:app\/code|workspace|code)\//i, '')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

function formatByFileType(rawCode, filePath) {
  const cleanHeaders = stripFileCommentHeaders(rawCode);
  if (filePath && NON_COMMENT_STRIP_EXT_RE.test(filePath)) {
    return cleanHeaders.trim();
  }
  const stripped = stripComments(cleanHeaders, filePath);
  return (filePath && !JS_LIKE_INDENT_EXT_RE.test(filePath)) ? stripped.trim() : formatCodeIndentation(stripped);
}

/** Resolve parsed filename/subpath against known workspace paths so nested folders (e.g. src/middleware/validate.js) are never flattened. */
function resolveWorkspaceFilePath(rawFn, workspaceFiles = [], preferredActiveFile = 'src/index.js', codeSnippet = '') {
  const fn = normalizeRelPath(rawFn);
  if (!fn) return '';

  if (fn.endsWith('.prisma') || fn === 'schema.prisma') {
    return fn.startsWith('prisma/') ? fn : 'prisma/' + fn.split('/').pop();
  }

  const wsClean = (workspaceFiles || []).map(normalizeRelPath).filter(Boolean);
  const nonTestWs = wsClean.filter(w => !/(?:^|\/)(?:test|tests|__tests__)\/|(?:\.test|\.spec)\./i.test(w) && !/package-lock/i.test(w));
  const pool = nonTestWs.length > 0 ? nonTestWs : wsClean;

  const prefNorm = normalizeRelPath(preferredActiveFile || 'src/index.js');
  // When AI writes bare `// index.js` with full app code while starter workspace runs `src/index.js`, keep changes inside `src/index.js`
  if (!fn.includes('/') && fn.toLowerCase() === 'index.js' && prefNorm.toLowerCase() === 'src/index.js') {
    const hasSrcIndex = pool.some(w => w.toLowerCase() === 'src/index.js');
    const isBootstrapOnly = codeSnippet && codeSnippet.trim().length < 140 && /require\s*\(\s*['"]\.\/src\//i.test(codeSnippet);
    if (hasSrcIndex && !isBootstrapOnly) {
      return pool.find(w => w.toLowerCase() === 'src/index.js');
    }
  }

  const exact = pool.find(w => w.toLowerCase() === fn.toLowerCase());
  if (exact) return exact;

  const base = fn.split('/').pop().toLowerCase();
  const suffixMatches = pool.filter(w => {
    const wl = w.toLowerCase();
    return wl.endsWith('/' + fn.toLowerCase()) || (!fn.includes('/') && wl.split('/').pop() === base);
  });
  if (suffixMatches.length > 0) {
    // Prefer nested existing workspace path (e.g. src/middleware/validate.js) over flat root/src guess
    suffixMatches.sort((a, b) => b.split('/').length - a.split('/').length);
    return suffixMatches[0];
  }

  if (fn.startsWith('src/') || /^(?:prisma|db|test|tests|__tests__|public|project|views|static|assets|config|scripts)\//i.test(fn)) {
    return fn;
  }
  if (fn === 'package.json' || fn.startsWith('.')) return fn;
  if (/\.(?:html?|css|svg|txt|md)$/i.test(fn)) {
    // Keep explicitly named static assets at their given relative path (alignStaticPaths adjusts against JS code references later)
    return fn;
  }
  if (fn.includes('/')) {
    const hasSrcLayout = wsClean.length === 0 || wsClean.some(w => w.startsWith('src/'));
    const subRoot = fn.split('/')[0].toLowerCase();
    if (hasSrcLayout && /^(?:middleware|middlewares|routes|controllers|services|models|utils|helpers|validators|handlers)$/i.test(subRoot)) {
      return 'src/' + fn;
    }
    return fn;
  }
  return 'src/' + fn;
}

/** Align bare static filenames (e.g. services.html) with folder paths referenced in generated JS server code. */
function alignStaticFilePaths(files) {
  if (!Array.isArray(files) || files.length < 2) return files;
  const jsBlocks = files.filter(f => /\.(?:js|ts|mjs|cjs)$/i.test(f.filePath || ''));
  const combinedJs = jsBlocks.map(f => f.code || '').join('\n');
  if (!combinedJs) return files;

  const hasSrcServer = jsBlocks.some(f => /^src\/index\.(?:js|ts)$/i.test(f.filePath) || /^src\//i.test(f.filePath));
  return files.map(f => {
    const fp = f.filePath || '';
    if (!/\.(?:html?|css|txt|json)$/i.test(fp) || fp.includes('/')) return f;
    const escaped = fp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 1. Explicit subpath inside path.join(__dirname, ...) or string literal like 'project/services.html'
    const dirSubJoinM = combinedJs.match(new RegExp(`__dirname\\s*,\\s*['"\`]([a-zA-Z0-9_.-]+)['"\`]\\s*,\\s*['"\`]${escaped}['"\`]`, 'i'));
    if (dirSubJoinM && dirSubJoinM[1] !== '..' && dirSubJoinM[1] !== '.') {
      return { ...f, filePath: hasSrcServer ? `src/${dirSubJoinM[1]}/${fp}` : `${dirSubJoinM[1]}/${fp}` };
    }
    const explicitSubM = combinedJs.match(new RegExp(`['"\`](?:\\.\\/)?([a-zA-Z0-9_.-]+\\/${escaped})['"\`]`, 'i'))
      || combinedJs.match(new RegExp(`['"\`]([a-zA-Z0-9_.-]+)['"\`]\\s*,\\s*['"\`]${escaped}['"\`]`, 'i'));
    if (explicitSubM && !/^\.\.(?:\/|$)/.test(explicitSubM[1])) {
      const folder = explicitSubM[1].includes('/') ? explicitSubM[1] : `${explicitSubM[1]}/${fp}`;
      return { ...f, filePath: folder.startsWith('../') ? folder.replace(/^\.\.\//, '') : folder };
    }
    // 2. If server runs in src/index.js and uses __dirname without '..', resolve inside src/
    if (hasSrcServer && new RegExp(`__dirname\\s*[,+]\\s*['"\`]/?(?:\\.\\/)?${escaped}['"\`]`, 'i').test(combinedJs)) {
      return { ...f, filePath: 'src/' + fp };
    }
    return f;
  });
}

/** Deduplicate identical paths and drop redundant flat copies when canonical workspace path is present. */
function dedupeCanonicalFiles(files, workspaceFiles = []) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const wsSet = new Set((workspaceFiles || []).map(normalizeRelPath).map(s => s.toLowerCase()));
  const byPath = new Map();
  for (const f of files) {
    if (!f || !f.filePath || !f.code) continue;
    byPath.set(f.filePath, f);
  }
  const deduped = Array.from(byPath.values());
  // Drop accidental non-workspace flat twin (e.g. validate.js when src/middleware/validate.js exists)
  return deduped.filter(f => {
    const fpLow = f.filePath.toLowerCase();
    const base = fpLow.split('/').pop();
    const hasCanonicalNested = deduped.some(other =>
      other !== f &&
      other.filePath.toLowerCase().split('/').pop() === base &&
      other.filePath.split('/').length > f.filePath.split('/').length &&
      (wsSet.size === 0 || wsSet.has(other.filePath.toLowerCase()) || !wsSet.has(fpLow))
    );
    if (hasCanonicalNested && !wsSet.has(fpLow) && !/index\.(?:js|ts)$/i.test(base)) {
      return false;
    }
    return true;
  });
}

/** Parse one or more code files from LLM output using explicit headers, content routing, and workspace hints. */
export function parseMultiFileSolution(rawText, defaultActiveFile = 'src/index.js', workspaceFiles = []) {
  if (!rawText) return [];

  // Strip optional post-write __commands__ / ap-commands bash blocks before parsing code files
  const sanitizedRawText = String(rawText).replace(
    /```(?:[a-zA-Z0-9_\-]+)?(?::[^\n]+)?[^\n]*\n\s*(?:(?:\/\/|#)\s*(?:__commands__|RUN_COMMANDS)\b[\s\S]*?)```/gi,
    ''
  ).replace(/```ap-commands[^\n]*\n[\s\S]*?```/gi, '').trim();
  const parseSource = sanitizedRawText || rawText;

  const isValidFilename = (fn) => {
    if (!fn) return false;
    fn = normalizeRelPath(fn);
    if (/__commands__|run_commands/i.test(fn)) return false;
    const base = fn.split('/').pop();
    if (/^(1|2|3|4|5|one|two|file1|file2|file_1|file_2)(\.(js|ts|prisma|sql|html?))?$/i.test(base)) return false;
    return /\.(js|ts|mjs|cjs|json|txt|prisma|sql|env|graphql|html?|css)$/i.test(base);
  };

  const resolveTargetFile = (fn, codeSnippet, idx) => {
    if (/datasource\s+db|generator\s+client|model\s+[A-Z]/i.test(codeSnippet) || (fn && fn.endsWith('.prisma'))) {
      return 'prisma/schema.prisma';
    }
    if (/PrismaClient|prisma\.\w+\.(create|deleteMany|find)/i.test(codeSnippet) && !/express|createServer|app\.listen/i.test(codeSnippet)) {
      return 'src/seed.js';
    }
    if (fn && isValidFilename(fn)) {
      return resolveWorkspaceFilePath(fn, workspaceFiles, defaultActiveFile, codeSnippet);
    }
    if (/express|createServer|app\.listen|app\.use/i.test(codeSnippet) && !/PrismaClient|prisma\.\w+/i.test(codeSnippet)) {
      const def = resolveWorkspaceFilePath(defaultActiveFile, workspaceFiles, defaultActiveFile, codeSnippet);
      return /index\.(?:js|ts)$/i.test(def) ? def : (resolveWorkspaceFilePath('src/index.js', workspaceFiles, defaultActiveFile, codeSnippet) || 'src/index.js');
    }
    if (/"prisma"\s*:\s*\{|"scripts"\s*:\s*\{/i.test(codeSnippet) || fn === 'package.json') {
      return 'package.json';
    }

    if (workspaceFiles && workspaceFiles.length > 0) {
      const codeFiles = workspaceFiles.filter(f => /\.(js|ts|prisma)$/i.test(f) && !/nodemon|package|config/i.test(f));
      if (/validate|middleware|authenticateToken/i.test(codeSnippet)) {
        const m = codeFiles.find(f => /middleware|validate/i.test(f));
        if (m) return resolveWorkspaceFilePath(m, workspaceFiles);
      }
      if (/express|createServer|app\.listen/i.test(codeSnippet)) {
        const idxF = codeFiles.find(f => /index\.(js|ts)/i.test(f));
        if (idxF) return resolveWorkspaceFilePath(idxF, workspaceFiles);
      }
      if (idx === 0 && codeFiles.find(f => !/index/i.test(f))) {
        return resolveWorkspaceFilePath(codeFiles.find(f => !/index/i.test(f)), workspaceFiles);
      }
      if (idx === 1 && codeFiles.find(f => /index/i.test(f))) {
        return resolveWorkspaceFilePath(codeFiles.find(f => /index/i.test(f)), workspaceFiles);
      }
    }
    return resolveWorkspaceFilePath(defaultActiveFile, workspaceFiles);
  };

  const relPathGroup = '((?:[a-zA-Z0-9_.\\-]+\\/)*[a-zA-Z0-9_.\\-]+\\.(?:js|ts|mjs|cjs|json|txt|prisma|sql|env|graphql|html?|css))';
  const cmtPrefix = '(?:\\/\\/\\s*|\\/\\*\\s*|#+\\s*|<!--\\s*)';
  const cmtSuffix = '(?:\\s*---|\\s*\\*\\/|\\s*-->)?';
  const fileHeaderPattern = new RegExp(`^${cmtPrefix}?(?:file:?\\s*|---\\s*)?(?:(?:\\d+|step\\s*\\d+|file\\s*\\d+)[\\.:\\-\\)]\\s*)?${relPathGroup}${cmtSuffix}\\s*(?:\\n|$)`, 'i');
  const langFileRegex = new RegExp(relPathGroup, 'i');
  const precedingFileRegex = new RegExp(`(?:file:?\\s*)?(?:(?:\\d+|step\\s*\\d+)[\\.:\\-\\)]\\s*)?(?:\\\`|'|\\")?${relPathGroup}`, 'i');
  const headerRegex = new RegExp(`(?:^|\\n)\\s*${cmtPrefix}(?:file:?\\s*|---\\s*)?(?:(?:\\d+|step\\s*\\d+|file\\s*\\d+)[\\.:\\-\\)]\\s*)?${relPathGroup}${cmtSuffix}\\s*(?:\\n|$)`, 'gi');

  // Strategy 1: Multiple or Single markdown code blocks
  const blockRegex = /```(?:[a-zA-Z0-9_\-]+)?(?::([^\n]+))?([^\n]*)\n([\s\S]*?)```/g;
  const blocks = [...parseSource.matchAll(blockRegex)];
  const defaultResolved = resolveWorkspaceFilePath(defaultActiveFile, workspaceFiles);

  if (blocks.length > 0) {
    const parsedBlocks = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const langExtra = (b[1] || '') + ' ' + (b[2] || '');
      let code = stripFileCommentHeaders(b[3]);

      const prevEnd = (i > 0) ? (blocks[i - 1].index + blocks[i - 1][0].length) : 0;
      const precedingText = parseSource.substring(prevEnd, b.index).trim();

      let detectedFilename = '';
      const firstLineMatch = b[3].trim().match(fileHeaderPattern);
      if (firstLineMatch && isValidFilename(firstLineMatch[1])) {
        detectedFilename = firstLineMatch[1];
      }
      if (!detectedFilename && langExtra) {
        const m = langExtra.match(langFileRegex);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }
      if (!detectedFilename && precedingText) {
        const lines = precedingText.split('\n').map(l => l.trim()).filter(Boolean);
        const lastFew = lines.slice(-3).join(' ');
        const m = lastFew.match(precedingFileRegex);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }

      const finalPath = resolveTargetFile(detectedFilename, code, i);
      if (finalPath && code) {
        parsedBlocks.push({ filePath: finalPath, code: formatByFileType(code, finalPath) });
      }
    }

    if (parsedBlocks.length > 0 && (blocks.length > 1 || parsedBlocks[0].filePath !== defaultResolved)) {
      return dedupeCanonicalFiles(alignStaticFilePaths(parsedBlocks), workspaceFiles);
    }
  }

  // Strategy 2: Split by inline file comment headers
  const headers = [...parseSource.matchAll(headerRegex)].filter(h => isValidFilename(h[1]));

  if (headers.length > 0) {
    const inlineFiles = [];
    for (let i = 0; i < headers.length; i++) {
      const fn = headers[i][1];
      const start = headers[i].index + headers[i][0].length;
      const end = (i + 1 < headers.length) ? headers[i + 1].index : parseSource.length;
      let rawCode = parseSource.substring(start, end).trim();
      rawCode = rawCode.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
      rawCode = stripFileCommentHeaders(rawCode);
      if (rawCode.length > 5) {
        const fp = resolveWorkspaceFilePath(fn, workspaceFiles, defaultActiveFile, rawCode);
        inlineFiles.push({
          filePath: fp,
          code: formatByFileType(rawCode, fp)
        });
      }
    }
    if (inlineFiles.length > 0) {
      return dedupeCanonicalFiles(alignStaticFilePaths(inlineFiles), workspaceFiles);
    }
  }

  // Strategy 3: Raw text starting with a file header line
  let cleaned = parseSource.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
  const topMatch = cleaned.match(fileHeaderPattern);
  if (topMatch && isValidFilename(topMatch[1])) {
    const fn = topMatch[1];
    cleaned = stripFileCommentHeaders(cleaned);
    const fp = resolveWorkspaceFilePath(fn, workspaceFiles, defaultActiveFile, cleaned);
    return dedupeCanonicalFiles(alignStaticFilePaths([{ filePath: fp, code: formatByFileType(cleaned, fp) }]), workspaceFiles);
  }

  const singleCode = stripFileCommentHeaders(extractCodeBlock(parseSource));
  const finalSinglePath = resolveTargetFile('', singleCode, 0);
  return [{
    filePath: finalSinglePath,
    code: formatByFileType(singleCode, finalSinglePath)
  }];
}
