import { DEFAULT_SERVER_URL } from '../messages.js';

const STORAGE_KEY = 'serverUrl';
const STATE_KEY = 'ssoLoginState';
const input = document.getElementById('serverUrl');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');
const phaseEl = document.getElementById('phaseValue');

chrome.storage.sync.get(STORAGE_KEY, (res) => {
  input.value = res[STORAGE_KEY] || DEFAULT_SERVER_URL;
});

/** Render the current login phase (debug/observability aid). */
function renderPhase() {
  chrome.storage.local.get(STATE_KEY, (res) => {
    const state = res[STATE_KEY];
    if (!state?.phase) {
      phaseEl.textContent = 'tidak aktif';
      return;
    }
    const remaining = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
    phaseEl.textContent = `${state.phase}${state.reloginCount ? ` (relogin ${state.reloginCount})` : ''} · sisa ${remaining}s`;
  });
}

saveBtn.addEventListener('click', () => {
  const url = input.value.trim();
  chrome.storage.sync.set({ [STORAGE_KEY]: url || DEFAULT_SERVER_URL }, () => {
    statusEl.textContent = 'Tersimpan.';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});

renderPhase();
// Refresh while the popup stays open (login can take a while).
setInterval(renderPhase, 1000);
