// Content script injected into the web app (SPA). Forwards background
// `handoff-result` messages to the page's window so the SPA reacts without
// a long-lived runtime messaging channel (which breaks when the MV3 service
// worker suspends during a slow login).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === 'handoff-result') {
    // Target ONLY same-origin windows: the content script runs inside the web
    // app's page, so posting to window.location.origin means a cross-origin
    // subframe/third-party page cannot eavesdrop on the JWT in the payload.
    window.postMessage({ source: 'undip-sso-extension', payload: msg }, window.location.origin);
    sendResponse({ ok: true });
  }
});