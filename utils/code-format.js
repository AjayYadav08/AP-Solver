// utils/code-format.js - Code cleanup, 2-space indentation, comment stripping, and multi-file solution parser

/** Strip all single-line and multi-line comments from generated JS/TS/Prisma code while preserving strings. */
export function stripComments(code) {
  if (!code) return '';
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

/** Remove generic "File 1" or filename header comment lines from top of code blocks. */
export function stripFileCommentHeaders(code) {
  if (!code) return '';
  return code
    .replace(/^\s*(?:\/\/|\/\*|#+)\s*file\s*\d+[^\n]*(?:\*\/)?\s*\n?/gim, '')
    .replace(/^\s*(?:\/\/|\/\*|#+)\s*(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:src\/)?[a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql)[^\n]*(?:\*\/)?\s*\n?/gi, '')
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

/** Parse one or more code files from LLM output using explicit headers, content routing, and workspace hints. */
export function parseMultiFileSolution(rawText, defaultActiveFile = 'src/index.js', workspaceFiles = []) {
  if (!rawText) return [];

  // Strip optional post-write __commands__ / ap-commands bash blocks before parsing code files
  const sanitizedRawText = String(rawText).replace(
    /```(?:[a-zA-Z0-9_\-]+)?(?::[^\n]+)?[^\n]*\n\s*(?:(?:\/\/|#)\s*(?:__commands__|RUN_COMMANDS)\b[\s\S]*?)```/gi,
    ''
  ).replace(/```ap-commands[^\n]*\n[\s\S]*?```/gi, '').trim();
  const parseSource = sanitizedRawText || rawText;

  const normPath = (fn) => {
    if (!fn) return '';
    fn = fn.trim();
    if (fn.endsWith('.prisma') || fn === 'schema.prisma') {
      return fn.startsWith('prisma/') ? fn : 'prisma/' + fn;
    }
    if (fn.startsWith('src/')) return fn;
    if (fn.includes('/') || fn === 'package.json' || fn.startsWith('.')) return fn;
    return 'src/' + fn;
  };

  const isValidFilename = (fn) => {
    if (!fn) return false;
    fn = fn.trim();
    if (/__commands__|run_commands/i.test(fn)) return false;
    if (/^(1|2|3|4|5|one|two|file1|file2|file_1|file_2)(\.(js|ts|prisma|sql))?$/i.test(fn)) return false;
    return /\.(js|ts|json|txt|prisma|sql|env|graphql|html|css)$/i.test(fn);
  };

  const resolveTargetFile = (fn, codeSnippet, idx) => {
    if (/datasource\s+db|generator\s+client|model\s+[A-Z]/i.test(codeSnippet) || (fn && fn.endsWith('.prisma'))) {
      return 'prisma/schema.prisma';
    }
    if (/PrismaClient|prisma\.\w+\.(create|deleteMany|find)/i.test(codeSnippet) && !/express|createServer|app\.listen/i.test(codeSnippet)) {
      return 'src/seed.js';
    }
    if (/express|createServer|app\.listen|app\.use/i.test(codeSnippet) && !/PrismaClient|prisma\.\w+/i.test(codeSnippet)) {
      return 'src/index.js';
    }
    if (/"prisma"\s*:\s*\{|"scripts"\s*:\s*\{/i.test(codeSnippet) || fn === 'package.json') {
      return 'package.json';
    }

    if (fn && isValidFilename(fn)) return normPath(fn);
    if (workspaceFiles && workspaceFiles.length > 0) {
      const codeFiles = workspaceFiles.filter(f => /\.(js|ts|prisma)$/i.test(f) && !/nodemon|package|config/i.test(f));
      if (/validate|middleware/i.test(codeSnippet)) {
        const m = codeFiles.find(f => /middleware|validate/i.test(f));
        if (m) return normPath(m);
      }
      if (/express|createServer|app\.listen/i.test(codeSnippet)) {
        const idxF = codeFiles.find(f => /index\.(js|ts)/i.test(f));
        if (idxF) return normPath(idxF);
      }
      if (idx === 0 && codeFiles.find(f => !/index/i.test(f))) {
        return normPath(codeFiles.find(f => !/index/i.test(f)));
      }
      if (idx === 1 && codeFiles.find(f => /index/i.test(f))) {
        return normPath(codeFiles.find(f => /index/i.test(f)));
      }
    }
    return normPath(defaultActiveFile);
  };

  const fileHeaderPattern = /^(?:\/\/\s*|\/\*\s*|#+\s*)?(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+|file\s*\d+)[\.:\-\)]\s*)?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))(?:\s*---|\s*\*\/)?\s*(?:\n|$)/i;

  // Strategy 1: Multiple or Single markdown code blocks
  const blockRegex = /```(?:[a-zA-Z0-9_\-]+)?(?::([^\n]+))?([^\n]*)\n([\s\S]*?)```/g;
  const blocks = [...parseSource.matchAll(blockRegex)];

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
        const m = langExtra.match(/([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))/i);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }
      if (!detectedFilename && precedingText) {
        const lines = precedingText.split('\n').map(l => l.trim()).filter(Boolean);
        const lastFew = lines.slice(-3).join(' ');
        const m = lastFew.match(/(?:file:?\s*)?(?:(?:\d+|step\s*\d+)[\.:\-\)]\s*)?(?:`|'|\")?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))/i);
        if (m && isValidFilename(m[1])) detectedFilename = m[1];
      }

      const finalPath = resolveTargetFile(detectedFilename, code, i);
      if (finalPath && code) {
        parsedBlocks.push({ filePath: finalPath, code: formatCodeIndentation(stripComments(stripFileCommentHeaders(code))) });
      }
    }

    if (parsedBlocks.length > 0 && (blocks.length > 1 || parsedBlocks[0].filePath !== normPath(defaultActiveFile))) {
      return parsedBlocks;
    }
  }

  // Strategy 2: Split by inline file comment headers
  const headerRegex = /(?:^|\n)\s*(?:\/\/|\/\*|#+)\s*(?:file:?\s*|---\s*)?(?:(?:\d+|step\s*\d+|file\s*\d+)[\.:\-\)]\s*)?(?:src\/)?([a-zA-Z0-9_\-]+\.(?:js|ts|json|txt|prisma|sql|env|graphql))(?:\s*---|\s*\*\/)?\s*(?:\n|$)/gi;
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
        inlineFiles.push({ filePath: normPath(fn), code: formatCodeIndentation(stripComments(rawCode)) });
      }
    }
    if (inlineFiles.length > 0) {
      return inlineFiles;
    }
  }

  // Strategy 3: Raw text starting with a file header line
  let cleaned = parseSource.replace(/^```[a-z]*\s*\n?/i, '').replace(/```+$/g, '').trim();
  const topMatch = cleaned.match(fileHeaderPattern);
  if (topMatch && isValidFilename(topMatch[1])) {
    const fn = topMatch[1];
    cleaned = stripFileCommentHeaders(cleaned);
    return [{ filePath: normPath(fn), code: formatCodeIndentation(stripComments(cleaned)) }];
  }

  const singleCode = stripFileCommentHeaders(extractCodeBlock(parseSource));
  const finalSinglePath = resolveTargetFile('', singleCode, 0);
  return [{
    filePath: finalSinglePath,
    code: formatCodeIndentation(stripComments(singleCode))
  }];
}
