// popup/popup.js - Popup Controller with First-Time Onboarding
document.addEventListener('DOMContentLoaded', async () => {
  const onboardingView = document.getElementById('onboardingView');
  const mainView = document.getElementById('mainView');

  const onboardGeminiKey = document.getElementById('onboardGeminiKey');
  const onboardGroqKey = document.getElementById('onboardGroqKey');
  const onboardCerebrasKey = document.getElementById('onboardCerebrasKey');
  const onboardSaveBtn = document.getElementById('onboardSaveBtn');
  const onboardError = document.getElementById('onboardError');

  const providerSelect = document.getElementById('providerSelect');
  const keyStatus = document.getElementById('keyStatus');
  const autoSubmitCheck = document.getElementById('autoSubmitCheck');
  const autoRetryCheck = document.getElementById('autoRetryCheck');
  const testApiBtn = document.getElementById('testApiBtn');
  const testResult = document.getElementById('testResult');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const docsLink = document.getElementById('docsLink');

  // Load current settings
  const resp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ op: 'AP_GET_SETTINGS' }, (r) => resolve(r));
  });

  const settings = resp?.settings || {};

  // Check if any key is already configured
  const hasConfiguredKey = !!(
    settings.geminiKey?.trim() ||
    settings.groqKey?.trim() ||
    settings.cerebrasKey?.trim() ||
    settings.openaiKey?.trim()
  );

  if (!hasConfiguredKey) {
    // Show onboarding screen on first open
    onboardingView.style.display = 'flex';
    mainView.style.display = 'none';
  } else {
    onboardingView.style.display = 'none';
    mainView.style.display = 'block';
  }

  function checkBasicKeyFormat(label, val) {
    if (!val) return '';
    if (/\s/.test(val) || val.length < 14) {
      return `${label} API key looks invalid (too short or contains spaces).`;
    }
    return '';
  }

  // Handle Onboarding Save
  onboardSaveBtn.addEventListener('click', async () => {
    const geminiVal = onboardGeminiKey.value.trim();
    const groqVal = onboardGroqKey.value.trim();
    const cerebrasVal = onboardCerebrasKey ? onboardCerebrasKey.value.trim() : '';

    if (!geminiVal && !groqVal && !cerebrasVal) {
      onboardError.style.display = 'block';
      onboardError.textContent = 'Please enter at least one API key (Gemini, Groq, or Cerebras) to continue.';
      return;
    }

    const fmtErr = checkBasicKeyFormat('Gemini', geminiVal) ||
      checkBasicKeyFormat('Groq', groqVal) ||
      checkBasicKeyFormat('Cerebras', cerebrasVal);
    if (fmtErr) {
      onboardError.style.display = 'block';
      onboardError.textContent = fmtErr;
      return;
    }

    onboardError.style.display = 'none';
    onboardSaveBtn.disabled = true;
    onboardSaveBtn.textContent = 'Saving...';

    const updates = {
      provider: 'auto'
    };
    if (geminiVal) updates.geminiKey = geminiVal;
    if (groqVal) updates.groqKey = groqVal;
    if (cerebrasVal) updates.cerebrasKey = cerebrasVal;

    await chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: updates });

    // Update local settings object
    Object.assign(settings, updates);
    providerSelect.value = 'auto';

    // Switch to main view
    onboardingView.style.display = 'none';
    mainView.style.display = 'block';
    updateKeyBadge();
  });

  // Setup Main View
  const rawMode = settings.provider || 'auto';
  providerSelect.value = rawMode === 'race' ? 'auto' : rawMode;
  autoSubmitCheck.checked = !!settings.autoSubmit;
  autoRetryCheck.checked = settings.autoRetry !== false;

  function updateKeyBadge() {
    const p = providerSelect.value;
    let hasKey = false;
    let label = '';

    const activeNames = [];
    if (settings.geminiKey?.trim()) activeNames.push('Gemini');
    if (settings.groqKey?.trim()) activeNames.push('Groq');
    if (settings.cerebrasKey?.trim()) activeNames.push('Cerebras');
    if (settings.openaiKey?.trim()) activeNames.push('Custom');

    if (p === 'auto' || p === 'race') {
      if (activeNames.length >= 2) {
        hasKey = true;
        label = `🧠 Dynamic Orchestrator active (${activeNames.join(' + ')})`;
      } else if (activeNames.length === 1) {
        hasKey = true;
        label = `✓ Active via ${activeNames[0]} (+ add more keys for fallback)`;
      } else {
        hasKey = false;
        label = '⚠ Add Gemini, Groq, or Cerebras key';
      }
    } else if (p === 'gemini') {
      hasKey = !!settings.geminiKey?.trim();
      label = hasKey ? '✓ Gemini Key configured' : '⚠ Gemini Key missing';
    } else if (p === 'groq') {
      hasKey = !!settings.groqKey?.trim();
      label = hasKey ? '✓ Groq Key configured' : '⚠ Groq Key missing';
    } else if (p === 'cerebras') {
      hasKey = !!settings.cerebrasKey?.trim();
      label = hasKey ? '✓ Cerebras Key configured' : '⚠ Cerebras Key missing';
    } else if (p === 'openai') {
      hasKey = !!settings.openaiKey?.trim();
      label = hasKey ? '✓ OpenAI / NIM / OpenRouter Key configured' : '⚠ Custom API Key missing';
    }

    keyStatus.textContent = label;
    keyStatus.className = `key-status-badge ${hasKey ? 'ok' : 'missing'}`;
  }

  updateKeyBadge();

  // Handle provider switch
  providerSelect.addEventListener('change', async (e) => {
    const newProvider = e.target.value;
    settings.provider = newProvider;
    await chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: { provider: newProvider } });
    updateKeyBadge();
  });

  // Handle toggles
  autoSubmitCheck.addEventListener('change', async (e) => {
    settings.autoSubmit = e.target.checked;
    await chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: { autoSubmit: e.target.checked } });
  });

  autoRetryCheck.addEventListener('change', async (e) => {
    settings.autoRetry = e.target.checked;
    await chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: { autoRetry: e.target.checked } });
  });

  // Open Options page
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  docsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Test API connection
  testApiBtn.addEventListener('click', async () => {
    testApiBtn.disabled = true;
    testApiBtn.textContent = 'Testing connection...';
    testResult.style.display = 'none';

    try {
      const p = providerSelect.value;
      const testResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          op: 'AP_TEST_CONNECTIONS',
          data: { settingsOverride: { provider: p } }
        }, (r) => resolve(r));
      });

      if (testResp && Array.isArray(testResp.results) && testResp.results.length > 0) {
        const lines = testResp.results.map(r =>
          r.ok
            ? `✓ ${r.provider} (${r.model}, ${r.latencyMs}ms)`
            : `✗ ${r.provider}: ${r.error}`
        );
        testResult.className = `test-result-box ${testResp.ok ? 'ok' : 'bad'}`;
        testResult.textContent = lines.join(' | ');
        testResult.style.display = 'block';
      } else {
        testResult.className = 'test-result-box bad';
        testResult.textContent = `✗ Failed: ${testResp?.error || 'No configured provider responded'}`;
        testResult.style.display = 'block';
      }
    } catch (err) {
      testResult.className = 'test-result-box bad';
      testResult.textContent = `✗ Error: ${err.message}`;
      testResult.style.display = 'block';
    } finally {
      testApiBtn.disabled = false;
      testApiBtn.textContent = '⚡ Test API Connection';
    }
  });
});
