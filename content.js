(function() {
    'use strict';

    let isButtonVisible = false;
    let isDownloading = false;
    let downloadContainer = null;

    function extractSlug() {
        const match = window.location.pathname.match(/\/learn\/([^\/]+)/);
        return match ? match[1] : null;
    }

    function createDownloadUI() {
        const container = document.createElement('div');
        container.id = 'coursera-downloader';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 77px;
            background: #fff;
            border: 2px solid #0056d3;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            transition: all 0.3s ease;
            display: none;
        `;

        container.innerHTML = `
            <div id="download-form">
                <select id="resolution-select" style="width: 100%; margin-bottom: 8px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
                    <option value="720p" selected>720p</option>
                    <option value="1080p">1080p</option>
                    <option value="480p">480p</option>
                </select>
                <label style="display: flex; align-items: center; margin-bottom: 8px; font-size: 11px;">
                    <input type="checkbox" id="force-assets" checked style="margin-right: 4px;">
                    Force Assets
                </label>
                <button id="download-btn" style="width: 100%; padding: 6px; background: #0056d3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                    Download Now
                </button>
            </div>
            <div id="progress-section" style="display: none; margin-top: 8px;">
                <div id="progress-bar" style="width: 100%; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
                    <div id="progress-fill" style="height: 100%; background: #0056d3; width: 0%; transition: width 0.3s ease;"></div>
                </div>
                <div id="progress-text" style="text-align: center; font-size: 10px; margin: 4px 0;">0%</div>
                <button id="cancel-btn" style="width: 100%; padding: 4px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 10px;">
                    Cancel
                </button>
            </div>
            <div id="error-section" style="display: none; margin-top: 8px; color: #dc3545; font-size: 10px; text-align: center;"></div>
        `;

        document.body.appendChild(container);
        return container;
    }

    function createConfetti() {
        const confettiContainer = document.createElement('div');
        confettiContainer.id = 'confetti-container';
        confettiContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            pointer-events: none;
            z-index: 1000000;
            overflow: hidden;
        `;

        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];

        for (let i = 0; i < 100; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: 8px;
                height: 8px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                border-radius: 50%;
                animation: confetti-fall ${2 + Math.random() * 3}s linear forwards;
                left: ${Math.random() * 100}vw;
                top: -20px;
                transform: rotate(${Math.random() * 360}deg);
            `;
            confettiContainer.appendChild(particle);
        }

        const style = document.createElement('style');
        style.textContent = `
            @keyframes confetti-fall {
                to {
                    transform: translateY(100vh) rotate(720deg);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(confettiContainer);

        setTimeout(() => {
            confettiContainer.remove();
            style.remove();
        }, 5000);
    }

    function showButton() {
        if (!downloadContainer) {
            downloadContainer = createDownloadUI();
        }
        downloadContainer.style.display = 'block';
        isButtonVisible = true;
    }

    function hideButton() {
        if (downloadContainer) {
            downloadContainer.style.display = 'none';
        }
        isButtonVisible = false;
    }

    function showProgress() {
        if (!downloadContainer) return;
        downloadContainer.querySelector('#progress-section').style.display = 'block';
        downloadContainer.querySelector('#error-section').style.display = 'none';
        isDownloading = true;
    }

    function hideProgress() {
        if (!downloadContainer) return;
        downloadContainer.querySelector('#progress-section').style.display = 'none';
        isDownloading = false;
    }

    function updateProgress(percentage) {
        if (!downloadContainer) return;
        const fill = downloadContainer.querySelector('#progress-fill');
        const text = downloadContainer.querySelector('#progress-text');
        if (fill && text) {
            fill.style.width = `${percentage}%`;
            text.textContent = `${percentage}%`;
        }
    }

    function showError(errorMessage) {
        if (!downloadContainer) return;
        const errorSection = downloadContainer.querySelector('#error-section');
        errorSection.textContent = errorMessage;
        errorSection.style.display = 'block';
        downloadContainer.querySelector('#progress-section').style.display = 'none';

        setTimeout(() => {
            errorSection.style.display = 'none';
        }, 3000);
    }

    function setupEventListeners() {
        if (!downloadContainer) return;

        const downloadBtn = downloadContainer.querySelector('#download-btn');
        const cancelBtn = downloadContainer.querySelector('#cancel-btn');

        downloadBtn.addEventListener('click', () => {
            if (isDownloading) return;

            const slug = extractSlug();
            if (!slug) return;

            const resolution = downloadContainer.querySelector('#resolution-select').value;
            const forceAssets = downloadContainer.querySelector('#force-assets').checked;

            chrome.runtime.sendMessage({
                type: 'START_DOWNLOAD',
                data: { slug, resolution, forceAssets }
            });

            showProgress();
            updateProgress(0);
        });

        cancelBtn.addEventListener('click', () => {
            const text = downloadContainer.querySelector('#progress-text');
            text.textContent = 'Cancelling...';

            chrome.runtime.sendMessage({
                type: 'CANCEL_DOWNLOAD'
            });
        });
    }

    chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
            case 'BUTTON_TOGGLED':
                if (message.data.enabled) {
                    showButton();
                    setupEventListeners();
                } else {
                    hideButton();
                }
                break;

            case 'DOWNLOAD_PROGRESS':
                updateProgress(message.data.percentage);
                break;

            case 'DOWNLOAD_COMPLETE':
                hideProgress();
                createConfetti();
                break;

            case 'DOWNLOAD_ERROR':
                showError(message.data.error);
                break;
        }
    });

    function cleanup() {
        if (downloadContainer && downloadContainer.parentNode) {
            downloadContainer.parentNode.removeChild(downloadContainer);
        }
        downloadContainer = null;
        isButtonVisible = false;
        isDownloading = false;
    }

    window.addEventListener('beforeunload', cleanup);

    if (window.location.pathname.includes('/learn/')) {
        chrome.runtime.sendMessage({ type: 'CHECK_BUTTON_STATE' });
    }
})();