// popup/popup.js - Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
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

  providerSelect.value = settings.provider || 'gemini';
  autoSubmitCheck.checked = !!settings.autoSubmit;
  autoRetryCheck.checked = settings.autoRetry !== false;

  function updateKeyBadge() {
    const p = providerSelect.value;
    let hasKey = false;
    let label = '';

    if (p === 'gemini') {
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
