// Background Service Worker

// Cache for translations to save tokens/latency
// Key: English sentence, Value: Korean translation
const translationCache = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TEST_CONNECTION') {
        testConnection(request.key).then(success => {
            sendResponse({ success: success });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; // Async response
    }

    if (request.action === 'NEW_TRANSCRIPT') {
        handleTranslationRequest(request.data, sender.tab.id);
    }

    if (request.action === 'BATCH_TRANSLATE_REQUEST') {
        handleBatchTranslation(request.captions, sender.tab.id);
    }

    if (request.action === 'REQUEST_EXPORT') {
        // Relay to active tab so extractor.js can handle it
        chrome.tabs.sendMessage(sender.tab.id, request);
    }

    // Relay messages from Extractor to UI Injector (in the same tab)
    if (request.action === 'SHOW_SUBTITLE' || request.action === 'STATUS_UPDATE' || request.action === 'MANUAL_REFRESH') {
        if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, request);
        }
    }
});

// Detect URL changes (SPA navigation)
chrome.webNavigation.onHistoryStateUpdated.addListener(
    function(details) {
        if (details.frameId === 0) { // Top-level frame only
            console.log('Navigation detected:', details.url);
            chrome.tabs.sendMessage(details.tabId, {
                action: 'PAGE_UPDATED',
                url: details.url
            });
        }
    },
    {
        url: [
            { hostContains: 'deeplearning.ai' },
            { hostContains: 'coursera.org' }
        ]
    }
);

async function testConnection(apiKey) {
    // Use generateContent for testing to ensure we can actually use the model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{
            parts: [{ text: "Test" }]
        }]
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data.candidates) {
            return true;
        } else {
            throw new Error(data.error?.message || 'Invalid API Key or Model not available');
        }
    } catch (error) {
        console.error('Connection test failed:', error);
        throw error;
    }
}

async function handleBatchTranslation(captions, tabId) {
    console.log('Starting batch translation for', captions.length, 'lines.');

    const storage = await chrome.storage.local.get(['geminiApiKey', 'speedMode']);
    if (!storage.geminiApiKey) {
        chrome.tabs.sendMessage(tabId, { action: 'TRANSLATION_ERROR', error: 'No API Key' });
        return;
    }

    const isFastMode = storage.speedMode === 'fast';
    console.log(`Mode: ${isFastMode ? 'FAST (Parallel)' : 'STABLE (Sequential)'}`);

    try {
        // Configuration based on mode
        // Fast Mode: Chunk 50 (Safe), Concurrency 5 (Fast), Delay 200ms
        // Stable Mode: Chunk 50 (Safe), Concurrency 1 (Sequential), Delay 1000ms
        const CHUNK_SIZE = 50; // Reduced from 150 to prevent output truncation
        const CONCURRENCY = isFastMode ? 5 : 1; // Increased concurrency to compensate for smaller chunks
        const DELAY_MS = isFastMode ? 200 : 1000;

        let translatedCaptions = [];
        let chunks = [];

        // Create chunks
        for (let i = 0; i < captions.length; i += CHUNK_SIZE) {
            chunks.push({
                index: i,
                data: captions.slice(i, i + CHUNK_SIZE)
            });
        }

        let completedChunks = 0;

        // Helper to process a single chunk
        const processChunk = async (chunk) => {
            const textChunk = chunk.data.map(c => c.text).join('\n');
            const prompt = `
당신은 영어 자막을 한글 자막으로 변환하는 최고의 번역가 입니다.
자막을 번역할 때는 앞뒤 맥락을 고려하여 가장 자연스러운 표현을 사용합니다.
또한 전문 용어나 약자는 영어로 표기해.
입력된 텍스트의 줄바꿈(Line structure)을 그대로 유지하고 영어 자막 내용만 한국어로 변환해야해.
내용을 요약하거나 정리하려고 하지마.
마크다운 포맷(\`\`\`)이나 부가적인 설명, 입력 텍스트는 포함하지 말고 오직 번역된 텍스트만 출력해.

Input:
"""
${textChunk}
"""
Output (Korean translation, line by line):
`;

            try {
                const result = await callGeminiSimple(storage.geminiApiKey, prompt);

                // Cleanup
                let cleanResult = result.replace(/```korean/g, '').replace(/```/g, '').replace(/"""/g, '');
                const resultLines = cleanResult.split('\n').filter(l => l.trim() !== '');

                // Map back
                const mapped = chunk.data.map((c, idx) => {
                    let translatedText = resultLines[idx] ? resultLines[idx].trim() : c.text;
                    if (translatedText.startsWith('Input:') || translatedText.startsWith('Output:')) {
                        translatedText = c.text;
                    }
                    return {
                        startInSeconds: c.startInSeconds,
                        endInSeconds: c.endInSeconds,
                        text: translatedText
                    };
                });

                return { index: chunk.index, data: mapped };

            } catch (error) {
                console.error('Chunk failed:', error);
                // Fallback to original
                return { index: chunk.index, data: chunk.data };
            }
        };

        // Process chunks with concurrency control
        const results = [];
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);

            // Notify progress
            const progressPercent = Math.round((completedChunks / chunks.length) * 100);
            chrome.tabs.sendMessage(tabId, {
                action: 'STATUS_UPDATE',
                status: `Translating... ${progressPercent}% (${isFastMode ? 'Fast' : 'Stable'})`
            });

            const batchResults = await Promise.all(batch.map(chunk => processChunk(chunk)));
            results.push(...batchResults);

            completedChunks += batch.length;

            // Delay between batches
            if (i + CONCURRENCY < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        // Sort results by index to ensure order (Promise.all maintains order of batch, but we pushed batches)
        // Actually results array order depends on push order which is sequential by batch.
        // But inside batch, Promise.all returns in order. So flat map should be fine.
        // Let's just sort to be safe if we change logic later.
        results.sort((a, b) => a.index - b.index);

        // Flatten
        translatedCaptions = results.flatMap(r => r.data);

        // Send complete data back
        chrome.tabs.sendMessage(tabId, {
            action: 'FULL_TRANSLATION_COMPLETE',
            data: translatedCaptions
        });

        chrome.tabs.sendMessage(tabId, { action: 'STATUS_UPDATE', status: 'READY' });

    } catch (error) {
        console.error('Batch translation failed:', error);
        chrome.tabs.sendMessage(tabId, { action: 'TRANSLATION_ERROR', error: 'Batch Failed: ' + error.message });
    }
}

async function callGeminiSimple(apiKey, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API Error');
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function handleTranslationRequest(data, tabId) {
    const { current, prev, next } = data;

    if (!current) return;

    // Check cache first
    if (translationCache.has(current)) {
        console.log('Serving from cache:', current);
        sendTranslationToTab(tabId, translationCache.get(current));
        return;
    }

    // Get API Key
    const storage = await chrome.storage.local.get(['geminiApiKey', 'translationEnabled']);
    if (!storage.translationEnabled || !storage.geminiApiKey) {
        console.log('Translation disabled or no key.');
        return;
    }

    try {
        const translation = await callGeminiAPI(storage.geminiApiKey, current, prev, next);

        // Cache the result
        translationCache.set(current, translation);

        // Send back to tab
        sendTranslationToTab(tabId, translation);
    } catch (error) {
        console.error('Translation failed:', error);
        chrome.tabs.sendMessage(tabId, {
            action: 'TRANSLATION_ERROR',
            error: error.message || 'Unknown Error'
        });
    }
}

async function callGeminiAPI(apiKey, target, prev, next) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const prompt = `
Context:
"""
${prev}
"""

Target Sentence:
"""
${target}
"""

Future Context:
"""
${next}
"""

Instruction:
Translate the "Target Sentence" into natural, technical Korean suitable for AI developers.
- Use the context to disambiguate terms (e.g., "bias", "weight", "class").
- Output ONLY the Korean translation. Do not include quotes or explanations.
`;

    const payload = {
        contents: [{
            parts: [{ text: prompt }]
        }]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error?.message || 'API Error');
    }

    const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return translatedText ? translatedText.trim() : 'Translation Error';
}

function sendTranslationToTab(tabId, text) {
    chrome.tabs.sendMessage(tabId, {
        action: 'SHOW_SUBTITLE',
        text: text
    });
}
