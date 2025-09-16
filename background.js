
import { extractVideos } from "./magic.js";

const state = {
  currentDownload: null,
  sessionActive: false,
  currentSlug: null
};

const Storage = {
  async get(key) {
    const result = await chrome.storage.local.get([key]);
    return result[key];
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }
};

const TabComm = {
  async sendToAllCoursera(message) {
    try {
      const tabs = await chrome.tabs.query({
        url: ["*://*.coursera.org/learn/*"]
      });

      for (const tab of tabs) {
        try {
          chrome.tabs.sendMessage(tab.id, message);
        } catch (error) {
          // Silent fail for inactive tabs
        }
      }
    } catch (error) {
      console.error("Failed to send to tabs:", error);
    }
  }
};

const SessionManager = {
  start(slug) {
    if (state.sessionActive) {
      throw new Error(`Download already active for: ${state.currentSlug}`);
    }

    state.sessionActive = true;
    state.currentSlug = slug;
    state.currentDownload = {
      slug: slug,
      startedAt: Date.now(),
      status: 'active'
    };
  },

  end() {
    state.sessionActive = false;
    state.currentSlug = null;
    state.currentDownload = null;
  },

  isActive() {
    return state.sessionActive;
  }
};

async function getCauth() {
  return new Promise(resolve => {
    chrome.cookies.get({
      url: 'https://www.coursera.org',
      name: 'CAUTH'
    }, cookie => {
      resolve(cookie?.value);
    });
  });
}


async function download_terminal_velocity(f) {
  console.log('🚀 Terminal Velocity Download Started');

  const courseSlug = f.course || 'course';
  const baseFolder = `downloads/${courseSlug}/`;

  let downloadCount = 0;
  const downloadQueue = [];
  const failedDownloads = [];

  // Progress tracking for future UI implementation
  const progressTracker = {
    total: 0,
    completed: 0,
    failed: 0,
    retrying: 0,
    phase: 'initializing' // 'downloading', 'html', 'retrying', 'complete'
  };

  // Helper function to emit progress events
  async function emitProgress(event, data = {}) {
    const progressEvent = {
      type: 'DOWNLOAD_PROGRESS',
      phase: progressTracker.phase,
      stats: { ...progressTracker },
      event: event,
      timestamp: Date.now(),
      ...data
    };

    // Send progress to all Coursera tabs
    await TabComm.sendToAllCoursera({
      type: 'DOWNLOAD_PROGRESS',
      slug: courseSlug,
      status: `${progressTracker.phase}: ${event}`,
      completed: progressTracker.completed,
      total: progressTracker.total,
      percentage: progressTracker.total > 0 ? Math.round((progressTracker.completed / progressTracker.total) * 100) : 0,
      phase: progressTracker.phase,
      event: event
    });
  }

  // Helper function to add downloads to queue
  function queueDownload(url, filename, folderPath = '', moduleInfo = {}) {
    if (!url || !filename) return;

    downloadQueue.push({
      url: url,
      filename: folderPath + filename,
      fullPath: folderPath + filename,
      folderPath: folderPath,
      originalFilename: filename,
      id: downloadCount++,
      moduleInfo: moduleInfo
    });
  }

  // Process modules -> lessons -> items (videos and subtitles)
  if (f.modules) {
    for (const module of f.modules) {
      if (module.lessons) {
        for (const lesson of module.lessons) {
          if (lesson.items) {
            for (const item of lesson.items) {
              // Skip supplements, only process lectures
              if (item.type === 'lecture') {
                const moduleInfo = {
                  moduleId: module.id,
                  lessonTitle: lesson.title,
                  itemName: item.name,
                  itemType: item.type,
                  duration: item.duration
                };

                // Download video (mp4) to videos/ folder
                if (item.mp4) {
                  queueDownload(
                    item.mp4,
                    item.safeFilename || `${item.name}.mp4`,
                    baseFolder + 'videos/',
                    { ...moduleInfo, contentType: 'video' }
                  );
                }

                // Download subtitles (vtt) to subtitles/ folder
                if (item.subtitles) {
                  const subtitleFilename = item.safeFilename
                    ? item.safeFilename.replace('.mp4', '.vtt')
                    : `${item.name}.vtt`;
                  queueDownload(
                    item.subtitles,
                    subtitleFilename,
                    baseFolder + 'subtitles/',
                    { ...moduleInfo, contentType: 'subtitle' }
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  // Process standalone assets to assets/ folder
  if (f.assets) {
    for (const asset of f.assets) {
      if (asset.url && asset.safeFilename) {
        queueDownload(
          asset.url,
          asset.safeFilename,
          baseFolder + 'assets/',
          {
            assetId: asset.id,
            assetType: asset.type,
            contentType: 'asset'
          }
        );
      }
    }
  }

  // Process resources and their assets to assets/ folder
  if (f.resources) {
    for (const resource of f.resources) {
      if (resource.assets) {
        for (const assetId of resource.assets) {
          // Find the actual asset by ID
          const asset = f.assets?.find(a => a.id === assetId);
          if (asset?.url && asset?.safeFilename) {
            queueDownload(
              asset.url,
              asset.safeFilename,
              baseFolder + 'assets/',
              {
                resourceName: resource.name,
                assetId: asset.id,
                assetType: asset.type,
                contentType: 'resource_asset'
              }
            );
          }
        }
      }
    }
  }

  progressTracker.total = downloadQueue.length;
  progressTracker.phase = 'downloading';

  console.log(`📦 Queued ${downloadQueue.length} downloads`);
  await emitProgress('QUEUE_READY', { totalItems: downloadQueue.length });

  // Enhanced download function with failure tracking
  async function downloadFile(item, isRetry = false) {
    return new Promise(async (resolve) => {
      const logPrefix = isRetry ? '🔄 Retry' : '⬇️ Downloading';
      console.log(`${logPrefix}: ${item.originalFilename}`);

      await emitProgress('DOWNLOAD_STARTED', {
        filename: item.originalFilename,
        isRetry: isRetry
      });

      chrome.downloads.download({
        url: item.url,
        filename: item.filename,
        conflictAction: 'overwrite'
      }, async (downloadId) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          console.error(`❌ Failed: ${item.originalFilename} - ${error}`);

          failedDownloads.push({
            ...item,
            error: error,
            retryAttempted: isRetry,
            failedAt: new Date().toISOString()
          });

          progressTracker.failed++;
          await emitProgress('DOWNLOAD_FAILED', {
            filename: item.originalFilename,
            error: error,
            isRetry: isRetry
          });

          resolve();
          return;
        }

        // Listen for completion
        const onChanged = async (delta) => {
          if (delta.id === downloadId) {
            if (delta.state?.current === 'complete') {
              chrome.downloads.onChanged.removeListener(onChanged);
              progressTracker.completed++;
              console.log(`✅ Completed (${progressTracker.completed}/${progressTracker.total}): ${item.originalFilename}`);

              await emitProgress('DOWNLOAD_COMPLETED', {
                filename: item.originalFilename,
                progress: Math.round((progressTracker.completed / progressTracker.total) * 100)
              });

              resolve();
            } else if (delta.state?.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(onChanged);
              const error = delta.error?.current || 'Download interrupted';

              failedDownloads.push({
                ...item,
                error: error,
                retryAttempted: isRetry,
                failedAt: new Date().toISOString()
              });

              progressTracker.failed++;
              console.error(`❌ Interrupted: ${item.originalFilename} - ${error}`);

              await emitProgress('DOWNLOAD_FAILED', {
                filename: item.originalFilename,
                error: error,
                isRetry: isRetry
              });

              resolve();
            }
          }
        };

        chrome.downloads.onChanged.addListener(onChanged);
      });
    });
  }

  // Process downloads with concurrency limit
  const CONCURRENT_DOWNLOADS = 3;
  const processBatch = async (batch, isRetry = false) => {
    const promises = batch.map(item => downloadFile(item, isRetry));
    await Promise.all(promises);
  };

  // PHASE 1: Initial downloads
  console.log(`🎯 Starting initial downloads...`);
  for (let i = 0; i < downloadQueue.length; i += CONCURRENT_DOWNLOADS) {
    const batch = downloadQueue.slice(i, i + CONCURRENT_DOWNLOADS);
    await processBatch(batch, false);

    if (i + CONCURRENT_DOWNLOADS < downloadQueue.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // PHASE 2: Generate and download HTML file
  progressTracker.phase = 'html';
  console.log(`📄 Generating HTML file...`);
  await emitProgress('HTML_GENERATION_STARTED');

  try {
    const htmlResult = await generateCourseHTML(f, courseSlug);
    if (htmlResult) {
      await downloadHTMLFile(htmlResult, courseSlug);
      console.log(`✅ HTML file downloaded successfully`);
      await emitProgress('HTML_GENERATION_COMPLETED');
    }
  } catch (error) {
    console.error(`❌ Failed to generate/download HTML:`, error);
    failedDownloads.push({
      filename: 'course.html',
      originalFilename: 'course.html',
      url: 'forestily-api',
      folderPath: baseFolder,
      error: 'HTML generation failed: ' + error.message,
      retryAttempted: false,
      failedAt: new Date().toISOString(),
      moduleInfo: { contentType: 'html', special: true }
    });
    progressTracker.failed++;
    await emitProgress('HTML_GENERATION_FAILED', { error: error.message });
  }

  // PHASE 3: Retry failed downloads (excluding HTML)
  const retryableFailures = failedDownloads.filter(item =>
    !item.retryAttempted && item.filename !== 'course.html'
  );

  if (retryableFailures.length > 0) {
    progressTracker.phase = 'retrying';
    progressTracker.retrying = retryableFailures.length;

    console.log(`🔄 Retrying ${retryableFailures.length} failed downloads...`);
    await emitProgress('RETRY_PHASE_STARTED', { retryCount: retryableFailures.length });

    // Clear retry items from failed list temporarily
    const preRetryFailures = [...failedDownloads];
    failedDownloads.length = 0;

    // Add non-retryable failures back
    failedDownloads.push(...preRetryFailures.filter(item =>
      item.retryAttempted || item.filename === 'course.html'
    ));

    // Process retries one by one (no concurrency for retries)
    for (const item of retryableFailures) {
      await downloadFile(item, true);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between retries
    }

    await emitProgress('RETRY_PHASE_COMPLETED');
  }

  // PHASE 4: Final results and report generation
  progressTracker.phase = 'complete';
  const finalFailures = failedDownloads.filter(item => item.error);
  const totalSuccessful = progressTracker.total - finalFailures.length;

  console.log(`🎉 Download Terminal Velocity Complete!`);
  console.log(`✅ Completed: ${totalSuccessful}`);
  console.log(`❌ Failed: ${finalFailures.length}`);
  console.log(`📊 Success Rate: ${Math.round((totalSuccessful / progressTracker.total) * 100)}%`);

  await emitProgress('DOWNLOAD_COMPLETE', {
    completed: totalSuccessful,
    failed: finalFailures.length,
    successRate: Math.round((totalSuccessful / progressTracker.total) * 100)
  });

  // Generate failure report if needed
  if (finalFailures.length > 0) {
    await generateFailureReport(finalFailures, courseSlug, baseFolder);
  }
  //   ====== ADD AT THE BOTTOM OF download_terminal_velocity FUNCTION ======
  // Add these lines at the end of your download_terminal_velocity function:

  // Notify completion
  await TabComm.sendToAllCoursera({
    type: 'DOWNLOAD_COMPLETE',
    slug: courseSlug,
    completed: totalSuccessful,
    total: progressTracker.total
  });

  // End session
  SessionManager.end();

  return {
    total: progressTracker.total,
    completed: totalSuccessful,
    failed: finalFailures.length,
    successRate: Math.round((totalSuccessful / progressTracker.total) * 100),
    failureReport: finalFailures.length > 0 ? `${baseFolder}failed_downloads.txt` : null
  };
}

// Generate comprehensive failure report
async function generateFailureReport(failures, courseSlug, baseFolder) {
  const reportDate = new Date().toISOString();
  const failureCount = failures.length;

  let report = '';

  // Header with retry recommendation
  if (failureCount > 5) {
    report += `⚠️ ATTENTION: ${failureCount} downloads failed!\n`;
    report += `RECOMMENDATION: Consider retrying the entire download sequence.\n`;
    report += `Some files may have network issues or temporary server problems.\n\n`;
  } else {
    report += `📋 Download Failure Report\n`;
    report += `${failureCount} file(s) failed to download.\n\n`;
  }

  report += `Course: ${courseSlug}\n`;
  report += `Report Generated: ${reportDate}\n`;
  report += `Total Failed Downloads: ${failureCount}\n\n`;
  report += `⚡ ACTION REQUIRED: Download these files as soon as possible!\n\n`;
  report += `${'='.repeat(80)}\n\n`;

  // Group failures by content type for better organization
  const groupedFailures = failures.reduce((groups, failure) => {
    const type = failure.moduleInfo?.contentType || 'unknown';
    if (!groups[type]) groups[type] = [];
    groups[type].push(failure);
    return groups;
  }, {});

  // Generate detailed failure information
  Object.entries(groupedFailures).forEach(([contentType, items]) => {
    report += `📁 ${contentType.toUpperCase()} FILES (${items.length} failed):\n`;
    report += `${'-'.repeat(50)}\n`;

    items.forEach((failure, index) => {
      report += `${index + 1}. FAILED DOWNLOAD:\n`;

      // Module information
      if (failure.moduleInfo) {
        const info = failure.moduleInfo;
        if (info.moduleId) report += `   Module: ${info.moduleId}\n`;
        if (info.lessonTitle) report += `   Lesson: ${info.lessonTitle}\n`;
        if (info.itemName) report += `   Item: ${info.itemName}\n`;
        if (info.resourceName) report += `   Resource: ${info.resourceName}\n`;
        if (info.duration) report += `   Duration: ${info.duration}\n`;
      }

      // File details
      report += `   Filename: ${failure.originalFilename}\n`;
      report += `   Folder Path: ${failure.folderPath}\n`;
      report += `   Download URL: ${failure.url}\n`;
      report += `   Error: ${failure.error}\n`;
      report += `   Retry Attempted: ${failure.retryAttempted ? 'Yes' : 'No'}\n`;
      report += `   Failed At: ${failure.failedAt}\n`;
      report += `\n`;
    });

    report += `\n`;
  });

  report += `${'='.repeat(80)}\n`;
  report += `📞 SUPPORT: If issues persist, check network connection and try again.\n`;
  report += `🔗 Some URLs may require browser authentication or have expired.\n`;
  report += `📅 Report generated on: ${new Date().toLocaleString()}\n`;

  // Save report to file
  const reportFilename = `${baseFolder}failed_downloads.txt`;
  const dataUrl = "data:text/plain;charset=utf-8," + encodeURIComponent(report);

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: reportFilename,
      conflictAction: "overwrite",
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error(`❌ Failed to save failure report: ${chrome.runtime.lastError.message}`);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log(`📋 Failure report saved: ${reportFilename}`);
        resolve(downloadId);
      }
    });
  });
}

// Keep existing helper functions unchanged
function makeExtHeaders() {
  const timestamp = Date.now().toString();
  const nonce = Math.random().toString(36).substr(2, 16);

  const originalData = `${chrome.runtime.id}|${timestamp}|${nonce}`;
  const step1Data = btoa(originalData);
  const reversedStep1 = step1Data.split('').reverse().join('');
  const step2Data = reversedStep1.replace(/./g, ch =>
    String.fromCharCode(ch.charCodeAt(0) + 3)
  );
  const payload = `${step2Data}__SENTINEL__${Number(timestamp).toString(36)}`;
  const extAuth = btoa(payload);

  return {
    'X-Extension-Auth': extAuth,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'Content-Type': 'application/json'
  };
}

async function generateCourseHTML(courseData, slug) {
  const headers = makeExtHeaders();
  const options = {
    includeAssets: true,
    includeVideos: false,
    includeSubtitles: true
  };

  try {
    const response = await fetch('https://www.forestily.com/api/generate-course-html', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        courseData: courseData,
        slug: slug,
        options: options
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result.htmlResult;
  } catch (error) {
    console.error('Failed to generate HTML:', error);
    throw error;
  }
}

async function downloadHTMLFile(htmlResult, slug) {
  return new Promise((resolve, reject) => {
    const htmlContent = htmlResult.html;
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(htmlContent);

    chrome.downloads.download({
      url: dataUrl,
      filename: `downloads/${slug}/${htmlResult.fileName}`,
      conflictAction: "overwrite",
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}
async function startDownload(slug, resolution, forceAssets) {
  try {
    // Start session
    SessionManager.start(slug);

    // Send start notification
    await TabComm.sendToAllCoursera({
      type: 'DOWNLOAD_STARTED',
      slug: slug
    });

    // Get CAUTH cookie
    const cauth = await getCauth();
    if (!cauth) {
      throw new Error('Please login to Coursera first');
    }

    // Extract course data
    await TabComm.sendToAllCoursera({
      type: 'DOWNLOAD_PROGRESS',
      slug: slug,
      status: 'Extracting course data...',
      completed: 0,
      total: 1
    });

    const courseData = await extractVideos(cauth, slug, resolution, forceAssets);

    if (!courseData || courseData.error) {
      throw new Error(courseData?.error || 'Failed to extract course data');
    }



    // Start terminal velocity download
    const result = await download_terminal_velocity(courseData);

    return result;

  } catch (error) {
    // Send error notification
    await TabComm.sendToAllCoursera({
      type: 'DOWNLOAD_ERROR',
      slug: slug,
      error: error.message
    });

    // End session
    SessionManager.end();

    throw error;
  }
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep response channel open
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'START_DOWNLOAD':
        if (SessionManager.isActive()) {
          sendResponse({
            success: false,
            error: `Download already active for: ${state.currentSlug}`
          });
          break;
        }

        startDownload(message.slug, message.resolution, message.forceAssets)
          .then(result => {
            // Download completed successfully in terminal velocity
          })
          .catch(error => {
            // Error already handled in startDownload
          });

        sendResponse({ success: true });
        break;

      case 'GET_DOWNLOAD_STATUS':
        sendResponse({
          active: SessionManager.isActive(),
          slug: state.currentSlug
        });
        break;

      case 'CANCEL_DOWNLOAD':
        if (SessionManager.isActive()) {
          SessionManager.end();

          await TabComm.sendToAllCoursera({
            type: 'DOWNLOAD_CANCELLED',
            slug: state.currentSlug
          });
        }

        sendResponse({ success: true });
        break;

      case 'GET_BUTTON_STATE':
        const buttonEnabled = await Storage.get('buttonEnabled') ?? true;
        sendResponse({ enabled: buttonEnabled });
        break;

      case 'TOGGLE_BUTTON':
        await Storage.set('buttonEnabled', message.enabled);

        await TabComm.sendToAllCoursera({
          type: 'BUTTON_TOGGLED',
          enabled: message.enabled
        });

        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const buttonEnabled = await Storage.get('buttonEnabled') ?? true;
  await Storage.set('buttonEnabled', buttonEnabled);
});

chrome.runtime.onStartup.addListener(() => {
  SessionManager.end();
});