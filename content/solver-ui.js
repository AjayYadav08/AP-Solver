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
        ? '<span class="ap-spinner"></span> Solving Question...'
        : '⚡ Solve & Submit Solution';
    }

    const secBtns = this.host.querySelectorAll('.ap-btn-sec');
    secBtns.forEach((b) => (b.disabled = running));
  }

  setGeneratedCode(code) {
    this.generatedCode = code;
    const viewBtn = this.host.querySelector('.ap-btn-view-code');
    if (viewBtn) {
      viewBtn.style.display = code ? 'inline-flex' : 'none';
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
        <!-- Header -->
        <div class="ap-header">
          <div class="ap-title-wrap">
            <button class="ap-btn-icon ap-btn-settings" title="Change API Keys (Gemini & Groq)">⚙️</button>
            <span class="ap-badge">AP-Solver</span>
            <span class="ap-title">3-Section Copilot</span>
          </div>
          <div class="ap-actions-top">
            <button class="ap-btn-icon ap-btn-min" title="Minimize">─</button>
          </div>
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
            <div class="ap-status-detail">Click "Solve & Submit Solution" to solve automatically.</div>
          </div>

          <!-- Problem & Editor Detected Box -->
          <div class="ap-info-box">
            <div class="ap-info-row">
              <span class="ap-info-label">Question:</span>
              <span class="ap-info-val ap-val-title" title="${this.problemInfo.title}">${this.problemInfo.title}</span>
            </div>
            <div class="ap-info-row">
              <span class="ap-info-label">Difficulty / XP:</span>
              <span class="ap-info-val ap-val-diff">${this.problemInfo.difficulty} (${this.problemInfo.points})</span>
            </div>
            <div class="ap-info-row">
              <span class="ap-info-label">Test Cases:</span>
              <span class="ap-info-val ap-val-tests">${testDisplay}</span>
            </div>
            <div class="ap-info-row">
              <span class="ap-info-label">Active File:</span>
              <span class="ap-info-val ap-val-file" title="${this.problemInfo.activeFile}">${this.problemInfo.activeFile}</span>
            </div>
          </div>

          <!-- Primary One-Click Action -->
          <button class="ap-btn-primary ap-btn-solve-main" ${this.isRunning ? 'disabled' : ''}>
            ${this.isRunning ? '<span class="ap-spinner"></span> Solving...' : '⚡ Solve & Submit Solution'}
          </button>

          <!-- Secondary Step-by-Step Grid -->
          <div class="ap-btn-grid">
            <button class="ap-btn-sec ap-btn-read">📖 Read Context</button>
            <button class="ap-btn-sec ap-btn-gen">🧠 Generate</button>
            <button class="ap-btn-sec ap-btn-write">✍️ Inject Code</button>
            <button class="ap-btn-sec ap-btn-submit">🚀 Submit</button>
          </div>

          <div class="ap-btn-grid">
            <button class="ap-btn-sec ap-btn-copy" style="grid-column: span 1;">📋 Copy Code</button>
            <button class="ap-btn-sec ap-btn-view-code" style="grid-column: span 1; ${this.generatedCode ? '' : 'display:none;'}">👁️ Preview Code</button>
          </div>

          <!-- Options -->
          <div class="ap-options-box">
            <label class="ap-option-label">
              <input type="checkbox" class="ap-opt-auto-submit" ${this.options.autoSubmit ? 'checked' : ''}>
              Auto-Submit after injecting code
            </label>
            <label class="ap-option-label">
              <input type="checkbox" class="ap-opt-auto-retry" ${this.options.autoRetry ? 'checked' : ''}>
              Auto-Retry on failed test cases
            </label>
          </div>

          <!-- Provider Select -->
          <div class="ap-select-row">
            <span>AI Model:</span>
            <select class="ap-select ap-select-provider">
              <option value="gemini" ${this.options.provider === 'gemini' ? 'selected' : ''}>Google Gemini (3.8 Flash)</option>
              <option value="groq" ${this.options.provider === 'groq' ? 'selected' : ''}>Groq Llama 3.3 70B (Free)</option>
              <option value="openai" ${this.options.provider === 'openai' ? 'selected' : ''}>OpenAI / Custom</option>
            </select>
          </div>

          <!-- Real-Time Log Console -->
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

    const titleEl = this.host.querySelector('.ap-val-title');
    if (titleEl) {
      titleEl.textContent = this.problemInfo.title;
      titleEl.title = this.problemInfo.title;
    }
    const diffEl = this.host.querySelector('.ap-val-diff');
    if (diffEl) diffEl.textContent = `${this.problemInfo.difficulty} (${this.problemInfo.points})`;

    const testsEl = this.host.querySelector('.ap-val-tests');
    if (testsEl) {
      testsEl.textContent = this.problemInfo.testCasesCount > 0
        ? `${this.problemInfo.testCasesCount} detected`
        : 'Extracted from Requirements';
    }

    const fileEl = this.host.querySelector('.ap-val-file');
    if (fileEl) {
      fileEl.textContent = this.problemInfo.activeFile;
      fileEl.title = this.problemInfo.activeFile;
    }

    const autoSubmitCb = this.host.querySelector('.ap-opt-auto-submit');
    if (autoSubmitCb) autoSubmitCb.checked = !!this.options.autoSubmit;

    const autoRetryCb = this.host.querySelector('.ap-opt-auto-retry');
    if (autoRetryCb) autoRetryCb.checked = !!this.options.autoRetry;

    const providerSel = this.host.querySelector('.ap-select-provider');
    if (providerSel) providerSel.value = this.options.provider || 'gemini';
  }

  bindEvents() {
    const minBtn = this.host.querySelector('.ap-btn-min');
    if (minBtn) minBtn.onclick = () => this.toggleMinimize(true);

    // Settings icon in top left
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

    const solveBtn = this.host.querySelector('.ap-btn-solve-main');
    if (solveBtn) {
      solveBtn.onclick = () => {
        console.log('[AP-Solver] Solve button clicked!');
        if (this.callbacks.onOneClickSolve) this.callbacks.onOneClickSolve();
      };
    }

    const readBtn = this.host.querySelector('.ap-btn-read');
    if (readBtn) readBtn.onclick = () => this.callbacks.onReadContext && this.callbacks.onReadContext();

    const genBtn = this.host.querySelector('.ap-btn-gen');
    if (genBtn) genBtn.onclick = () => this.callbacks.onGenerate && this.callbacks.onGenerate();

    const writeBtn = this.host.querySelector('.ap-btn-write');
    if (writeBtn) writeBtn.onclick = () => this.callbacks.onWriteCode && this.callbacks.onWriteCode();

    const submitBtn = this.host.querySelector('.ap-btn-submit');
    if (submitBtn) submitBtn.onclick = () => this.callbacks.onSubmit && this.callbacks.onSubmit();

    const copyBtn = this.host.querySelector('.ap-btn-copy');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const codeToCopy = this.generatedCode || this.currentCode;
        if (!codeToCopy) {
          alert('No code to copy yet! Please generate solution first.');
          return;
        }
        navigator.clipboard.writeText(codeToCopy).then(() => {
          this.addLog('Code copied to clipboard!', 'ok');
          const orig = copyBtn.textContent;
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => (copyBtn.textContent = orig), 2000);
        });
      };
    }

    const viewBtn = this.host.querySelector('.ap-btn-view-code');
    if (viewBtn) {
      viewBtn.onclick = () => this.showCodeModal(this.generatedCode);
    }

    const autoSubmitCb = this.host.querySelector('.ap-opt-auto-submit');
    if (autoSubmitCb) {
      autoSubmitCb.onchange = (e) => {
        this.options.autoSubmit = e.target.checked;
        if (this.callbacks.onOptionsChange) this.callbacks.onOptionsChange(this.options);
      };
    }

    const autoRetryCb = this.host.querySelector('.ap-opt-auto-retry');
    if (autoRetryCb) {
      autoRetryCb.onchange = (e) => {
        this.options.autoRetry = e.target.checked;
        if (this.callbacks.onOptionsChange) this.callbacks.onOptionsChange(this.options);
      };
    }

    const providerSel = this.host.querySelector('.ap-select-provider');
    if (providerSel) {
      providerSel.onchange = (e) => {
        this.options.provider = e.target.value;
        if (this.callbacks.onOptionsChange) this.callbacks.onOptionsChange(this.options);
      };
    }
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
