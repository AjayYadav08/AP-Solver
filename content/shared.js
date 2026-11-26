// content/shared.js - Shared DOM helpers, comment stripper, post-write command detector & bash script builder
(() => {
  if (window.top !== window) return;
  if (!/(^|\.)newtonschool\.co$/i.test(location.hostname)) return;

  const AP = (window.__AP = window.__AP || {});

  AP.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Sanitize active file name to never be numeric or in-memory. */
  AP.sanitizeActiveFile = function sanitizeActiveFile(name) {
    if (!name) return 'src/index.js';
    const s = String(name).trim();
    if (/^\d+$/.test(s) || /^(1|2|one|two)$/i.test(s) || /inmemory/i.test(s) || s === 'None') {
      return 'src/index.js';
    }
    return s;
  };

  AP.isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  AP.findButton = function findButton(re) {
    const btns = [...document.querySelectorAll('button, div[role="button"], a[role="button"]')];
    return btns.find((b) => AP.isVisible(b) && re.test(b.innerText.trim()) && !b.closest('#ap-solver-host'));
  };

  AP.triggerElementClick = function triggerElementClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.focus(); } catch (e) {}
    const opts = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
    try { el.click(); } catch (e) {}
  };

  /** Strip all single-line and multi-line comments while preserving string literals. */
  AP.stripAllComments = function stripAllComments(code) {
    if (!code) return '';
    const clean = code.replace(/\/\*[\s\S]*?\*\//g, '');
    return clean.split('\n').map(line => {
      let inQuote = false, qChar = '', cIdx = -1;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if ((ch === '"' || ch === "'" || ch === '`') && (i === 0 || line[i - 1] !== '\\')) {
          if (!inQuote) { inQuote = true; qChar = ch; }
          else if (ch === qChar) { inQuote = false; }
        } else if (!inQuote && ch === '/' && line[i + 1] === '/') {
          cIdx = i;
          break;
        }
      }
      return cIdx !== -1 ? line.substring(0, cIdx).trimEnd() : line;
    }).filter(l => l.trim() || !l).join('\n');
  };

  /** Detect required safe post-write terminal commands (npm build/migrate/install, prisma, backtick CLI). */
  AP.detectPostWriteCommands = function detectPostWriteCommands(questionDetails = '', pkgStr = '', filesToWrite = [], errOutput = '') {
    const cmds = [];
    const pushCmd = (c) => {
      const t = String(c || '').trim().replace(/^(?:\$|>\s*|#\s*)/, '').trim();
      if (!t || t.startsWith('#') || t.startsWith('//') || t.length > 260) return;
      if (/(?:rm\s+-[a-z]*rf?\s+\/(?:\s|$)|mkfs|shutdown|reboot|\|\s*(?:ba)?sh\b)/i.test(t)) return;
      if (/^(?:npm\s+(?:test|t|start)|npm\s+run\s+(?:test|start|dev|watch)\b|nodemon\b|node\s+(?:src\/)?index\.js\b)/i.test(t)) return;
      if (/^(?:npm\s+(?:install|i|ci|run\s+[\w:.-]+|exec)|npx\s+|node\s+|prisma\s+|tsc\b|psql\b|sqlite3\b|python3?\s+)/i.test(t) && !cmds.includes(t)) {
        cmds.push(t);
      }
    };

    let pkg = {};
    try { if (pkgStr) pkg = JSON.parse(pkgStr); } catch (e) {}
    const scripts = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const builtins = new Set([
      'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'http2', 'https',
      'module', 'net', 'os', 'path', 'process', 'querystring', 'readline', 'stream', 'timers',
      'tls', 'tty', 'url', 'util', 'zlib'
    ]);

    if (errOutput) {
      for (const m of String(errOutput).matchAll(/Cannot find module\s+['"]([^'"]+)['"]/gi)) {
        const mod = (m[1] || '').trim();
        if (!mod || mod.startsWith('.') || mod.startsWith('/') || mod.startsWith('node:')) continue;
        const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
        if (builtins.has(pkgName)) continue;
        if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkgName)) {
          pushCmd(deps[pkgName] ? 'npm install --no-audit --no-fund' : `npm install --no-audit --no-fund ${pkgName}`);
        }
      }
      if (/sh:\s*\d+:\s*(?:mocha|jest|tsc|prisma):\s*not found/i.test(errOutput)) pushCmd('npm install --no-audit --no-fund');
      if (/@prisma\/client did not initialize|PrismaClientInitializationError|table\s+.*\s+does not exist/i.test(errOutput)) {
        pushCmd('npx -y prisma generate');
        pushCmd('npx -y prisma db push --skip-generate');
      }
      if (/Cannot find module\s+['"]\.\/(?:dist|build)\//i.test(errOutput) && scripts.build) pushCmd('npm run build');
    }

    if ((filesToWrite || []).some(f => /\.ts$/i.test(f.filePath || '')) && scripts.build) pushCmd('npm run build');
    if (scripts.migrate) pushCmd('npm run migrate');
    if (questionDetails) {
      for (const bm of String(questionDetails).matchAll(/`((?:npm\s+run\s+(?:build|seed|migrate|setup|db:[a-z0-9_-]+)|npx\s+(?:prisma\s+(?:migrate|db\s+push|generate)|tsc)[^`]*|node\s+src\/(?:seed|init|setup|migrate)[^`]*))`/gi)) {
        pushCmd(bm[1]);
      }
    }
    return cmds;
  };

  /** Single shared atomic base64 terminal script builder (used by both content orchestrator and UI copy button). */
  AP.buildTerminalBashScript = function buildTerminalBashScript(filesToWrite, postCommands = [], cleanupFiles = []) {
    if (!filesToWrite || filesToWrite.length === 0) return '';
    let bashScript = '';
    bashScript += `git config --global --add safe.directory /app/code 2>/dev/null || true && `;
    bashScript += `(sudo -n true 2>/dev/null && sudo chmod -R 777 /app/code/.git 2>/dev/null && sudo chown -R newton:newton /app/code 2>/dev/null || true) && `;
    bashScript += `(rm -f .git/index.lock 2>/dev/null || true) && `;
    for (const stale of (Array.isArray(cleanupFiles) ? cleanupFiles : [])) {
      const s = String(stale || '').trim();
      if (s && !s.startsWith('/') && !s.includes('..') && /^[a-zA-Z0-9_.\-\/]+$/.test(s)) {
        bashScript += `rm -f "${s}" 2>/dev/null || true && `;
      }
    }
    bashScript += `sed -i '/mkdir -p/d' src/index.js 2>/dev/null || true && `;
    bashScript += `sed -i '/base64 -d/d' src/index.js 2>/dev/null || true && `;
    bashScript += `sed -i '/=== AP-SOLVER/d' src/index.js 2>/dev/null || true && `;
    bashScript += `git checkout -- src/index.js 2>/dev/null || true && `;

    const hasPrisma = filesToWrite.some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client|model\s+/i.test(f.code));
    const hasSeed = filesToWrite.some(f => (f.filePath && f.filePath.endsWith('seed.js')) || /prisma\.\w+\.(create|deleteMany)/i.test(f.code));

    for (const f of filesToWrite) {
      let targetPath = f.filePath;
      if (targetPath.endsWith('.prisma') || /datasource\s+db|generator\s+client/i.test(f.code)) {
        targetPath = 'prisma/schema.prisma';
      } else if (/PrismaClient|prisma\.\w+\.(create|deleteMany)/i.test(f.code) && !/express|createServer/i.test(f.code)) {
        targetPath = 'src/seed.js';
      }
      const dir = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '';
      if (dir) bashScript += `mkdir -p "${dir}" && `;
      const cleanCode = /\.(?:html?|txt|md|json|env|svg|xml)$/i.test(targetPath)
        ? (f.code || '').trim()
        : AP.stripAllComments(f.code || '').trim();
      let b64 = '';
      try { b64 = btoa(unescape(encodeURIComponent(cleanCode))); }
      catch (e) { b64 = btoa(cleanCode); }
      bashScript += `echo "${b64}" | base64 -d > "${targetPath}" && `;
      if (targetPath.endsWith('schema.prisma') || targetPath === 'prisma/schema.prisma') {
        bashScript += `cp "${targetPath}" ./schema.prisma 2>/dev/null || true && `;
        bashScript += `mkdir -p prisma && cp "${targetPath}" prisma/schema.prisma 2>/dev/null || true && `;
      } else if (targetPath.endsWith('seed.js')) {
        bashScript += `cp "${targetPath}" ./seed.js 2>/dev/null || true && `;
        bashScript += `mkdir -p src && cp "${targetPath}" src/seed.js 2>/dev/null || true && `;
      }
    }

    const hasIndex = filesToWrite.some(f => f.filePath && f.filePath.endsWith('index.js'));
    if (!hasIndex && (hasSeed || hasPrisma)) {
      const starterIndex = `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 8000;\napp.use(express.json());\napp.get('/', (req, res) => { res.send('Server is running'); });\nif (process.env.NODE_ENV !== 'test') {\n  app.listen(PORT, () => { console.log('Server running on port ' + PORT); });\n}\nmodule.exports = app;`;
      let b64Index = '';
      try { b64Index = btoa(unescape(encodeURIComponent(starterIndex))); }
      catch (e) { b64Index = btoa(starterIndex); }
      bashScript += `mkdir -p "src" && echo "${b64Index}" | base64 -d > "src/index.js" && `;
    }

    if (hasPrisma || hasSeed) {
      bashScript += `node -e 'try { const p="./package.json", pkg=require(p); pkg.prisma = pkg.prisma || {}; pkg.prisma.seed = "node src/seed.js"; require("fs").writeFileSync(p, JSON.stringify(pkg, null, 2)); } catch(e){}' 2>/dev/null || true && `;
      bashScript += `npm install --save-dev prisma 2>/dev/null || true && npm install @prisma/client 2>/dev/null || true && `;
      bashScript += `(npx -y prisma db push --skip-generate 2>/dev/null || true) && (npx -y prisma generate 2>/dev/null || true) && `;
    }
    if (hasSeed) {
      bashScript += `if [ -f src/seed.js ]; then node src/seed.js || true; elif [ -f seed.js ]; then node seed.js || true; fi && `;
    }
    for (const pc of (postCommands || [])) {
      if ((hasPrisma || hasSeed) && /(?:prisma\s+(?:db\s+push|generate)|src\/seed\.js)/i.test(pc)) continue;
      bashScript += `(${pc} || true) && `;
    }
    bashScript += `(rm -f .git/index.lock 2>/dev/null; git config user.email "solver@ap.dev" 2>/dev/null; git config user.name "AP-Solver" 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true) && `;
    bashScript += `echo "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ==="`;
    return bashScript;
  };
})();
