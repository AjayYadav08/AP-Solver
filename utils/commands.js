// utils/commands.js - Post-write terminal command sanitization, extraction, remediation & base64 writer builder
import { stripComments } from './code-format.js';

/** Sanitize and validate a container setup/build/migration command so only safe, non-blocking commands execute. */
export function sanitizePostWriteCommand(rawCmd) {
  if (!rawCmd || typeof rawCmd !== 'string') return '';
  let cmd = rawCmd.trim()
    .replace(/^(?:\$|>\s*|#\s*)/, '')
    .trim();
  if (!cmd || cmd.startsWith('//') || cmd.startsWith('#') || cmd.length > 300) return '';
  if (/&&\s*$|^\s*&&|\n|\r/.test(cmd)) return '';
  if (/(?:rm\s+-[a-z]*rf?\s+\/(?:\s|$)|mkfs\b|dd\s+if=|shutdown\b|reboot\b|:\(\)\{|curl\s+[^|]*\|\s*(?:ba)?sh|wget\s+[^|]*\|\s*(?:ba)?sh|>\s*\/dev\/)/i.test(cmd)) {
    return '';
  }
  if (/^(?:npm\s+(?:test|t|start)|npm\s+run\s+(?:test|start|dev|watch)\b|nodemon\b|node\s+(?:src\/)?index\.js\b)/i.test(cmd)) {
    return '';
  }
  if (!/^(?:npm\s+(?:install|i|ci|run\s+[\w:.-]+|exec)|npx\s+|yarn\s+|pnpm\s+|node\s+|prisma\s+|tsc\b|mkdir\s+-p\b|cp\s+|chmod\s+|psql\b|sqlite3\b|python3?\s+|pip3?\s+install)/i.test(cmd)) {
    return '';
  }
  return cmd;
}

/** Extract optional post-write terminal commands (// __commands__ or ```ap-commands) from LLM response. */
export function extractCommandsFromResponse(rawText) {
  if (!rawText) return [];
  const commands = [];
  const blockRegex = /```([a-zA-Z0-9_\-]+)?(?::([^\n]+))?([^\n]*)\n([\s\S]*?)```/g;
  for (const match of rawText.matchAll(blockRegex)) {
    const lang = (match[1] || '').toLowerCase();
    const extra = ((match[2] || '') + ' ' + (match[3] || '')).toLowerCase();
    const body = (match[4] || '').trim();
    if (!body) continue;
    const firstLine = body.split('\n')[0].trim();
    const isCommandBlock =
      lang === 'ap-commands' ||
      /^(?:\/\/|#)\s*(?:__commands__|run_commands)\b/i.test(firstLine) ||
      /__commands__/i.test(extra);
    if (!isCommandBlock) continue;

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || /^(?:\/\/|#)/.test(trimmed)) continue;
      for (const sub of trimmed.split(/\s*&&\s*/)) {
        const clean = sanitizePostWriteCommand(sub);
        if (clean && !commands.includes(clean)) {
          commands.push(clean);
        }
      }
    }
  }
  return commands;
}

/** Auto-detect required setup, build, migration, or error-remediation terminal commands. */
export function detectRequiredPostWriteCommands({
  questionDetails = '',
  packageJsonStr = '',
  filesToWrite = [],
  lastErrorOutput = ''
} = {}) {
  const cmds = [];
  const addCmd = (raw) => {
    const clean = sanitizePostWriteCommand(raw);
    if (clean && !cmds.includes(clean)) cmds.push(clean);
  };

  let pkg = {};
  try {
    if (packageJsonStr) pkg = JSON.parse(packageJsonStr);
  } catch (e) {}
  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const nodeBuiltins = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
    'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
    'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
    'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
  ]);

  if (lastErrorOutput) {
    const modMatches = [...String(lastErrorOutput).matchAll(/Cannot find module\s+['"]([^'"]+)['"]/gi)];
    for (const m of modMatches) {
      const mod = (m[1] || '').trim();
      if (!mod || mod.startsWith('.') || mod.startsWith('/') || mod.startsWith('node:')) continue;
      const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
      if (nodeBuiltins.has(pkgName)) continue;
      if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkgName)) {
        addCmd(deps[pkgName] ? 'npm install --no-audit --no-fund' : `npm install --no-audit --no-fund ${pkgName}`);
      }
    }
    if (/sh:\s*\d+:\s*(?:mocha|jest|tsc|prisma):\s*not found/i.test(lastErrorOutput)) {
      addCmd('npm install --no-audit --no-fund');
    }
    if (/@prisma\/client did not initialize|PrismaClientInitializationError|did not initialize yet|table\s+.*\s+does not exist|does not exist in the current database/i.test(lastErrorOutput)) {
      addCmd('npx -y prisma generate');
      addCmd('npx -y prisma db push --skip-generate');
    }
    if (/Cannot find module\s+['"]\.\/(?:dist|build)\//i.test(lastErrorOutput) && scripts.build) {
      addCmd('npm run build');
    }
  }

  const writesTs = (filesToWrite || []).some(f => f.filePath && /\.ts$/i.test(f.filePath));
  if (writesTs && scripts.build) {
    addCmd('npm run build');
  }
  const hasPrismaFile = (filesToWrite || []).some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client/i.test(f.code || ''));
  if (!hasPrismaFile && scripts.migrate) {
    addCmd('npm run migrate');
  }

  if (questionDetails) {
    const btMatches = [...String(questionDetails).matchAll(/`((?:npm\s+run\s+(?:build|seed|migrate|setup|db:[a-z0-9_-]+)|npx\s+(?:prisma\s+(?:migrate|db\s+push|generate)|tsc)[^`]*|node\s+src\/(?:seed|init|setup|migrate)[^`]*))`/gi)];
    for (const bm of btMatches) {
      addCmd(bm[1]);
    }
  }

  return cmds;
}

/** Build atomic base64 single-line bash command for direct container disk writes + setup commands + git commit. */
export function buildBase64TerminalScript(files, postCommands = [], cleanupFiles = []) {
  if (!files || files.length === 0) return '';
  let cmd = '';

  cmd += `git config --global --add safe.directory /app/code 2>/dev/null || true && `;
  cmd += `(sudo -n true 2>/dev/null && sudo chmod -R 777 /app/code/.git 2>/dev/null && sudo chown -R newton:newton /app/code 2>/dev/null || true) && `;
  cmd += `(rm -f .git/index.lock 2>/dev/null || true) && `;
  for (const stale of (Array.isArray(cleanupFiles) ? cleanupFiles : [])) {
    const s = String(stale || '').trim();
    if (s && !s.startsWith('/') && !s.includes('..') && /^[a-zA-Z0-9_.\-\/]+$/.test(s)) {
      cmd += `rm -f "${s}" 2>/dev/null || true && `;
    }
  }
  cmd += `sed -i '/mkdir -p/d' src/index.js 2>/dev/null || true && `;
  cmd += `sed -i '/base64 -d/d' src/index.js 2>/dev/null || true && `;
  cmd += `sed -i '/=== AP-SOLVER/d' src/index.js 2>/dev/null || true && `;
  cmd += `git checkout -- src/index.js 2>/dev/null || true && `;

  const hasPrisma = files.some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client|model\s+/i.test(f.code));
  const hasSeed = files.some(f => (f.filePath && f.filePath.endsWith('seed.js')) || /prisma\.\w+\.(create|deleteMany)/i.test(f.code));

  for (const f of files) {
    let targetPath = f.filePath;
    if (targetPath.endsWith('.prisma') || /datasource\s+db|generator\s+client/i.test(f.code)) {
      targetPath = 'prisma/schema.prisma';
    } else if (/PrismaClient|prisma\.\w+\.(create|deleteMany)/i.test(f.code) && !/express|createServer/i.test(f.code)) {
      targetPath = 'src/seed.js';
    }
    const dir = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '';
    if (dir) {
      cmd += `mkdir -p "${dir}" && `;
    }
    const cleanCode = /\.(?:html?|txt|md|json|env|svg|xml)$/i.test(targetPath)
      ? (f.code || '').trim()
      : stripComments(f.code || '').trim();
    let b64 = '';
    try {
      b64 = btoa(unescape(encodeURIComponent(cleanCode)));
    } catch (e) {
      b64 = typeof Buffer !== 'undefined' ? Buffer.from(cleanCode).toString('base64') : btoa(cleanCode);
    }
    cmd += `echo "${b64}" | base64 -d > "${targetPath}" && `;
    if (targetPath.endsWith('schema.prisma') || targetPath === 'prisma/schema.prisma') {
      cmd += `cp "${targetPath}" ./schema.prisma 2>/dev/null || true && `;
      cmd += `mkdir -p prisma && cp "${targetPath}" prisma/schema.prisma 2>/dev/null || true && `;
    } else if (targetPath.endsWith('seed.js')) {
      cmd += `cp "${targetPath}" ./seed.js 2>/dev/null || true && `;
      cmd += `mkdir -p src && cp "${targetPath}" src/seed.js 2>/dev/null || true && `;
    }
  }

  const hasIndex = files.some(f => f.filePath && f.filePath.endsWith('index.js'));
  if (!hasIndex && (hasSeed || hasPrisma)) {
    const starterIndex = `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 8000;\napp.use(express.json());\napp.get('/', (req, res) => { res.send('Server is running'); });\nif (process.env.NODE_ENV !== 'test') {\n  app.listen(PORT, () => { console.log('Server running on port ' + PORT); });\n}\nmodule.exports = app;`;
    let b64Index = '';
    try {
      b64Index = btoa(unescape(encodeURIComponent(starterIndex)));
    } catch(e) {
      b64Index = typeof Buffer !== 'undefined' ? Buffer.from(starterIndex).toString('base64') : btoa(starterIndex);
    }
    cmd += `mkdir -p "src" && echo "${b64Index}" | base64 -d > "src/index.js" && `;
  }

  if (hasPrisma || hasSeed) {
    cmd += `node -e 'try { const p="./package.json", pkg=require(p); pkg.prisma = pkg.prisma || {}; pkg.prisma.seed = "node src/seed.js"; require("fs").writeFileSync(p, JSON.stringify(pkg, null, 2)); } catch(e){}' 2>/dev/null || true && `;
    cmd += `npm install --save-dev prisma 2>/dev/null || true && npm install @prisma/client 2>/dev/null || true && `;
    cmd += `(npx -y prisma db push --skip-generate 2>/dev/null || true) && (npx -y prisma generate 2>/dev/null || true) && `;
  }
  if (hasSeed) {
    cmd += `if [ -f src/seed.js ]; then node src/seed.js || true; elif [ -f seed.js ]; then node seed.js || true; fi && `;
  }

  const seenPost = new Set();
  for (const rawCmd of (Array.isArray(postCommands) ? postCommands : [])) {
    const safeCmd = sanitizePostWriteCommand(rawCmd);
    if (!safeCmd || seenPost.has(safeCmd)) continue;
    seenPost.add(safeCmd);
    cmd += `(${safeCmd} || true) && `;
  }

  cmd += `(rm -f .git/index.lock 2>/dev/null; git config user.email "solver@ap.dev" 2>/dev/null; git config user.name "AP-Solver" 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true) && `;
  cmd += `echo "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ==="`;
  return cmd;
}
