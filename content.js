// ============================================================================
// CONTENT.JS - Minimal Course Downloader Button
// ============================================================================

let downloadButton = null;
let isDownloading = false;
let currentSlug = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function extractSlugFromURL() {
  const match = window.location.href.match(/coursera\.org\/learn\/([^\/\?#]+)/);
  return match ? match[1] : null;
}

function isCoursePage() {
  return window.location.href.includes('coursera.org/learn/');
}

// ============================================================================
// UI CREATION
// ============================================================================

function createDownloadButton() {
  if (downloadButton) return;

  const container = document.createElement('div');
  container.id = 'coursera-downloader';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    width: 77px;
    z-index: 999999;
    font-family: Arial, sans-serif;
    font-size: 12px;
  `;

  container.innerHTML = `
    <div id="download-form">
      <select id="resolution-select">
        <option value="720p">720p</option>
        <option value="540p">540p</option>
        <option value="360p">360p</option>
      </select>
      <label>
        <input type="checkbox" id="force-assets" checked> Force Assets
      </label>
      <button id="download-btn">Download Now</button>
    </div>
    
    <div id="progress-section" style="display: none;">
      <div id="progress-bar-container">
        <div id="progress-bar"></div>
        <div id="progress-text">0%</div>
      </div>
      <button id="cancel-btn">Cancel</button>
    </div>
    
    <div id="error-section" style="display: none;">
      <div id="error-message"></div>
      <button id="retry-btn">Retry</button>
    </div>
  `;

  document.body.appendChild(container);
  downloadButton = container;
  setupEventListeners();
}

function removeDownloadButton() {
  if (downloadButton) {
    downloadButton.remove();
    downloadButton = null;
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  const downloadBtn = document.getElementById('download-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const retryBtn = document.getElementById('retry-btn');

  downloadBtn.addEventListener('click', startDownload);
  cancelBtn.addEventListener('click', cancelDownload);
  retryBtn.addEventListener('click', () => {
    showForm();
    startDownload();
  });
}

// ============================================================================
// DOWNLOAD FUNCTIONS
// ============================================================================

async function startDownload() {
  const slug = extractSlugFromURL();
  if (!slug) {
    showError('Could not detect course from URL');
    return;
  }

  const resolution = document.getElementById('resolution-select').value;
  const forceAssets = document.getElementById('force-assets').checked;

  isDownloading = true;
  currentSlug = slug;
  showProgress();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      slug: slug,
      resolution: resolution,
      forceAssets: forceAssets
    });

    if (!response.success) {
      throw new Error(response.error);
    }
  } catch (error) {
    showError(error.message);
    isDownloading = false;
  }
}

async function cancelDownload() {
  const cancelBtn = document.getElementById('cancel-btn');
  cancelBtn.textContent = 'Cancelling...';
  cancelBtn.disabled = true;

  try {
    await chrome.runtime.sendMessage({
      type: 'CANCEL_DOWNLOAD'
    });
  } catch (error) {
    // Silent fail
  }

  isDownloading = false;
  showForm();
}

// ============================================================================
// UI STATE MANAGEMENT
// ============================================================================

function showForm() {
  document.getElementById('download-form').style.display = 'block';
  document.getElementById('progress-section').style.display = 'none';
  document.getElementById('error-section').style.display = 'none';
}

function showProgress() {
  document.getElementById('download-form').style.display = 'block';
  document.getElementById('progress-section').style.display = 'block';
  document.getElementById('error-section').style.display = 'none';
  
  updateProgress(0);
  
  const cancelBtn = document.getElementById('cancel-btn');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.disabled = false;
}

function showError(message) {
  document.getElementById('download-form').style.display = 'block';
  document.getElementById('progress-section').style.display = 'none';
  document.getElementById('error-section').style.display = 'block';
  document.getElementById('error-message').textContent = message;
  
  setTimeout(() => {
    if (!isDownloading) {
      showForm();
    }
  }, 3000);
}

function updateProgress(percentage) {
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  
  if (progressBar) {
    progressBar.style.width = percentage + '%';
  }
  if (progressText) {
    progressText.textContent = percentage + '%';
  }
}

// ============================================================================
// CONFETTI ANIMATION
// ============================================================================

function createConfetti() {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];
  
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    confetti.style.cssText = `
      position: fixed;
      width: 8px;
      height: 8px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      left: ${Math.random() * 100}vw;
      top: -10px;
      z-index: 1000000;
      pointer-events: none;
      animation: confetti-fall ${2 + Math.random() * 3}s linear forwards;
    `;
    
    document.body.appendChild(confetti);
    
    setTimeout(() => {
      if (confetti.parentNode) {
        confetti.parentNode.removeChild(confetti);
      }
    }, 5000);
  }
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'DOWNLOAD_PROGRESS':
      if (message.percentage !== undefined) {
        updateProgress(message.percentage);
      }
      break;
      
    case 'DOWNLOAD_COMPLETE':
      isDownloading = false;
      createConfetti();
      setTimeout(() => {
        showForm();
      }, 2000);
      break;
      
    case 'DOWNLOAD_ERROR':
      isDownloading = false;
      showError(message.error || 'Download failed');
      break;
      
    case 'DOWNLOAD_CANCELLED':
      isDownloading = false;
      showForm();
      break;
      
    case 'BUTTON_TOGGLED':
      if (message.enabled && isCoursePage()) {
        createDownloadButton();
      } else {
        removeDownloadButton();
      }
      break;
  }
  
  sendResponse({ success: true });
});

// ============================================================================
// URL CHANGE DETECTION
// ============================================================================

let lastUrl = location.href;

function checkUrlChange() {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    
    if (isCoursePage()) {
      // Check if button should be shown
      chrome.runtime.sendMessage({ type: 'GET_BUTTON_STATE' }, (response) => {
        if (response && response.enabled) {
          createDownloadButton();
        }
      });
    } else {
      removeDownloadButton();
    }
  }
}

// Monitor URL changes
const observer = new MutationObserver(checkUrlChange);
observer.observe(document, { subtree: true, childList: true });
window.addEventListener('popstate', checkUrlChange);

// Override pushState and replaceState
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
  originalPushState.apply(history, args);
  setTimeout(checkUrlChange, 100);
};

history.replaceState = function(...args) {
  originalReplaceState.apply(history, args);
  setTimeout(checkUrlChange, 100);
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  if (!isCoursePage()) return;
  
  // Add confetti CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes confetti-fall {
      0% {
        transform: translateY(-10px) rotate(0deg);
        opacity: 1;
      }
      100% {
        transform: translateY(100vh) rotate(360deg);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
  
  // Check if button should be shown
  chrome.runtime.sendMessage({ type: 'GET_BUTTON_STATE' }, (response) => {
    if (response && response.enabled) {
      createDownloadButton();
    }
  });
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ============================================================================
// CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
  if (observer) {
    observer.disconnect();
  }
  removeDownloadButton();
});