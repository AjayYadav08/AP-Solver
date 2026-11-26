// popup/popup.js - Popup Controller with First-Time Onboarding
document.addEventListener('DOMContentLoaded', async () => {
  const onboardingView = document.getElementById('onboardingView');
  const mainView = document.getElementById('mainView');

  const onboardGeminiKey = document.getElementById('onboardGeminiKey');
  const onboardGroqKey = document.getElementById('onboardGroqKey');
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
  const hasConfiguredKey = !!(settings.geminiKey?.trim() || settings.groqKey?.trim() || settings.openaiKey?.trim());

  if (!hasConfiguredKey) {
    // Show onboarding screen on first open
    onboardingView.style.display = 'flex';
    mainView.style.display = 'none';
  } else {
    onboardingView.style.display = 'none';
    mainView.style.display = 'block';
  }

  // Handle Onboarding Save
  onboardSaveBtn.addEventListener('click', async () => {
    const geminiVal = onboardGeminiKey.value.trim();
    const groqVal = onboardGroqKey.value.trim();

    if (!geminiVal && !groqVal) {
      onboardError.style.display = 'block';
      onboardError.textContent = 'Please enter at least one API key (Gemini or Groq) to continue.';
      return;
    }

    onboardSaveBtn.disabled = true;
    onboardSaveBtn.textContent = 'Saving...';

    const updates = {
      provider: (geminiVal && groqVal) ? 'race' : (geminiVal ? 'gemini' : 'groq')
    };
    if (geminiVal) updates.geminiKey = geminiVal;
    if (groqVal) updates.groqKey = groqVal;

    await chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: updates });

    // Update local settings object
    Object.assign(settings, updates);

    // Switch to main view
    onboardingView.style.display = 'none';
    mainView.style.display = 'block';
    updateKeyBadge();
  });

  // Setup Main View
  providerSelect.value = settings.provider || 'race';
  autoSubmitCheck.checked = !!settings.autoSubmit;
  autoRetryCheck.checked = settings.autoRetry !== false;

  function updateKeyBadge() {
    const p = providerSelect.value;
    let hasKey = false;
    let label = '';

    if (p === 'race') {
      const hasGroq = !!settings.groqKey?.trim();
      const hasGemini = !!settings.geminiKey?.trim();
      if (hasGroq && hasGemini) {
        hasKey = true;
        label = '⚡ Turbo Race active (Groq + Gemini)';
      } else if (hasGroq || hasGemini) {
        hasKey = true;
        label = `✓ Active via ${hasGroq ? 'Groq' : 'Gemini'}`;
      } else {
        hasKey = false;
        label = '⚠ Add Groq or Gemini key';
      }
    } else if (p === 'gemini') {
      hasKey = !!settings.geminiKey?.trim();
      label = hasKey ? '✓ Gemini Key configured' : '⚠ Gemini Key missing';
    } else if (p === 'groq') {
      hasKey = !!settings.groqKey?.trim();
      label = hasKey ? '✓ Groq Key configured' : '⚠ Groq Key missing';
    } else if (p === 'openai') {
      hasKey = !!settings.openaiKey?.trim();
      label = hasKey ? '✓ OpenAI Key configured' : '⚠ OpenAI Key missing';
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
      const testPrompt = {
        questionTitle: 'Test API Connection',
        questionDetails: 'Write a simple hello world function in JavaScript.',
        testCases: ['Function returns "hello world"'],
        currentCode: '// starter code',
        language: 'javascript'
      };

      const testResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          op: 'AP_GENERATE',
          data: {
            promptData: testPrompt,
            settingsOverride: { provider: p }
          }
        }, (r) => resolve(r));
      });

      if (testResp && testResp.ok) {
        testResult.className = 'test-result-box ok';
        testResult.textContent = `✓ Success! Connected to ${testResp.result.model}. Response generated.`;
        testResult.style.display = 'block';
      } else {
        testResult.className = 'test-result-box bad';
        testResult.textContent = `✗ Failed: ${testResp?.error || 'Unknown error'}`;
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
