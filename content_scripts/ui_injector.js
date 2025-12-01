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

        header.appendChild(controls);
        this.overlay.appendChild(header);

        // Text container
        this.textElement = document.createElement('div');
        this.textElement.className = 'deepl-overlay-text';
        this.textElement.innerText = 'Waiting for subtitles...';
        this.overlay.appendChild(this.textElement);

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

    makeDraggable() {
        const elmnt = this.overlay;
        const header = elmnt.querySelector('.deepl-overlay-header');

        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
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
}

// Initialize
new SubtitleOverlay();
