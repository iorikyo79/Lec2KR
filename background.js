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
    if (request.action === 'SHOW_SUBTITLE' || request.action === 'STATUS_UPDATE' || request.action === 'IMPORT_TRANSLATION') {
        if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, request);
        }
    }
});

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

async function generateContentId(captions) {
    const text = captions.map(c => c.text).join(''); // Create signature from full text
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function handleBatchTranslation(captions, tabId) {
    console.log('Starting batch translation for', captions.length, 'lines.');

    const storage = await chrome.storage.local.get(['geminiApiKey', 'speedMode']);
    if (!storage.geminiApiKey) {
        chrome.tabs.sendMessage(tabId, { action: 'TRANSLATION_ERROR', error: 'No API Key' });
        return;
    }

    try {
        // 1. Generate Content ID
        const contentId = await generateContentId(captions);
        console.log('Content ID:', contentId);

        // 2. Check Cache
        const cacheKey = `lecture_${contentId}`;
        const cachedData = await chrome.storage.local.get(cacheKey);

        if (cachedData[cacheKey]) {
            console.log('Cache Hit! Serving from storage.');
            chrome.tabs.sendMessage(tabId, {
                action: 'STATUS_UPDATE',
                status: 'Loaded from Cache (Saved API Tokens!)'
            });

            // Brief delay to let user see the message
            await new Promise(resolve => setTimeout(resolve, 800));

            chrome.tabs.sendMessage(tabId, {
                action: 'FULL_TRANSLATION_COMPLETE',
                data: cachedData[cacheKey].captions
            });

            chrome.tabs.sendMessage(tabId, { action: 'STATUS_UPDATE', status: 'READY (Cached)' });
            return;
        }

        // 3. Not Cached -> Proceed with Translation
        const isFastMode = storage.speedMode === 'fast';
        console.log(`Mode: ${isFastMode ? 'FAST (Parallel)' : 'STABLE (Sequential)'}`);

        // Configuration based on mode
        const CHUNK_SIZE = 50;
        const CONCURRENCY = isFastMode ? 5 : 1;
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

        // ... (Define processChunk inside or outside, assuming it uses closure for now if not moved)
        // Note: processChunk relies on callGeminiSimple which is outside.
        // Re-defining processChunk here to capture scope if needed, or if it was inline.
        const formatTime = (seconds) => {
            const date = new Date(seconds * 1000);
            const hh = String(date.getUTCHours()).padStart(2, '0');
            const mm = String(date.getUTCMinutes()).padStart(2, '0');
            const ss = String(date.getUTCSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        };

        const processChunk = async (chunk) => {
            // 1. Prepare Input JSON
            const inputJson = chunk.data.map((c) => ({
                id: formatTime(c.startInSeconds),
                text: c.text
            }));

            const prompt = `
당신은 전문 자막 번역가입니다. 제공된 영어 자막(JSON)을 한국어 자막(JSON)으로 번역하세요.
다음 4가지 [동기화 절대 원칙]을 반드시 준수해야 합니다.

[동기화 절대 원칙]
1. **타임스탬프 개수 일치 (1:1 Mapping)**:
   - 입력된 원문 리스트의 개수와 출력된 번역 리스트의 개수는 **정확히 일치**해야 합니다. (입력 크기 == 출력 크기)
   - 절대 리스트 항목을 추가하거나 삭제하지 마세요.

2. **문맥 기반 번역 (Context-Aware Translation)**:
   - 각 타임스탬프의 텍스트를 독립적으로 보지 말고, 앞뒤 문맥을 연결하여 자연스러운 문장으로 번역하세요.
   - 문장이 끊겨 있더라도 전체 의미를 파악한 뒤 한국어 어순에 맞게 적절히 배치하세요.

3. **문장 구조 동기화 (Structure Sync)**:
   - 원문의 문장 개수와 번역문의 문장 개수는 동일해야 합니다.
   - 영어 문장이 3개의 타임스탬프에 걸쳐 있다면, 한국어 문장도 반드시 동일한 3개의 타임스탬프에 걸쳐 있어야 합니다.

4. **비율 유지 분할 (Proportional Split)**:
   - 원문에서 하나의 문장이 두 타임스탬프에 [AAA... / BBB...] 형태로 나뉘어 있다면, 
   - 번역문도 [가가가... / 나나나...] 형태로 동일한 비율로 나누어야 합니다.
   - **절대** 한쪽 타임스탬프에 내용을 몰아넣지 마세요. 시각적/시간적 길이를 원문과 비슷하게 유지하세요.

Input Format:
[
  {"id": "00:00:02", "text": "Welcome to this course..."},
  ...
]

Output Format (JSON Only):
[
  {"id": "00:00:02", "text": "이 과정에 오신 것을 환영합니다..."},
  ...
]

Input:
\`\`\`json
${JSON.stringify(inputJson, null, 2)}
\`\`\`
`;

            try {
                const result = await callGeminiSimple(storage.geminiApiKey, prompt);
                console.log(`Chunk ${chunk.index} Result:\n`, result);

                // 2. Parse JSON Response
                let jsonStr = result;
                // Try to find JSON block
                const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/) || result.match(/```\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[1];
                }

                // Heuristic cleanup: find first '[' and last ']'
                const start = jsonStr.indexOf('[');
                const end = jsonStr.lastIndexOf(']');
                if (start !== -1 && end !== -1) {
                    jsonStr = jsonStr.substring(start, end + 1);
                }

                let parsed = [];
                try {
                    parsed = JSON.parse(jsonStr);
                } catch (e) {
                    console.error('JSON Parse Error:', e);
                    // Fallback to original text is handled by the map below (undefined checks)
                }

                // 3. Map back to internal structure
                const mapped = chunk.data.map((c, idx) => {
                    let translatedText = c.text; // Default to original

                    // Use index-based mapping as per "1:1 mapping" rule
                    if (parsed && Array.isArray(parsed) && parsed[idx] && parsed[idx].text) {
                        translatedText = parsed[idx].text;
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
                return { index: chunk.index, data: chunk.data };
            }
        };

        const results = [];
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);

            const progressPercent = Math.round((completedChunks / chunks.length) * 100);
            chrome.tabs.sendMessage(tabId, {
                action: 'STATUS_UPDATE',
                status: `Translating... ${progressPercent}% (${isFastMode ? 'Fast' : 'Stable'})`
            });

            const batchResults = await Promise.all(batch.map(chunk => processChunk(chunk)));
            results.push(...batchResults);

            completedChunks += batch.length;

            if (i + CONCURRENCY < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        results.sort((a, b) => a.index - b.index);
        translatedCaptions = results.flatMap(r => r.data);

        // 4. Save to Cache & Download
        const saveObj = {
            [cacheKey]: {
                captions: translatedCaptions,
                timestamp: Date.now()
            }
        };
        await chrome.storage.local.set(saveObj);
        console.log('Saved to cache:', cacheKey);

        // Trigger Download
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(translatedCaptions, null, 2));
        const filename = `lecture_${contentId}_kr.json`;

        // Use downloads API to save to local folder
        chrome.downloads.download({
            url: dataStr,
            filename: filename,
            saveAs: false // Auto-save without prompt
        }, (downloadId) => {
            console.log('Download triggered:', downloadId);
        });

        // Send complete data back
        chrome.tabs.sendMessage(tabId, {
            action: 'FULL_TRANSLATION_COMPLETE',
            data: translatedCaptions
        });

        chrome.tabs.sendMessage(tabId, { action: 'STATUS_UPDATE', status: 'READY (Saved)' });

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
