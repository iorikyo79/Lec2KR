/**
 * DeepL.AI Translator - UI Injector
 * Handles the floating subtitle overlay.
 */

class SubtitleOverlay {
    constructor() {
        this.overlay = null;
        this.textElement = null;
        this.isVisible = true;
        this.init();
    }

    init() {
        this.createOverlay();
        this.setupMessageListener();
        this.makeDraggable();
        this.makeResizable();
    }

    createOverlay() {
        // Check if already exists
        if (document.getElementById('deepl-ai-overlay')) return;

        this.overlay = document.createElement('div');
        this.overlay.id = 'deepl-ai-overlay';
        this.overlay.className = 'deepl-overlay';

        // Header for dragging and controls
        const header = document.createElement('div');
        header.className = 'deepl-overlay-header';

        // Drag Handle
        const dragHandle = document.createElement('span');
        dragHandle.innerText = '::';
        dragHandle.className = 'deepl-drag-handle';
        header.appendChild(dragHandle);

        // Controls Container
        const controls = document.createElement('div');
        controls.className = 'deepl-controls';

        // Status Display (New)
        this.statusElement = document.createElement('span');
        this.statusElement.className = 'deepl-status';
        this.statusElement.innerText = 'Init...';
        controls.appendChild(this.statusElement);

        // Refresh Button
        const refreshBtn = document.createElement('button');
        refreshBtn.innerText = '↻'; // Refresh symbol
        refreshBtn.className = 'deepl-btn';
        refreshBtn.title = 'Refresh Page (Reset)';
        refreshBtn.onclick = () => window.location.reload();
        controls.appendChild(refreshBtn);

        // Export EN Button
        const exportEnBtn = document.createElement('button');
        exportEnBtn.innerText = 'EN';
        exportEnBtn.className = 'deepl-btn';
        exportEnBtn.title = 'Export English Transcript';
        exportEnBtn.onclick = () => this.requestExport('EN');
        controls.appendChild(exportEnBtn);

        // Export KR Button
        const exportKrBtn = document.createElement('button');
        exportKrBtn.innerText = 'KR';
        exportKrBtn.className = 'deepl-btn';
        exportKrBtn.title = 'Export Korean Transcript (Batch Translate)';
        exportKrBtn.onclick = () => this.requestExport('KR');
        controls.appendChild(exportKrBtn);

        // Import Button
        const importBtn = document.createElement('button');
        importBtn.innerText = 'Import';
        importBtn.className = 'deepl-btn';
        importBtn.title = 'Import Translated JSON';
        importBtn.onclick = () => this.triggerImport();
        controls.appendChild(importBtn);

        // Hidden File Input
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.json,.txt';
        this.fileInput.style.display = 'none';
        this.fileInput.onchange = (e) => this.handleFileSelect(e);
        controls.appendChild(this.fileInput);

        header.appendChild(controls);
        this.overlay.appendChild(header);

        // Text container
        this.textElement = document.createElement('div');
        this.textElement.className = 'deepl-overlay-text';
        this.textElement.innerText = 'Waiting for subtitles...';
        this.overlay.appendChild(this.textElement);

        // Resize Handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'deepl-resize-handle';
        this.overlay.appendChild(resizeHandle);

        document.body.appendChild(this.overlay);
    }

    requestExport(lang) {
        // this.updateText(`Exporting ${lang}... Please wait.`, false);
        // Don't overwrite subtitle text for status
        this.updateStatus(`Exporting ${lang}...`);
        chrome.runtime.sendMessage({
            action: 'REQUEST_EXPORT',
            language: lang
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'SHOW_SUBTITLE') {
                this.updateText(request.text);
            }
            if (request.action === 'TOGGLE_TRANSLATION') {
                this.toggleVisibility(request.enabled);
            }
            if (request.action === 'STATUS_UPDATE') {
                this.handleStatus(request.status);
            }
            if (request.action === 'TRANSLATION_ERROR') {
                this.updateText('Error: ' + request.error, true);
                this.updateStatus('Error');
            }
        });
    }

    handleStatus(status) {
        this.updateStatus(status);

        // Also update main text for critical states if needed, but status bar is better
        if (status === 'NO_TRANSCRIPT') {
            this.updateText('Transcript not found.', true);
        }
    }

    updateStatus(text) {
        if (this.statusElement) {
            this.statusElement.innerText = text;
            // Simple visual cue for active translation
            if (text.includes('Translating')) {
                this.statusElement.style.color = '#4dabf7'; // Blueish
            } else if (text === 'READY') {
                this.statusElement.style.color = '#51cf66'; // Greenish
            } else {
                this.statusElement.style.color = '#aaa';
            }
        }
    }

    updateText(text, isError = false) {
        if (this.textElement) {
            this.textElement.innerText = text;
            this.textElement.style.color = isError ? '#ff6b6b' : '#fff';

            // Fade effect
            this.textElement.style.opacity = '0';
            requestAnimationFrame(() => {
                this.textElement.style.opacity = '1';
            });
        }
    }

    toggleVisibility(enabled) {
        this.isVisible = enabled;
        if (this.overlay) {
            this.overlay.style.display = enabled ? 'block' : 'none';
        }
    }

    triggerImport() {
        this.fileInput.click();
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            let data = null;

            try {
                if (file.name.toLowerCase().endsWith('.json')) {
                    data = JSON.parse(content);
                } else {
                    // Treat as TXT
                    data = this.parseTxtImport(content);
                }

                if (Array.isArray(data) && data.length > 0) {
                    chrome.runtime.sendMessage({
                        action: 'IMPORT_TRANSLATION',
                        data: data
                    });
                    this.updateStatus('Imported!');
                } else {
                    alert('Invalid format. For TXT, use "[HH:MM:SS] Text". For JSON, ensure it is an array.');
                }
            } catch (err) {
                console.error('Import failed', err);
                alert('Failed to parse file: ' + err.message);
            }
        };
        reader.readAsText(file);
        // Reset value to allow re-importing same file
        event.target.value = '';
    }

    parseTxtImport(text) {
        const lines = text.split(/\r?\n/);
        const data = [];
        // Match: [00:00:15] Hello world
        const regex = /^\[(\d{1,2}:\d{2}:\d{2})\]\s*(.*)$/;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const match = trimmed.match(regex);
            if (match) {
                data.push({
                    id: match[1],
                    text: match[2].trim()
                });
            }
        }
        return data;
    }

    makeDraggable() {
        const elmnt = this.overlay;
        const header = elmnt.querySelector('.deepl-overlay-header');

        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();

            // Fix for position jumping when transform is present
            // Convert to absolute positioning on first drag
            const rect = elmnt.getBoundingClientRect();

            // Only if not already absolute/fixed with top/left set manually (simple check)
            // But to be safe, we force it.
            // We need to remove the transform and set explicit top/left
            if (elmnt.style.transform !== 'none') {
                elmnt.style.left = rect.left + 'px';
                elmnt.style.top = rect.top + 'px';
                elmnt.style.bottom = 'auto'; // Remove bottom constraint
                elmnt.style.right = 'auto';
                elmnt.style.transform = 'none';
                elmnt.style.margin = '0'; // Clear margins that might affect position
            }

            // get the mouse cursor position at startup:
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            // call a function whenever the cursor moves:
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            // calculate the new cursor position:
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            // set the element's new position:
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
            elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            // stop moving when mouse button is released:
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    makeResizable() {
        const elmnt = this.overlay;
        const resizer = elmnt.querySelector('.deepl-resize-handle');
        if (!resizer) return;

        let startX, startY, startWidth, startHeight;

        resizer.addEventListener('mousedown', initResize, false);

        function initResize(e) {
            e.preventDefault();
            // Stop propagation so it doesn't trigger drag
            e.stopPropagation();

            startX = e.clientX;
            startY = e.clientY;

            const rect = elmnt.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;

            // Ensure absolute positioning is locked in (similar to drag fix)
            if (elmnt.style.transform !== 'none') {
                elmnt.style.left = rect.left + 'px';
                elmnt.style.top = rect.top + 'px';
                elmnt.style.bottom = 'auto';
                elmnt.style.right = 'auto';
                elmnt.style.transform = 'none';
                elmnt.style.margin = '0';
            }

            window.addEventListener('mousemove', resize, false);
            window.addEventListener('mouseup', stopResize, false);
        }

        function resize(e) {
            const width = startWidth + (e.clientX - startX);
            const height = startHeight + (e.clientY - startY);

            // Minimum dimensions are handled by CSS (min-width/min-height)
            // but setting style width/height will override unless we respect them.
            // But CSS min-width/height usually win over style width/height if smaller.
            // Let's just set them.
            elmnt.style.width = width + 'px';
            elmnt.style.height = height + 'px';
        }

        function stopResize(e) {
            window.removeEventListener('mousemove', resize, false);
            window.removeEventListener('mouseup', stopResize, false);
        }
    }
}

// Initialize
new SubtitleOverlay();
