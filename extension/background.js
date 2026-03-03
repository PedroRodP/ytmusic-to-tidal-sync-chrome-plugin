const DEBUG = false;

function logDebug(...args) {
  if (DEBUG) {
    console.log('[ytm-tidal-sync:bg]', ...args);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  logDebug('Extension installed.');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ ok: false, error: 'INVALID_MESSAGE' });
    return false;
  }

  if (message.type === 'OPEN_OAUTH_FLOW') {
    const { url, interactive = true } = message.payload || {};

    if (!url || typeof url !== 'string') {
      sendResponse({ ok: false, error: 'INVALID_OAUTH_URL' });
      return false;
    }

    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message || 'OAUTH_FLOW_FAILED'
        });
        return;
      }

      sendResponse({ ok: true, redirectUrl: redirectUrl || null });
    });

    return true;
  }

  if (message.type === 'GET_REDIRECT_URI') {
    sendResponse({ ok: true, redirectUri: chrome.identity.getRedirectURL() });
    return false;
  }

  sendResponse({ ok: false, error: 'UNSUPPORTED_MESSAGE_TYPE' });
  return false;
});
