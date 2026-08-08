# Extension — Undip SSO Login (MV3)

Login SSO Undip tanpa kredensial: membaca cookie SSO/Kulon/SIAP dari browser user,
mengirimnya ke `POST /api/auth/session/handoff`, lalu menyerahkan JWT kembali ke
halaman web app. Menggantikan peran `tools/capture-client/` untuk produksi.

## Build & load (dev lokal)

1. `npm install` (untuk menjalankan test).
2. Buka `chrome://extensions` — aktifkan **Developer mode** — **Load unpacked** — pilih folder `extension/`.
3. Salin **ID extension** yang tampil, lalu isi ke `web/.env` sebagai `VITE_EXTENSION_ID`.
4. Pastikan backend (`localhost:3000`) dan web (`localhost:5173`) berjalan.

> Jika web dibuka lewat `http://127.0.0.1:5173`, manifest juga sudah mengizinkan origin
> tersebut. Setelah mengubah manifest atau `.env`, reload extension di `chrome://extensions`
> dan restart Vite agar ID baru ikut masuk ke bundle.

## Alur

- Buka web app — tombol **Login via Extension** muncul (jika extension terpasang).
- Klik sekali — extension membuka **satu tab** ke service yang cookie-nya belum ada
  (Kulon dulu, lalu SIAP di tab yang sama), redirect ke login Microsoft — user login/MFA.
  Jika session SSO masih valid, extension **melewati halaman SSO** (membukanya tak mengubah
  cookie → deadlock), langsung ke service yang basi.
- Auto-cascade maju dengan **`chrome.cookies.onChanged` + `tabs.onUpdated` + poll ~30s** sebagai
  safety-net — begitu cookie satu service terdeteksi, tab langsung dinavigasi ke service berikutnya
  (Kulon → SIAP → handoff), tanpa perlu klik apa pun di aplikasi.
- Hasil handoff dikirim ke web app lewat **3 kanal** (direct tab message ke content bridge + broadcast
  + cache `storage.session`), dan web app **mem-poll hasil tiap 3 detik** saat menunggu — jadi JWT
  selalu sampai & kamu **masuk dashboard tanpa klik ulang**, bahkan jika pesan push terlewat.
  Tab login **ditutup otomatis** setelah SSO+Kulon+SIAP terverifikasi valid oleh backend, dan
  **tab aplikasi difokuskan kembali**. Kalau ada layanan yang basi, hanya service itu yang dibuka ulang.
- Indikator fase login aktif bisa dilihat di **popup extension** (ikon toolbar) untuk debugging.
- Jika login belum selesai dalam 3 menit per service (atau ada langkah yang macet), extension
  mengirim pesan error dan menutup tab.

### Logout & login ulang

- **"Keluar" di aplikasi** kini melakukan *full logout*: menghapus JWT (`localStorage.sso_token`)
  **dan** (melalui extension) membersihkan cookie sesi `ci_session_sso` (SSO), `MoodleSession*`
  (Kulon), dan `sia_app_session` (SIAP). Jadi login berikutnya **tidak bisa fast-path-reuse** sesi
  lama dan **dipaksa membuka tab login baru**.
- Extension menjamin **hanya satu tab login** per flow: listener `tabs.onUpdated` di-gate ke tab
  yang diorkestrasi, `startLogin`/`processCookies` diserialisasi via lock global, dan semua tab yang
  dibuat selama flow (termasuk pivot relogin) ditutup otomatis saat selesai/fail — tidak ada tab menumpuk.

## Konfigurasi

- **Server API:** popup extension (ikon toolbar) — field *Server API* (default `http://localhost:3000`),
  disimpan di `chrome.storage.sync`.
- **Domain web app yang boleh kirim pesan & menerima hasil:** `externally_connectable.matches` +
  `content_scripts.matches` di `manifest.json`. Tambahkan origin web app produksi di kedua tempat saat deploy.

## Test

```bash
npm test
```

Jika tombol yang tampil adalah **Login via SSO**, extension tidak terdeteksi. Periksa
`VITE_EXTENSION_ID` terhadap ID aktual di `chrome://extensions`, origin web (`localhost`
vs `127.0.0.1`), lalu buka Console service worker extension untuk melihat log aman seperti
`external action`, `handoff decision`, dan `login tab opened`. Log tersebut tidak mencetak
cookie atau JWT.

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
