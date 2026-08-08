import { DEFAULT_SERVER_URL } from '../core/urls.js';

const STORAGE_KEY = 'serverUrl';
const input = document.getElementById('serverUrl') as HTMLInputElement;
const phaseEl = document.getElementById('phaseValue') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;

chrome.storage.sync.get(STORAGE_KEY, (res) => {
  input.value = (res[STORAGE_KEY] as string) || DEFAULT_SERVER_URL;
});

function renderPhase() {
  chrome.storage.local.get('ssoLoginState', (res) => {
    const state = res['ssoLoginState'] as { phase?: string; deadline?: number; reloginCount?: number } | undefined;
    if (!state?.phase) {
      phaseEl.textContent = 'tidak aktif';
      return;
    }
    const remaining = Math.max(0, Math.round(((state.deadline ?? 0) - Date.now()) / 1000));
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
setInterval(renderPhase, 1000);