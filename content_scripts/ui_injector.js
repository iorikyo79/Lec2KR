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

        // Refresh Button
        const refreshBtn = document.createElement('button');
        refreshBtn.innerText = '↻';
        refreshBtn.className = 'deepl-btn';
        refreshBtn.title = 'Manual Refresh';
        refreshBtn.onclick = () => this.requestRefresh();
        controls.appendChild(refreshBtn);

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

    requestRefresh() {
        this.updateStatus('Reloading...');
        // Send directly to extractor in the same tab, or via background if preferred.
        // Since both scripts are in the same tab, we can use runtime.sendMessage and let background route it,
        // OR we can send to background and background sends back to tab?
        // Actually, content scripts can't send messages to other content scripts directly easily without background.
        // So we send to background, and background forwards to tab (already implemented for general relay).
        // BUT, we can also just listen in extractor for this message if we send it via runtime.

        // Let's send to background to relay, or directly to extractor if it listens to runtime.onMessage.
        // Extractor listens to runtime.onMessage.
        // However, chrome.runtime.sendMessage sends to background script usually.
        // So we need background to relay it back to the tab.

        // Let's use a specific action that background handles?
        // Or simply rely on the fact that extractor listens to 'MANUAL_REFRESH'.
        // But if we send from here, it goes to background. Background needs to bounce it back.

        // Let's check background.js relay logic.
        // It relays SHOW_SUBTITLE and STATUS_UPDATE.
        // Let's add MANUAL_REFRESH relay support to background or just handle it there.

        // Actually, cleaner way:
        chrome.runtime.sendMessage({
            action: 'MANUAL_REFRESH'
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
