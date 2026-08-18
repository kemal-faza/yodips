# Deploy package — Undip SSO Aggregator

Paket ini dirakit oleh `tools/deploy/assemble.sh` (build backend + web lalu
disalin ke sini). Panduan lengkap lihat `docs/DEPLOYMENT.md` (root repo).
`docs/` gitignored → salin panduan ini kalau dibutuhkan di server.

## Isi

| Path | Fungsi |
| --- | --- |
| `backend/` | NestJS dist + `package.json` + `Procfile` |
| `web/` | SPA `dist/` — diserve oleh Caddy/static host, BUKAN oleh Nest |
| `Caddyfile` | Reverse-proxy same-origin + HTTPS otomatis + SPA fallback |
| `Dockerfile` | Container backend (opsi VPS docker) |
| `env.production.example` | Template env (semua placeholder) |

## Opsi A — Heroku (Student Pack credit, $0)

```bash
# 1. env template → isi semua placeholder
cp env.production.example backend/.env
vi backend/.env

# 2. buat app + Redis add-on
heroku create undip-sso
heroku addons:create heroku-kvstore:mini

# 3. push backend (root package.json + Procfile harus di sini)
cd backend && git init
heroku buildpacks:set heroku/nodejs
git add -A && git commit -m deploy && git push heroku master

# 4. set env dari backend/.env (minus REDIS_URL → ambil dari add-on)
heroku config:set REDIS_URL="$(heroku config:get REDIS_URL)"

# 5. web → deploy ke static host (Cloudflare Pages/Netlify) pakai web/
#    lalu set backend CORS_ORIGIN ke URL static host. Note: web TIDAK diserve oleh Heroku.
```

## Opsi B — VPS same-origin (Caddy), rekomendasi

```bash
# 1. tempatkan web/ ke /srv/sso/web dan backend dist ke host
# 2. install Caddy, isi domain di Caddyfile, jalankan
sudo apt install caddy
sudo caddy run --config Caddyfile

# 3. jalankan backend (di belakang 127.0.0.1:3000)
cd backend && node dist/main.js   # atau via PM2/systemd / Dockerfile

# 4. env → cp env.production.example ke .env lalu jalankan
```

## Aturan penting sebelum go-live (dari docs/DEPLOYMENT.md)

- `MS_*` boleh dummy non-empty — jalur OIDC `/api/auth/microsoft/*` deprecated & tak dipakai
  login real (extension/mobile via handoff), jadi tidak perlu daftar Microsoft Entra.
- Redis localhost + password (VPS) / add-on (Heroku).
- `CDP_URL` dummy loopback → jalur capture deprecated nonaktif.
- Arahkan klien: web `VITE_API_BASE_URL`, extension `serverUrl`, mobile `BASE_URL`.
