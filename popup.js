// popup.js - with demo functionality
document.addEventListener('DOMContentLoaded', async () => {
  const toggleSwitch = document.getElementById('toggleSwitch');
  const status = document.getElementById('status');
  const demoButton = document.getElementById('demoButton');
  
  // Check if user is on a Coursera course page
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnCoursePage = activeTab?.url?.includes('coursera.org/learn/');
  
  // Load saved state (default: true for first install)
  const result = await chrome.storage.local.get({ buttonEnabled: true });
  const isEnabled = result.buttonEnabled;
  
  // Update UI based on current page
  updateToggleState(isEnabled, isOnCoursePage);
  
  // Toggle click handler
  toggleSwitch.addEventListener('click', async () => {
      // Check if on course page before allowing toggle
      if (!isOnCoursePage) {
        status.textContent = 'Visit a Coursera course page and the download Manager will appear';
        status.style.color = '#ffeb3b';
        setTimeout(() => {
          status.style.color = '';
          updateToggleState(isEnabled, isOnCoursePage);
        }, 3000);
        return;
      }

      const newState = !toggleSwitch.classList.contains('active');
      
      // Save state
      await chrome.storage.local.set({ buttonEnabled: newState });
      
      // Update UI
      updateToggleState(newState, isOnCoursePage);
      
      // Notify background script
      chrome.runtime.sendMessage({
          type: 'TOGGLE_BUTTON',
          enabled: newState
      });
  });

  // Demo button click handler
  demoButton.addEventListener('click', async () => {
    await runDemo();
  });
  
  function updateToggleState(enabled, onCoursePage = true) {
      if (!onCoursePage) {
          // Disable toggle when not on course page
          toggleSwitch.style.opacity = '0.5';
          toggleSwitch.style.cursor = 'not-allowed';
          status.textContent = 'Visit a Coursera course to enable downloads';
          status.style.color = '#ffb74d';
          return;
      }

      // Reset styles for course pages
      toggleSwitch.style.opacity = '1';
      toggleSwitch.style.cursor = 'pointer';
      status.style.color = '';

      if (enabled) {
          toggleSwitch.classList.add('active');
          status.textContent = 'Download button enabled on this course';
      } else {
          toggleSwitch.classList.remove('active');
          status.textContent = 'Download button disabled';
      }
  }

  // Demo functionality
  async function runDemo() {
    try {
      demoButton.disabled = true;
      demoButton.textContent = 'Running Demo...';
      status.textContent = 'Generating course HTML...';

      const sampleCourseData = {};

      // Generate extension headers
      const headers = makeExtHeaders();

      // Call the Vercel API
      const response = await fetch('https://www.forestily.com/api/generate-course-html', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          courseData: sampleCourseData,
          slug: 'extension-demo',
          options: {
            resolution: '360p',
            forceDownload: false
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTML generation API failed: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'HTML generation failed');
      }

      status.textContent = 'Downloading HTML file...';

      // Download the HTML file
      const htmlContent = result.htmlResult.html;
      const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(htmlContent);
      
      await new Promise((resolve, reject) => {
        chrome.downloads.download(
          {
            url: dataUrl,
            filename: `downloads/extension-demo/${result.htmlResult.fileName}`,
            conflictAction: "overwrite",
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(downloadId);
            }
          },
        );
      });

      status.textContent = 'Demo completed! Check your downloads.';
      demoButton.textContent = 'Demo Complete âœ“';

    } catch (error) {
      console.error('Demo failed:', error);
      status.textContent = `Demo failed: ${error.message}`;
      demoButton.textContent = 'Demo Failed âœ—';
    } finally {
      // Re-enable button after 3 seconds
      setTimeout(() => {
        demoButton.disabled = false;
        demoButton.textContent = 'Run Demo';
      }, 3000);
    }
  }

  // Helper function to create extension headers
  function makeExtHeaders() {
    const timestamp = Date.now().toString();
    const nonce = Math.random().toString(36).substr(2, 16);

    // Step 0: Create original data string
    const originalData = `${chrome.runtime.id}|${timestamp}|${nonce}`;

    // Step 1: Base64 encode
    const step1Data = btoa(originalData);

    // Step 2: Reverse string
    const reversedStep1 = step1Data.split('').reverse().join('');

    // Step 3: Character shift (+3)
    const step2Data = reversedStep1.replace(/./g, ch =>
      String.fromCharCode(ch.charCodeAt(0) + 3)
    );

    // Step 4: Add sentinel and timestamp
    const payload = `${step2Data}__SENTINEL__${Number(timestamp).toString(36)}`;

    // Step 5: Final base64 encoding
    const extAuth = btoa(payload);

    return {
      'X-Extension-Auth': extAuth,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'Content-Type': 'application/json'
    };
  }
});