/**
 * DeepL.AI Translator - Extractor
 * Handles DOM observation for transcript changes.
 * Supports:
 * 1. DOM MutationObserver (Coursera/Generic)
 * 2. Next.js Data Extraction (DeepLearning.ai)
 */

class TranscriptExtractor {
    constructor() {
        this.currentSentence = '';
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY = 300;

        // Strategy: 'DOM' or 'DATA'
        this.strategy = 'DOM';
        this.captionsData = null; // For DATA strategy
        this.videoElement = null; // For DATA strategy

        this.SELECTORS = {
            TRANSCRIPT_CONTAINER: '.rc-Transcript',
            ACTIVE_PHRASE: '.rc-Phrase.active',
            NEXT_DATA_SCRIPT: '#__NEXT_DATA__',
        };

        this.init();
    }

    init() {
        console.log('DeepL.AI Extractor: Initializing...');

        // Check for Next.js Data (DeepLearning.ai)
        const nextDataScript = document.querySelector(this.SELECTORS.NEXT_DATA_SCRIPT);
        if (nextDataScript) {
            console.log('DeepL.AI Extractor: Detected Next.js application.');
            if (this.tryLoadNextData(nextDataScript)) {
                this.strategy = 'DATA';
                this.initDataStrategy();
                return;
            }
        }

        // Fallback to DOM Strategy
        console.log('DeepL.AI Extractor: Using DOM Strategy.');
        this.startObserving();
    }

    // ==========================================
    // Strategy: Next.js Data (DeepLearning.ai)
    // ==========================================

    tryLoadNextData(scriptElement) {
        try {
            const jsonData = JSON.parse(scriptElement.textContent);
            // Traverse JSON to find captions
            // Path: props.pageProps.trpcState.json.queries[...].state.data.captions
            const queries = jsonData?.props?.pageProps?.trpcState?.json?.queries || [];

            for (const query of queries) {
                if (query?.state?.data?.captions && Array.isArray(query.state.data.captions)) {
                    this.captionsData = query.state.data.captions;
                    console.log(`DeepL.AI Extractor: Found ${this.captionsData.length} captions.`);
                    return true;
                }
                // Sometimes it might be nested differently, but the user provided HTML matches this path.
                // Also check for 'video' object which contains 'captions'
                if (query?.state?.data?.video?.captions) {
                    // It might be inside video object as well? 
                    // User HTML showed: queries[...].state.data.captions (direct array)
                    // But let's be safe.
                }
            }
        } catch (e) {
            console.error('DeepL.AI Extractor: Failed to parse Next.js data', e);
        }
        return false;
    }

    initDataStrategy() {
        // Find the video element
        this.videoElement = document.querySelector('video');

        if (this.videoElement) {
            console.log('DeepL.AI Extractor: Video element found.');
            this.videoElement.addEventListener('timeupdate', () => this.handleTimeUpdate());

            // Trigger Full Translation Immediately
            if (this.captionsData && this.captionsData.length > 0) {
                console.log('Triggering full translation...');
                chrome.runtime.sendMessage({
                    action: 'BATCH_TRANSLATE_REQUEST',
                    captions: this.captionsData
                });
            }
        } else {
            console.log('DeepL.AI Extractor: Video element NOT found. Retrying...');
            setTimeout(() => this.initDataStrategy(), 1000);
        }
    }

    handleTimeUpdate() {
        if (!this.videoElement) return;

        const currentTime = this.videoElement.currentTime;

        // Use translated data if available, otherwise fallback to raw data
        const sourceData = this.translatedCaptionsData || this.captionsData;
        if (!sourceData) return;

        // Find the caption that matches current time
        const index = sourceData.findIndex(cap =>
            currentTime >= cap.startInSeconds && currentTime < cap.endInSeconds
        );

        if (index !== -1) {
            const currentCaption = sourceData[index];

            if (currentCaption.text !== this.currentSentence) {
                this.currentSentence = currentCaption.text;

                // If we have translated data, we just show it directly
                if (this.translatedCaptionsData) {
                    chrome.runtime.sendMessage({
                        action: 'SHOW_SUBTITLE',
                        text: this.currentSentence
                    });
                } else {
                    // Fallback to old behavior (request translation) if translation not yet ready
                    // But since we are auto-starting translation, maybe we just show English or "Translating..."?
                    // Let's show English for now until translation arrives.
                    chrome.runtime.sendMessage({
                        action: 'SHOW_SUBTITLE',
                        text: this.currentSentence + ' (Translating...)'
                    });
                }
            }
        }
    }

    // ==========================================
    // Strategy: DOM Observer (Coursera/Legacy)
    // ==========================================

    startObserving() {
        const transcriptContainer = document.querySelector(this.SELECTORS.TRANSCRIPT_CONTAINER);

        if (transcriptContainer) {
            console.log('DeepL.AI Extractor: Transcript container found.');
            this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
            this.observer.observe(transcriptContainer, {
                attributes: true,
                subtree: true,
                attributeFilter: ['class']
            });
            chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status: 'READY' });
        } else {
            console.log('DeepL.AI Extractor: Transcript container not found.');
            chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status: 'NO_TRANSCRIPT' });
        }
    }

    handleMutations(mutations) {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList.contains('active') && target.classList.contains('rc-Phrase')) {
                    this.handleActivePhraseChange(target);
                }
            }
        }
    }

    handleActivePhraseChange(element) {
        const text = element.innerText.trim();

        if (text && text !== this.currentSentence) {
            this.currentSentence = text;
            this.debounceSend(element);
        }
    }

    debounceSend(element) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(() => {
            this.extractContextAndSend(element);
        }, this.DEBOUNCE_DELAY);
    }

    extractContextAndSend(activeElement) {
        let prevContext = '';
        let nextContext = '';

        let prev = activeElement.previousElementSibling;
        let count = 0;
        while (prev && count < 2) {
            if (prev.classList.contains('rc-Phrase')) {
                prevContext = prev.innerText.trim() + ' ' + prevContext;
                count++;
            }
            prev = prev.previousElementSibling;
        }

        let next = activeElement.nextElementSibling;
        count = 0;
        while (next && count < 2) {
            if (next.classList.contains('rc-Phrase')) {
                nextContext += next.innerText.trim() + ' ';
                count++;
            }
            next = next.nextElementSibling;
        }

        const payload = {
            current: this.currentSentence,
            prev: prevContext.trim(),
            next: nextContext.trim()
        };

        console.log('DeepL.AI Extractor (DOM):', payload);
        chrome.runtime.sendMessage({
            action: 'NEW_TRANSCRIPT',
            data: payload
        });
    }

    // ==========================================
    // Export Logic
    // ==========================================

    handleImport(data) {
        console.log('Imported translation received!', data);
        if (Array.isArray(data) && data.length > 0) {
            // Normalize data
            const normalized = data.map((item, index) => {
                let start = item.startInSeconds;
                const text = item.text;

                // Handle "id": "00:00:00" format
                if (start === undefined && typeof item.id === 'string') {
                    const parts = item.id.split(':').map(Number);
                    if (parts.length === 3) {
                        start = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    } else if (parts.length === 2) {
                        start = parts[0] * 60 + parts[1];
                    }
                }

                return { startInSeconds: start, text: text, original: item };
            });

            // Filter valid items
            const validItems = normalized.filter(item => typeof item.startInSeconds === 'number' && item.text);

            if (validItems.length > 0) {
                // Calculate endInSeconds if missing
                this.translatedCaptionsData = validItems.map((item, i) => {
                    let end = item.original.endInSeconds;
                    if (end === undefined) {
                        // Use next item's start or default duration (e.g. 5s)
                        const nextItem = validItems[i + 1];
                        if (nextItem) {
                            end = nextItem.startInSeconds;
                        } else {
                            // Last item: typical duration
                            end = item.startInSeconds + 5;
                        }
                    }
                    return {
                        startInSeconds: item.startInSeconds,
                        endInSeconds: end,
                        text: item.text
                    };
                });

                console.log('Imported and normalized:', this.translatedCaptionsData);
                chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status: 'READY (Imported)' });
            } else {
                console.error('Invalid JSON structure. Could not find timestamps.');
                chrome.runtime.sendMessage({
                    action: 'TRANSLATION_ERROR',
                    error: 'Invalid Format: timestamps/text missing'
                });
            }
        } else {
            chrome.runtime.sendMessage({ action: 'TRANSLATION_ERROR', error: 'Invalid Format or Empty Array' });
        }
    }

    setupExportListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'REQUEST_EXPORT') {
                this.handleExport(request.language);
            }
            if (request.action === 'BATCH_TRANSLATION_COMPLETE') {
                this.downloadFile(request.text, 'kr');
                chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', status: 'READY' }); // Reset status
            }
            if (request.action === 'FULL_TRANSLATION_COMPLETE') {
                console.log('Full translation received!', request.data);
                this.translatedCaptionsData = request.data;
            }
            if (request.action === 'IMPORT_TRANSLATION') {
                this.handleImport(request.data);
            }
        });
    }

    handleExport(lang) {
        if (!this.captionsData || this.captionsData.length === 0) {
            alert('No transcript data available to export.');
            return;
        }

        if (lang === 'EN') {
            const text = this.formatCaptions(this.captionsData);
            this.downloadFile(text, 'en');
        } else if (lang === 'KR') {
            if (this.translatedCaptionsData) {
                // If already translated, just download
                const text = this.formatCaptions(this.translatedCaptionsData);
                this.downloadFile(text, 'kr');
            } else {
                alert('Translation in progress... Please wait until "Ready" status.');
                // Or we could trigger it again, but better to wait.
            }
        }
    }

    formatCaptions(captions) {
        // Simple text format: [Time] Text
        return captions.map(c => {
            const time = new Date(c.startInSeconds * 1000).toISOString().substr(11, 8);
            return `[${time}] ${c.text}`;
        }).join('\n');
    }

    downloadFile(content, lang) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transcript_${lang}_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize
const extractor = new TranscriptExtractor();
extractor.setupExportListener();
