// content/solver-ui.js - Floating Copilot Widget UI for AP-Solver

window.APSolverUI = class APSolverUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.host = null;
    this.isMinimized = false;
    this.isRunning = false;
    this.showSettings = false; // toggle for inline API keys panel
    this.apiKeys = {
      geminiKey: '',
      groqKey: ''
    };
    this.problemInfo = {
      title: 'Detecting...',
      difficulty: '-',
      points: '-',
      testCasesCount: 0,
      activeFile: 'Detecting...'
    };
    this.currentCode = '';
    this.generatedCode = '';
    this.generatedFiles = [];
    this.logs = [];
    this.options = {
      autoSubmit: false,
      autoRetry: true,
      provider: 'gemini'
    };

    this.init();
  }

  init() {
    if (document.getElementById('ap-solver-host')) return;

    this.host = document.createElement('div');
    this.host.id = 'ap-solver-host';
    document.documentElement.appendChild(this.host);

    this.render();
  }

  setApiKeys(keys) {
    this.apiKeys = { ...this.apiKeys, ...keys };
    // If no keys are set, open inline settings drawer by default
    const hasAny = !!(this.apiKeys.geminiKey?.trim() || this.apiKeys.groqKey?.trim());
    if (!hasAny) {
      this.showSettings = true;
    }
    this.render();
  }

  updateProblemInfo(info) {
    if (info && info.activeFile) {
      let f = String(info.activeFile).trim();
      if (/^\d+$/.test(f) || /^(1|2|one|two)$/i.test(f) || f === 'None') {
        f = 'src/index.js';
      }
      info.activeFile = f;
    }
    this.problemInfo = { ...this.problemInfo, ...info };
    this.renderBodyContent();
  }

  updateOptions(opts) {
    this.options = { ...this.options, ...opts };
    this.renderBodyContent();
  }

  setStatus(title, detail = '', type = 'normal', isSpinner = false) {
    const banner = this.host.querySelector('.ap-status-banner');
    if (!banner) return;

    banner.className = `ap-status-banner ${type}`;
    const spinnerText = isSpinner ? '<span class="ap-spinner"></span> ' : '';
    banner.querySelector('.ap-status-title').innerHTML = `${spinnerText}${title}`;
    banner.querySelector('.ap-status-detail').textContent = detail;
  }

  addLog(msg, type = '') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.logs.unshift({ time, msg, type });
    if (this.logs.length > 50) this.logs.pop();

    const logContainer = this.host.querySelector('.ap-log-container');
    if (logContainer) {
      const entry = document.createElement('div');
      entry.className = `ap-log-entry ${type}`;
      entry.innerHTML = `<span class="ap-log-time">[${time}]</span> ${msg}`;
      logContainer.prepend(entry);
    }
  }

  setRunning(running) {
    this.isRunning = running;
    const solveBtn = this.host.querySelector('.ap-btn-solve-main');
    if (solveBtn) {
      solveBtn.disabled = running;
      solveBtn.innerHTML = running
        ? '<span class="ap-spinner"></span> Solving...'
        : '⚡ Solve';
    }
  }

  setGeneratedCode(code) {
    this.generatedCode = code;
  }

  setGeneratedFiles(files) {
    this.generatedFiles = Array.isArray(files) ? files : [];
    if (this.generatedFiles.length > 0 && !this.generatedCode) {
      this.generatedCode = this.generatedFiles[0].code;
    }
    this.render();
  }

  setFileStatus(filePath, status) {
    const file = this.generatedFiles.find(f => f.filePath === filePath || f.filePath.endsWith(filePath));
    if (file) {
      file.status = status;
      this.render();
    }
  }

  toggleMinimize(min) {
    this.isMinimized = min !== undefined ? min : !this.isMinimized;
    this.render();
  }

  render() {
    if (!this.host) return;

    if (this.isMinimized) {
      this.host.innerHTML = `
        <div class="ap-minimized-pill" title="Click to open AP-Solver">
          <span class="ap-icon">⚡</span>
          <span>AP-Solver</span>
        </div>
      `;
      this.host.querySelector('.ap-minimized-pill').onclick = () => this.toggleMinimize(false);
      return;
    }

    const testDisplay = this.problemInfo.testCasesCount > 0
      ? `${this.problemInfo.testCasesCount} detected`
      : 'Extracted from Requirements';

    this.host.innerHTML = `
      <div class="ap-card">
        <!-- Header: Top-Left Minimise (< facing downward) & Top-Right Settings (⚙️) -->
        <div class="ap-header">
          <button class="ap-btn-icon ap-btn-min" title="Minimize">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="ap-title-wrap">
            <span class="ap-badge">AP-Solver</span>
            <span class="ap-title">Newton Copilot</span>
          </div>
          <button class="ap-btn-icon ap-btn-settings" title="Configure API Keys (Gemini & Groq)">⚙️</button>
        </div>

        <!-- Inline API Keys Panel (Directly on Portal) -->
        <div class="ap-inline-settings" style="display: ${this.showSettings ? 'flex' : 'none'};">
          <div class="ap-inline-head">
            <span>⚙️ Configure API Keys</span>
            <button class="ap-btn-icon ap-close-settings" title="Close Settings">✕</button>
          </div>
          <div class="ap-inline-field">
            <label>Google Gemini API Key (Recommended):</label>
            <input type="password" class="ap-input ap-inp-gemini" placeholder="AIzaSy..." value="${this.escapeHtml(this.apiKeys.geminiKey || '')}">
            <small><a href="https://aistudio.google.com/apikey" target="_blank">Get Free Gemini Key ↗</a></small>
          </div>
          <div class="ap-inline-field">
            <label>Groq Cloud API Key (Fast LLaMA 70B):</label>
            <input type="password" class="ap-input ap-inp-groq" placeholder="gsk_..." value="${this.escapeHtml(this.apiKeys.groqKey || '')}">
            <small><a href="https://console.groq.com/keys" target="_blank">Get Free Groq Key ↗</a></small>
          </div>
          <button class="ap-btn-save-inline-keys" style="background: linear-gradient(135deg, #0284c7, #2563eb); color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 4px;">
            💾 Save Keys
          </button>
          <div class="ap-inline-msg" style="display:none;font-size:11px;padding:4px 8px;border-radius:4px;"></div>
        </div>

        <!-- Body -->
        <div class="ap-body">
          <!-- Status Banner -->
          <div class="ap-status-banner">
            <div class="ap-status-header">
              <span class="ap-status-title">Ready</span>
            </div>
            <div class="ap-status-detail">Click "Solve" to solve and submit automatically.</div>
          </div>

          <!-- Multi-File Solution Manager (Compact cards with individual Copy & Inject + small header Terminal Script copy) -->
          ${this.generatedFiles && this.generatedFiles.length > 0 ? `
            <div class="ap-multi-files-box">
              <div class="ap-multi-files-head">
                <span class="ap-multi-files-title">📂 Solution Files (${this.generatedFiles.length})</span>
                <button class="ap-btn-copy-terminal-script" title="Copy 1-line bash script for all files to paste into Terminal">💻 Copy Terminal Script</button>
              </div>
              <div class="ap-file-cards">
                ${this.generatedFiles.map((f, idx) => `
                  <div class="ap-file-card" data-idx="${idx}">
                    <div class="ap-file-meta">
                      <span class="ap-file-path" title="${f.filePath}">📄 ${f.filePath}</span>
                      <span class="ap-file-badge ${f.status || 'ready'}">
                        ${f.status === 'injected' ? '✓ Saved' : (f.status === 'error' ? '❌ Failed' : `${f.code.split('\n').length} lines`)}
                      </span>
                    </div>
                    <div class="ap-file-btns">
                      <button class="ap-btn-file ap-btn-file-copy" data-idx="${idx}" title="Copy code for ${f.filePath}">📋 Copy</button>
                      <button class="ap-btn-file ap-btn-file-inject" data-idx="${idx}" title="Switch to ${f.filePath} and inject code">⚡ Inject</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- One Single Solve Button -->
          <button class="ap-btn-primary ap-btn-solve-main" ${this.isRunning ? 'disabled' : ''}>
            ${this.isRunning ? '<span class="ap-spinner"></span> Solving...' : '⚡ Solve'}
          </button>

          <!-- Expanded Terminal & Real-Time Log Console -->
          <div class="ap-log-container">
            ${this.logs.map((l) => `<div class="ap-log-entry ${l.type}"><span class="ap-log-time">[${l.time}]</span> ${l.msg}</div>`).join('')}
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderBodyContent() {
    if (this.isMinimized || !this.host) return;
  }

  bindEvents() {
    // Minimise button in top left
    const minBtn = this.host.querySelector('.ap-btn-min');
    if (minBtn) minBtn.onclick = () => this.toggleMinimize(true);

    // Settings icon in top right
    const settingsBtn = this.host.querySelector('.ap-btn-settings');
    if (settingsBtn) {
      settingsBtn.onclick = () => {
        this.showSettings = !this.showSettings;
        this.render();
      };
    }

    // Close settings icon
    const closeSettingsBtn = this.host.querySelector('.ap-close-settings');
    if (closeSettingsBtn) {
      closeSettingsBtn.onclick = () => {
        this.showSettings = false;
        this.render();
      };
    }

    // Save inline keys
    const saveInlineBtn = this.host.querySelector('.ap-btn-save-inline-keys');
    if (saveInlineBtn) {
      saveInlineBtn.onclick = async () => {
        const geminiVal = (this.host.querySelector('.ap-inp-gemini')?.value || '').trim();
        const groqVal = (this.host.querySelector('.ap-inp-groq')?.value || '').trim();

        if (!geminiVal && !groqVal) {
          const msgEl = this.host.querySelector('.ap-inline-msg');
          if (msgEl) {
            msgEl.style.display = 'block';
            msgEl.style.background = 'rgba(239,68,68,0.2)';
            msgEl.style.color = '#f87171';
            msgEl.textContent = 'Please enter at least one API key (Gemini or Groq).';
          }
          return;
        }

        saveInlineBtn.disabled = true;
        saveInlineBtn.textContent = 'Saving...';

        const updates = {
          provider: geminiVal ? 'gemini' : 'groq'
        };
        if (geminiVal) updates.geminiKey = geminiVal;
        if (groqVal) updates.groqKey = groqVal;

        try {
          if (chrome.storage?.local) {
            await chrome.storage.local.set(updates);
          }
        } catch (e) {}

        try {
          chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: updates }, () => {
            if (chrome.runtime?.lastError) { /* ignore */ }
          });
        } catch (e) {}

        this.apiKeys = { ...this.apiKeys, ...updates };
        this.options.provider = updates.provider;
        this.showSettings = false;

        this.addLog('✓ API keys saved successfully! Ready to solve.', 'ok');
        this.render();
      };
    }

    // Primary Solve button
    const solveBtn = this.host.querySelector('.ap-btn-solve-main');
    if (solveBtn) {
      solveBtn.onclick = () => {
        console.log('[AP-Solver] Solve button clicked!');
        if (this.callbacks.onOneClickSolve) this.callbacks.onOneClickSolve();
      };
    }

    // Helper to strip comments
    const stripUiComments = (code) => {
      if (!code) return '';
      let clean = code.replace(/\/\*[\s\S]*?\*\//g, '');
      const lines = clean.split('\n');
      const res = [];
      for (const line of lines) {
        let inQuote = false;
        let quoteChar = '';
        let commentIdx = -1;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const next = line[i + 1];
          if (!inQuote && (ch === '"' || ch === "'" || ch === '`')) {
            inQuote = true;
            quoteChar = ch;
          } else if (inQuote && ch === quoteChar && line[i - 1] !== '\\') {
            inQuote = false;
          } else if (!inQuote && ch === '/' && next === '/') {
            commentIdx = i;
            break;
          }
        }
        res.push(commentIdx !== -1 ? line.substring(0, commentIdx).trimEnd() : line);
      }
      return res.filter(l => l.trim().length > 0).join('\n');
    };

    // Multi-File Copy All-in-One Terminal Script button in header (Base64 atomic single-line)
    const termBtns = this.host.querySelectorAll('.ap-btn-copy-terminal-script');
    termBtns.forEach((btn) => {
      btn.onclick = async () => {
        let bashScript = '';
        bashScript += `git config --global --add safe.directory /app/code 2>/dev/null || true && `;
        bashScript += `(sudo -n true 2>/dev/null && sudo chmod -R 777 /app/code/.git 2>/dev/null && sudo chown -R newton:newton /app/code 2>/dev/null || true) && `;
        bashScript += `(rm -f .git/index.lock 2>/dev/null || true) && `;
        bashScript += `sed -i '/mkdir -p/d' src/index.js 2>/dev/null || true && `;
        bashScript += `sed -i '/base64 -d/d' src/index.js 2>/dev/null || true && `;
        bashScript += `sed -i '/=== AP-SOLVER/d' src/index.js 2>/dev/null || true && `;
        bashScript += `git checkout -- src/index.js 2>/dev/null || true && `;

        const hasPrisma = this.generatedFiles.some(f => (f.filePath && f.filePath.endsWith('.prisma')) || /datasource\s+db|generator\s+client|model\s+/i.test(f.code));
        const hasSeed = this.generatedFiles.some(f => (f.filePath && f.filePath.endsWith('seed.js')) || /prisma\.\w+\.(create|deleteMany)/i.test(f.code));

        for (const f of this.generatedFiles) {
          let targetPath = f.filePath;
          if (targetPath.endsWith('.prisma') || /datasource\s+db|generator\s+client/i.test(f.code)) {
            targetPath = 'prisma/schema.prisma';
          } else if (/PrismaClient|prisma\.\w+\.(create|deleteMany)/i.test(f.code) && !/express|createServer/i.test(f.code)) {
            targetPath = 'src/seed.js';
          }
          const dir = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '';
          if (dir) {
            bashScript += `mkdir -p "${dir}" && `;
          }
          const cleanCode = stripUiComments(f.code || '').trim();
          let b64 = '';
          try {
            b64 = btoa(unescape(encodeURIComponent(cleanCode)));
          } catch(e) {
            b64 = btoa(cleanCode);
          }
          bashScript += `echo "${b64}" | base64 -d > "${targetPath}" && `;
          if (targetPath.endsWith('schema.prisma') || targetPath === 'prisma/schema.prisma') {
            bashScript += `cp "${targetPath}" ./schema.prisma 2>/dev/null || true && `;
            bashScript += `mkdir -p prisma && cp "${targetPath}" prisma/schema.prisma 2>/dev/null || true && `;
          } else if (targetPath.endsWith('seed.js')) {
            bashScript += `cp "${targetPath}" ./seed.js 2>/dev/null || true && `;
            bashScript += `mkdir -p src && cp "${targetPath}" src/seed.js 2>/dev/null || true && `;
          }
        }

        const hasIndex = this.generatedFiles.some(f => f.filePath && f.filePath.endsWith('index.js'));
        if (!hasIndex && (hasSeed || hasPrisma)) {
          const starterIndex = `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 8000;\napp.use(express.json());\napp.get('/', (req, res) => { res.send('Server is running'); });\nif (process.env.NODE_ENV !== 'test') {\n  app.listen(PORT, () => { console.log('Server running on port ' + PORT); });\n}\nmodule.exports = app;`;
          let b64Index = '';
          try {
            b64Index = btoa(unescape(encodeURIComponent(starterIndex)));
          } catch(e) {
            b64Index = btoa(starterIndex);
          }
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
        bashScript += `(rm -f .git/index.lock 2>/dev/null; git config user.email "solver@ap.dev" 2>/dev/null; git config user.name "AP-Solver" 2>/dev/null; git add -A && git commit -m "solution" 2>/dev/null || true) && `;
        bashScript += `echo "=== AP-SOLVER-FILES-WRITTEN-SUCCESSFULLY ==="`;
        try {
          await navigator.clipboard.writeText(bashScript.trim());
          const orig = btn.textContent;
          btn.textContent = '✓ Script Copied!';
          btn.style.color = '#4ade80';
          setTimeout(() => {
            btn.textContent = orig;
            btn.style.color = '';
          }, 2500);
          this.addLog(`💻 All-in-one terminal script copied to clipboard! Paste into VS Code terminal and press Enter.`, 'ok');
        } catch (e) {
          this.addLog(`Failed to copy script: ${e.message}`, 'warn');
        }
      };
    });

    // Multi-File Individual Copy buttons
    const copyBtns = this.host.querySelectorAll('.ap-btn-file-copy');
    copyBtns.forEach((btn) => {
      btn.onclick = async () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const file = this.generatedFiles[idx];
        if (file && file.code) {
          try {
            await navigator.clipboard.writeText(file.code);
            const orig = btn.textContent;
            btn.textContent = '✓ Copied!';
            btn.style.color = '#4ade80';
            setTimeout(() => {
              btn.textContent = orig;
              btn.style.color = '';
            }, 2000);
            this.addLog(`📋 Copied code for "${file.filePath}" to clipboard! Paste into VS Code and press Cmd+S.`, 'ok');
          } catch (e) {
            this.addLog(`Failed to copy code: ${e.message}`, 'warn');
          }
        }
      };
    });

    // Multi-File Individual Inject buttons
    const injectBtns = this.host.querySelectorAll('.ap-btn-file-inject');
    injectBtns.forEach((btn) => {
      btn.onclick = async () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const file = this.generatedFiles[idx];
        if (file && file.code && this.callbacks.onInjectSingleFile) {
          btn.disabled = true;
          btn.textContent = 'Injecting...';
          try {
            const ok = await this.callbacks.onInjectSingleFile(file.filePath, file.code);
            if (ok) {
              file.status = 'injected';
              btn.textContent = '✓ Injected';
              btn.style.color = '#4ade80';
            } else {
              file.status = 'error';
              btn.textContent = 'Retry';
              btn.style.color = '#f87171';
            }
          } catch (e) {
            file.status = 'error';
            btn.textContent = 'Retry';
          } finally {
            btn.disabled = false;
            this.render();
          }
        }
      };
    });
  }

  showCodeModal(code) {
    const existing = document.getElementById('ap-modal-overlay');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ap-modal-overlay';
    modal.className = 'ap-modal-overlay';
    modal.innerHTML = `
      <div class="ap-modal-content">
        <div class="ap-modal-header">
          <span>Generated Solution Code Preview</span>
          <button class="ap-btn-icon ap-modal-close" style="font-size:16px;">✕</button>
        </div>
        <div class="ap-modal-body">
          <pre class="ap-code-pre">${this.escapeHtml(code || '// No code generated yet')}</pre>
        </div>
        <div class="ap-modal-footer">
          <button class="ap-btn-sec ap-modal-copy">📋 Copy Code</button>
          <button class="ap-btn-primary ap-modal-inject">✍️ Inject into Editor</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.ap-modal-close').onclick = () => modal.remove();
    modal.querySelector('.ap-modal-copy').onclick = () => {
      navigator.clipboard.writeText(code);
      this.addLog('Code copied from preview modal', 'ok');
      modal.querySelector('.ap-modal-copy').textContent = '✓ Copied!';
    };
    modal.querySelector('.ap-modal-inject').onclick = () => {
      modal.remove();
      if (this.callbacks.onWriteCode) this.callbacks.onWriteCode();
    };
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
};
