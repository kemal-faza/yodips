# Extension — Undip SSO Login (MV3)

Login SSO Undip tanpa kredensial: membaca cookie SSO/Kulon/SIAP dari browser user,
mengirimnya ke `POST /api/auth/session/handoff`, lalu menyerahkan JWT kembali ke
halaman web app. Menggantikan peran `tools/capture-client/` untuk produksi.

## Build & load (dev lokal)

1. `npm install` (untuk menjalankan test).
2. Buka `chrome://extensions` — aktifkan **Developer mode** — **Load unpacked** — pilih folder `extension/`.
3. Salin **ID extension** yang tampil, lalu isi ke `web/.env` sebagai `VITE_EXTENSION_ID`.
4. Pastikan backend (`localhost:3000`) dan web (`localhost:5173`) berjalan.

## Alur

- Buka web app — tombol **Login via Extension** muncul (jika extension terpasang).
- Klik sekali — extension membuka **satu tab** ke service yang cookie-nya belum ada
  (Kulon dulu, lalu SIAP di tab yang sama), redirect ke login Microsoft — user login/MFA.
  Jika session SSO masih valid, extension **melewati halaman SSO** (membukanya tak mengubah
  cookie → deadlock), langsung ke service yang basi.
- `chrome.cookies.onChanged` (didukung periodic poll ~30s sbg safety net) mendeteksi cookie
  dan memicu handoff otomatis — tab **ditutup otomatis** hanya setelah SSO+Kulon+SIAP
  terverifikasi valid oleh backend — JWT dikirim ke web app via content-script bridge —
  **masuk dashboard tanpa klik ulang**. Kalau ada layanan yang basi, hanya service itu
  yang dibuka ulang (bukan semua dari awal).
- Jika login belum selesai dalam 3 menit per service (atau ada langkah yang macet), extension
  mengirim pesan error dan menutup tab.

## Konfigurasi

- **Server API:** popup extension (ikon toolbar) — field *Server API* (default `http://localhost:3000`),
  disimpan di `chrome.storage.sync`.
- **Domain web app yang boleh kirim pesan & menerima hasil:** `externally_connectable.matches` +
  `content_scripts.matches` di `manifest.json`. Tambahkan origin web app produksi di kedua tempat saat deploy.

## Test

```bash
npm test
```

## Verifikasi manual E2E (lakukan setelah setup)

### Skenario A — sudah login Kulon di browser

1. `cd backend && npm run start:dev` (atau `npm run build && npm run start:prod`).
2. `cd web && npm run dev` — buka `http://localhost:5173`.
3. Di browser, login ke `https://kulon2.undip.ac.id` di tab terpisah (cookie tersimpan).
4. Kembali ke `http://localhost:5173` — refresh — klik **Login via Extension**.
5. **Expected:** dashboard tampil dengan data Kulon; JWT tersimpan; `/me` `complete:true`.

### Skenario B — cookie Kulon belum ada

1. Logout/clear cookie Kulon di browser.
2. Buka `http://localhost:5173` — klik **Login via Extension**.
3. **Expected:** satu tab terbuka ke Kulon → redirect login Microsoft; web app tampil notice "Menunggu login di tab".
4. Login Microsoft di tab itu — tab beralih/tertutup otomatis — **dashboard tampil tanpa klik ulang**.

### Skenario C — popup config server

Klik ikon extension — ubah Server API — Simpan — reload halaman web app — login via extension
tetap bekerja (POST `/api/auth/session/handoff` ke server yang dipilih, verifikasi via network tab).

## Keamanan

- Tidak pernah menerima/menyimpan kredensial; cookie dibaca & dikirim langsung ke backend.
- `host_permissions` dibatasi ke domain akademik (`*://*.undip.ac.id/*`) + backend dev, bukan `<all_urls>`.
- Token tidak pernah lewat URL — dikirim ke web app lewat `postMessage` dari content-script bridge.
- `externally_connectable` (SPA→extension) dan tag `source: 'undip-sso-extension'` (extension→SPA)
  membatasi siapa yang bisa memicu/menerima hasil handoff.
