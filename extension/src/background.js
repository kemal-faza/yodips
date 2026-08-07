// MV3 service worker. Satu-satunya pintu handoff: membaca cookie (chrome.cookies),
// menyimpan serverUrl (chrome.storage.sync), membuka tab login, dan POST handoff
// (fetch di background = bebas CORS). Logika inti ada di messages.js (testable).
import { handleHandoffMessage, DEFAULT_SERVER_URL, buildKulonTicketUrl } from './messages.js';

const STORAGE_KEY = 'serverUrl';

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleHandoffMessage(message, {
    getCookies: () => chrome.cookies.getAll({}),
    getServerUrl: async () => {
      const { [STORAGE_KEY]: url } = await chrome.storage.sync.get(STORAGE_KEY);
      return url || DEFAULT_SERVER_URL;
    },
    openTab: (url) => chrome.tabs.create({ url }),
    fetchHandoff: async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, ...data };
    },
    // Membuka service URL Kulon (redirect ke login Microsoft OIDC), bukan root
    // SSO: cookie Kulon baru terbentuk setelah browser menavigasi ke Kulon.
    ssologinUrl: buildKulonTicketUrl(),
  })
    .then(sendResponse)
    .catch((err) => sendResponse({ status: 'error', message: err.message ?? 'Error internal' }));
  return true; // keep the message channel open for the async response
});
