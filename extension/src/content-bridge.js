// Content script injected into the web app (SPA) page. It hears background
// messages (`handoff-result`) and forwards them to the page's window so the SPA
// can react without keeping a long-lived chrome.runtime messaging channel open
// (which would break when the MV3 service worker is suspended during a slow login).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === 'handoff-result') {
    window.postMessage({ source: 'undip-sso-extension', payload: msg }, '*');
    sendResponse({ ok: true });
  }
});
