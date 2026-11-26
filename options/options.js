// options/options.js - Settings Page Logic
document.addEventListener('DOMContentLoaded', async () => {
  const providerRadios = document.querySelectorAll('input[name="provider"]');
  const geminiBox = document.getElementById('geminiBox');
  const groqBox = document.getElementById('groqBox');
  const cerebrasBox = document.getElementById('cerebrasBox');
  const openaiBox = document.getElementById('openaiBox');

  const geminiKeyInput = document.getElementById('geminiKey');
  const geminiModelSelect = document.getElementById('geminiModel');

  const groqKeyInput = document.getElementById('groqKey');
  const groqModelSelect = document.getElementById('groqModel');

  const cerebrasKeyInput = document.getElementById('cerebrasKey');
  const cerebrasModelSelect = document.getElementById('cerebrasModel');

  const openaiPresetSelect = document.getElementById('openaiPreset');
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
  const storedProvider = settings.provider || 'auto';
  const currentProvider = storedProvider === 'race' ? 'auto' : storedProvider;
  const radio = document.querySelector(`input[name="provider"][value="${currentProvider}"]`);
  if (radio) radio.checked = true;

  geminiKeyInput.value = settings.geminiKey || '';
  const rawGeminiModel = (settings.geminiModel || '').trim();
  const isStaleGemini = !rawGeminiModel || /1\.5|3\.5|3\.8/.test(rawGeminiModel);
  const loadedGeminiModel = isStaleGemini ? 'gemini-2.5-flash' : rawGeminiModel;
  geminiModelSelect.value = [...geminiModelSelect.options].some(o => o.value === loadedGeminiModel) ? loadedGeminiModel : 'gemini-2.5-flash';

  groqKeyInput.value = settings.groqKey || '';
  const rawGroqModel = (settings.groqModel || '').trim();
  const loadedGroqModel = (!rawGroqModel || /llama|mixtral|3\.8-27b/i.test(rawGroqModel)) ? 'openai/gpt-oss-120b' : rawGroqModel;
  groqModelSelect.value = [...groqModelSelect.options].some(o => o.value === loadedGroqModel) ? loadedGroqModel : 'openai/gpt-oss-120b';

  if (cerebrasKeyInput && cerebrasModelSelect) {
    cerebrasKeyInput.value = settings.cerebrasKey || '';
    const rawCerebrasModel = (settings.cerebrasModel || 'gpt-oss-120b').trim();
    cerebrasModelSelect.value = [...cerebrasModelSelect.options].some(o => o.value === rawCerebrasModel) ? rawCerebrasModel : 'gpt-oss-120b';
  }

  openaiKeyInput.value = settings.openaiKey || '';
  openaiBaseUrlInput.value = settings.openaiBaseUrl || 'https://api.openai.com/v1';
  openaiModelInput.value = settings.openaiModel || 'gpt-4o';

  if (openaiPresetSelect) {
    openaiPresetSelect.addEventListener('change', () => {
      const p = openaiPresetSelect.value;
      if (p === 'nvidia_nim') {
        openaiBaseUrlInput.value = 'https://integrate.api.nvidia.com/v1';
        openaiModelInput.value = 'deepseek-ai/deepseek-v3.2';
      } else if (p === 'openrouter_free') {
        openaiBaseUrlInput.value = 'https://openrouter.ai/api/v1';
        openaiModelInput.value = 'openrouter/free';
      } else if (p === 'openai') {
        openaiBaseUrlInput.value = 'https://api.openai.com/v1';
        openaiModelInput.value = 'gpt-4o';
      }
    });
  }

  autoSubmitCheck.checked = !!settings.autoSubmit;
  autoRetryCheck.checked = settings.autoRetry !== false;

  function updateProviderBoxes() {
    const val = document.querySelector('input[name="provider"]:checked')?.value || 'auto';
    const showAll = val === 'auto' || val === 'race';
    geminiBox.style.display = (val === 'gemini' || showAll) ? 'block' : 'none';
    groqBox.style.display = (val === 'groq' || showAll) ? 'block' : 'none';
    if (cerebrasBox) cerebrasBox.style.display = (val === 'cerebras' || showAll) ? 'block' : 'none';
    openaiBox.style.display = (val === 'openai' || showAll) ? 'block' : 'none';
  }

  updateProviderBoxes();

  providerRadios.forEach((r) => r.addEventListener('change', updateProviderBoxes));

  function showToast(msg) {
    saveToast.textContent = msg;
    saveToast.classList.add('show');
    setTimeout(() => saveToast.classList.remove('show'), 2800);
  }

  // Save handler
  saveBtn.addEventListener('click', async () => {
    const selectedProvider = document.querySelector('input[name="provider"]:checked')?.value || 'auto';
    const gKey = geminiKeyInput.value.trim();
    const grKey = groqKeyInput.value.trim();
    const cKey = cerebrasKeyInput ? cerebrasKeyInput.value.trim() : '';
    const oKey = openaiKeyInput.value.trim();

    for (const [name, val] of [['Gemini', gKey], ['Groq', grKey], ['Cerebras', cKey], ['Custom/OpenAI', oKey]]) {
      if (val && (/\s/.test(val) || val.length < 14)) {
        showToast(`✗ ${name} API key looks invalid (spaces or too short)`);
        return;
      }
    }

    const updates = {
      provider: selectedProvider,
      geminiKey: gKey,
      geminiModel: geminiModelSelect.value,
      groqKey: grKey,
      groqModel: groqModelSelect.value,
      cerebrasKey: cKey,
      cerebrasModel: cerebrasModelSelect ? cerebrasModelSelect.value : 'gpt-oss-120b',
      openaiKey: oKey,
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
