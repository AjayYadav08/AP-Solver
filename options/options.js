// options/options.js - Settings Page Logic
document.addEventListener('DOMContentLoaded', async () => {
  const providerRadios = document.querySelectorAll('input[name="provider"]');
  const geminiBox = document.getElementById('geminiBox');
  const groqBox = document.getElementById('groqBox');
  const openaiBox = document.getElementById('openaiBox');

  const geminiKeyInput = document.getElementById('geminiKey');
  const geminiModelSelect = document.getElementById('geminiModel');

  const groqKeyInput = document.getElementById('groqKey');
  const groqModelSelect = document.getElementById('groqModel');

  const openaiKeyInput = document.getElementById('openaiKey');
  const openaiBaseUrlInput = document.getElementById('openaiBaseUrl');
  const openaiModelInput = document.getElementById('openaiModel');

  const autoSubmitCheck = document.getElementById('autoSubmit');
  const autoRetryCheck = document.getElementById('autoRetry');

  const saveBtn = document.getElementById('saveBtn');
  const saveToast = document.getElementById('saveToast');

  // Load stored settings
  const resp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ op: 'AP_GET_SETTINGS' }, (r) => resolve(r));
  });

  const settings = resp?.settings || {};

  // Populate UI
  const currentProvider = settings.provider || 'race';
  const radio = document.querySelector(`input[name="provider"][value="${currentProvider}"]`);
  if (radio) radio.checked = true;

  geminiKeyInput.value = settings.geminiKey || '';
  geminiModelSelect.value = (settings.geminiModel && settings.geminiModel !== 'gemini-2.5-flash') ? settings.geminiModel : 'gemini-3.8-flash';

  groqKeyInput.value = settings.groqKey || '';
  groqModelSelect.value = (!settings.groqModel || settings.groqModel.includes('llama') || settings.groqModel.includes('mixtral')) ? 'openai/gpt-oss-120b' : settings.groqModel;

  openaiKeyInput.value = settings.openaiKey || '';
  openaiBaseUrlInput.value = settings.openaiBaseUrl || 'https://api.openai.com/v1';
  openaiModelInput.value = settings.openaiModel || 'gpt-4o';

  autoSubmitCheck.checked = !!settings.autoSubmit;
  autoRetryCheck.checked = settings.autoRetry !== false;

  function updateProviderBoxes() {
    const val = document.querySelector('input[name="provider"]:checked')?.value || 'race';
    geminiBox.style.display = (val === 'gemini' || val === 'race') ? 'block' : 'none';
    groqBox.style.display = (val === 'groq' || val === 'race') ? 'block' : 'none';
    openaiBox.style.display = val === 'openai' ? 'block' : 'none';
  }

  updateProviderBoxes();

  providerRadios.forEach((r) => r.addEventListener('change', updateProviderBoxes));

  function showToast(msg) {
    saveToast.textContent = msg;
    saveToast.classList.add('show');
    setTimeout(() => saveToast.classList.remove('show'), 2500);
  }

  // Save handler
  saveBtn.addEventListener('click', async () => {
    const selectedProvider = document.querySelector('input[name="provider"]:checked')?.value || 'gemini';

    const updates = {
      provider: selectedProvider,
      geminiKey: geminiKeyInput.value.trim(),
      geminiModel: geminiModelSelect.value,
      groqKey: groqKeyInput.value.trim(),
      groqModel: groqModelSelect.value,
      openaiKey: openaiKeyInput.value.trim(),
      openaiBaseUrl: openaiBaseUrlInput.value.trim(),
      openaiModel: openaiModelInput.value.trim(),
      autoSubmit: autoSubmitCheck.checked,
      autoRetry: autoRetryCheck.checked
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const saveResp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ op: 'AP_SAVE_SETTINGS', data: updates }, (r) => resolve(r));
    });

    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Settings';

    if (saveResp && saveResp.ok) {
      showToast('✓ Settings saved successfully!');
    } else {
      showToast('✗ Error saving settings');
    }
  });
});
