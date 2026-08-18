# Deploy Automation — Undip SSO Aggregator

Auto-deploy via GitHub Actions: **push ke `main` → CI lolos → deploy backend ke
Heroku + web ke Vercel secara otomatis.**

Anak-anak file:

- `.github/workflows/ci.yaml`            (sudah ada — test/build/security)
- `.github/workflows/deploy-backend.yml` (baru — Heroku)
- `.github/workflows/deploy-web.yml`     (baru — Vercel)

## Cara kerja

1. Push ke `main` (atau PR → merge) memicu workflow `CI`.
2. Kedua workflow deploy menggunakan **`workflow_run`**: mereka hanya jalan
   setelah run `CI` selesai dengan konklusi `success`. Jadi kode gagal test
   / build **tidak akan ter-deploy**.
3. Setiap workflow bisa juga di-trigger **manual** dari tab Actions →
   "Run workflow" (pakai branch `main`).

## 0. Persyaratan dasar

- Repo terdaftar di GitHub (origin sudah `kemal-faza/sso`).
- App Heroku sudah ada (di CHECKPOINT: `sso-undip`), dan project Vercel sudah
  ada (domain `sso.crunchy.my.id`).

## 1. Set GitHub Secrets

Buka **Settings → Secrets and variables → Actions** di repo, lalu tambah:

| Secret | Untuk | Nilai |
| --- | --- | --- |
| `HEROKU_API_KEY` | backend | `heroku authorizations:create` → pakai tokennya |
| `HEROKU_APP_NAME` | backend | nama app, mis. `sso-undip` |
| `VERCEL_TOKEN` | web | dashboard Vercel → Account Settings → Tokens → Create |
| `VERCEL_ORG_ID` | web | lihat §2 |
| `VERCEL_PROJECT_ID` | web | lihat §2 |
| `VITE_API_BASE_URL` | web | base URL API produksi, mis. `https://backend.crunchy.my.id` (**jangan `/`**) |

> `VITE_API_BASE_URL` adalah secret build-time: dipakai CLI untuk `vercel build`
> sehingga SPA menunjuk ke API yang benar. Ini penting — tanpa ini, build Vercel
> default ke `http://localhost:3000` dan produksi rusak.

## 2. Ambil VERCEL_ORG_ID & VERCEL_PROJECT_ID (sekali saja, lokal)

```bash
cd web
npx vercel link        # login + pilih project sso
cat web/.vercel/project.json   # → {"orgId": "...", "projectId": "..."}
```

Salin kedua nilai itu ke secret repo. (Wajib karena `web/.vercel/` di-ignore git,
workflow membuat file itu sendiri setiap deploy.)

## 3. (Opsional) Verifikasi Heroku API key

```bash
HEROKU_API_KEY=<token> heroku apps:info -a sso-undip   # kalau bisa, token valid
```

## 4. Deploy pertama

1. Set semua secret (bagian 1 & 2) commit dulu perubahan workflow.
2. Push ke `main`.
3. Tab **Actions** → tunggu `CI` hijau → lalu `Deploy Backend (Heroku)` dan
   `Deploy Web (Vercel)` otomatis jalan.
4. Cek:
   - Heroku: `heroku logs --tail -a sso-undip`
   - Vercel: dashboard project sso → Deployments.
   - `GET https://backend.crunchy.my.id/api/auth/me` → 403 (tanpa login = normal).
   - Buka `https://sso.crunchy.my.id`.

## Catatan

- **Extension tidak di-cover deploy ini.** Extension (MV3) di-build manual
  (`cd extension && npm run build`) lalu di-reload di `chrome://extensions`.
- **Mengapa bukan Vercel Git Integration?** Bisa juga: aktifkan di dashboard
  Vercel dengan Root Directory = `web`, lalu matikan workflow `deploy-web.yml`
  kalau tidak mau dobel. Workflow CLI di sini konsisten + bisa dipicu manual.
- `assemble.sh` build `deploy-artifacts/` (gitignored) tiap run; aman.
- Ganti app name / domain sesuai environment kamu.
