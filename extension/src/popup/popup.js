import { DEFAULT_SERVER_URL } from '../messages.js';

const STORAGE_KEY = 'serverUrl';
const input = document.getElementById('serverUrl');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');

chrome.storage.sync.get(STORAGE_KEY, (res) => {
  input.value = res[STORAGE_KEY] || DEFAULT_SERVER_URL;
});

saveBtn.addEventListener('click', () => {
  const url = input.value.trim();
  chrome.storage.sync.set({ [STORAGE_KEY]: url || DEFAULT_SERVER_URL }, () => {
    statusEl.textContent = 'Tersimpan.';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});
