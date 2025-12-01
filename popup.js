document.addEventListener('DOMContentLoaded', async () => {
    const apiKeyInput = document.getElementById('apiKey');
    const speedModeSelect = document.getElementById('speedMode');
    const saveBtn = document.getElementById('saveBtn');
    const testBtn = document.getElementById('testBtn');
    const toggleTranslation = document.getElementById('toggleTranslation');
    const statusDiv = document.getElementById('status'); // Changed from messageEl
    const statusIndicator = document.getElementById('statusIndicator'); // Kept from original

    // Load saved settings
    const data = await chrome.storage.local.get(['geminiApiKey', 'translationEnabled', 'speedMode']);
    if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
    if (data.translationEnabled !== undefined) toggleTranslation.checked = data.translationEnabled;
    if (data.speedMode) speedModeSelect.value = data.speedMode;

    // Save Settings
    saveBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const speedMode = speedModeSelect.value;

        if (!apiKey) {
            showStatus('Please enter an API Key', 'error');
            return;
        }

        await chrome.storage.local.set({
            geminiApiKey: apiKey,
            speedMode: speedMode
        });

        showStatus('Settings saved!', 'success');

        // Notify active tab to reload settings if needed? 
        // Actually background.js reads from storage on every request, so it's fine.
    });

    // Toggle Translation
    toggleTranslation.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ translationEnabled: enabled }, () => {
            // Notify active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'TOGGLE_TRANSLATION',
                        enabled: enabled
                    });
                }
            });
        });
    });

    // Test Connection (Mock for now, or real if we want to implement it immediately)
    testBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showMessage('No API Key to test.', 'error');
            return;
        }

        showMessage('Testing connection...', '');

        // Simple mock test or a real minimal call to Gemini
        // For Phase 1, we can just check if the key format looks roughly valid or try a dummy call
        // Let's do a dummy fetch to the models endpoint if possible, or just simulate success for now
        // as we haven't implemented the full background proxy yet.

        // Ideally, we send a message to background to test it.
        chrome.runtime.sendMessage({ action: 'TEST_CONNECTION', key: key }, (response) => {
            if (chrome.runtime.lastError) {
                showMessage('Background service not ready.', 'error');
                return;
            }
            if (response && response.success) {
                showMessage('Connection Successful!', 'success');
            } else {
                showMessage('Connection Failed: ' + (response?.error || 'Unknown'), 'error');
            }
        });
    });

    function showMessage(text, type) {
        messageEl.textContent = text;
        messageEl.className = 'message ' + type;
        setTimeout(() => {
            if (type === 'success') messageEl.textContent = '';
        }, 3000);
    }
});
