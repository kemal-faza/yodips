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

# 4b. WAJIB (YD-RATE-001) — set selektor topologi trust-proxy:
#     TRUST_PROXY_HOPS=2 untuk prod Heroku (Cloudflare + Heroku router di depan
#     dyno). Nilai ini TIDAK di-map ke hop-count numerik mentah: lihat
#     src/http/trust-proxy.ts — hop hanya dipercaya kalau alamat socket/XFF
#     masuk grup CIDR terverifikasi (lokal/privat + seluruh range Cloudflare
#     resmi; fail-closed terhadap peer publik non-CF & XFF spoof).
#     Topologi saat ini DIINFERENSIKAN (2026-09-04) dari DNS→IP Cloudflare +
#     header respons `server: cloudflare`/`cf-ray` — bukan klaim verifikasi
#     internal; kebenaran di-acceptance via perilaku bucket XFF spoof setelah
#     deploy. Caddy VPS same-origin cukup TRUST_PROXY_HOPS=1.
heroku config:set TRUST_PROXY_HOPS=2 --app undip-sso
heroku restart --app undip-sso

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

# 3b. jalankan backend via container (HARDENED — YD-INFRA-001; runtime-only flags):
#     Runtime-only controls TIDAK bisa diekspresikan di Dockerfile — ini command
#     resmi yang di-repo (rootfs read-only, tmpfs /tmp, cap-drop ALL,
#     no-new-privileges, pids-limit). Dockerfile sudah `USER node` (non-root).
podman run -d --name undip-sso-backend -p 127.0.0.1:3000:3000 --env-file .env \
  --read-only \
  --tmpfs /tmp:size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  undip-sso-backend
# (docker: ganti `podman` → `docker`; command lain identik.)

# Catatan hardening:
# - USER node: proses berjalan uid 1000, bukan root (sebelumnya root).
# - --read-only: rootfs tidak bisa ditulis; /tmp satu-satunya tmpfs (backend
#   hanya menulis /tmp saat runtime; session/cache di Redis/in-memory).
# - --cap-drop ALL + no-new-privileges: tanpa capability tambahan.
# - Bila CHROME_PROFILE_DIR diarahkan ke path lain (bukan /tmp), mount tmpfs
#   atau volume di path itu.
# - Healthcheck dari host: curl http://127.0.0.1:3000/ (jangan dari dalam
#   container yang tak punya curl/tooling).
# - WAJIB (YD-RATE-001): set TRUST_PROXY_HOPS=1 di .env — backend DI BELAKANG
#   Caddy (satu proxy lokal/loopback; policy = trust grup lokal/privat saja).
#   Tanpa ini default 0 (fail-safe) → throttling key socket 127.0.0.1 (semua
#   client satu bucket). Nilai 2 hanya utk topologi Cloudflare→Heroku (menambah
#   range CIDR Cloudflare resmi — lihat catatan MAINTENANCE di bawah); jangan
#   pernah set `true`/hop-count numerik.

# 4. env → cp env.production.example ke .env lalu jalankan
```

## Aturan penting sebelum go-live (dari docs/DEPLOYMENT.md)

- `TRUST_PROXY_HOPS` (YD-RATE-001) per topologi — lihat `env.production.example`:
  **Heroku prod `backend.crunchy.my.id` = `2`** (lokal/privat + range Cloudflare
  resmi; topologi di-infer 2026-09-04 dari DNS→CF IP + `server: cloudflare`/
  `cf-ray`, kebenaran di-acceptance via perilaku spoofed-XFF bucket setelah
  deploy), **VPS Caddy = `1`** (satu proxy lokal/privat), direct = `0`/unset
  (default fail-safe). Arti CIDR-aware: `trust proxy` TIDAK pernah hop-count
  numerik — tiap hop dipercaya hanya jika alamatnya masuk grup CIDR terverifikasi
  (`loopback`/`linklocal`/`uniquelocal`, dan range Cloudflare utk nilai 2);
  peer publik non-CF / XFF spoof tidak pernah dipercaya. MAINTENANCE: range
  Cloudflare di-pin di `src/http/trust-proxy.ts` (dengan tanggal sumber);
  re-fetch `https://www.cloudflare.com/ips-v4` & `/ips-v6` saat CF merilis
  perubahan.
- `MS_*` boleh dummy non-empty — jalur OIDC `/api/auth/microsoft/*` deprecated & tak dipakai
  login real (extension/mobile via handoff), jadi tidak perlu daftar Microsoft Entra.
- Redis localhost + password (VPS) / add-on (Heroku).
- `CDP_URL` dummy loopback → jalur capture deprecated nonaktif.
- Arahkan klien: web `VITE_API_BASE_URL`, extension `serverUrl`, mobile `BASE_URL`.
