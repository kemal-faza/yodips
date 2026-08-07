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
- Klik — extension baca cookie — handoff — JWT dikirim balik ke halaman — dashboard.
- Jika cookie Kulon belum ada, extension membuka tab login SSO Undip — login — klik lagi.

## Konfigurasi

- **Server API:** popup extension (ikon toolbar) — field *Server API* (default `http://localhost:3000`),
  disimpan di `chrome.storage.sync`.
- **Domain yang boleh kirim pesan:** `externally_connectable.matches` di `manifest.json`.
  Tambahkan origin web app produksi di sini saat deploy.

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
3. **Expected:** tab baru ke `sso.undip.ac.id` terbuka; web app tampil notice "Login dulu di tab".
4. Login SSO — Kulon di tab itu — klik lagi **Login via Extension** — dashboard tampil.

### Skenario C — popup config server

Klik ikon extension — ubah Server API — Simpan — reload halaman web app — login via extension
tetap bekerja (POST `/api/auth/session/handoff` ke server yang dipilih, verifikasi via network tab).

## Keamanan

- Tidak pernah menerima/menyimpan kredensial; cookie dibaca & dikirim langsung ke backend.
- `host_permissions` minimal (4 domain akademik), bukan `<all_urls>`.
- Token tidak pernah lewat URL — dikirim balik lewat response `sendMessage`.
- `externally_connectable` membatasi origin yang bisa memicu handoff.
