#!/usr/bin/env bash
#
# assemble.sh — build backend + web dan rakit paket deploy siap-upload.
#
# Output di <repo>/deploy-artifacts/:
#   backend/        NestJS dist + package.json + Procfile (untuk Heroku/docker)
#   web/            SPA dist/ (diserve oleh Caddy/static host, bukan oleh Nest)
#   Caddyfile       template reverse-proxy same-origin (VPS)
#   Dockerfile      container backend (opsi VPS docker)
#   env.production.example   template env (placeholder, AMAN di-commit)
#   README.md       ringkasan langkah deploy
#
# Cara pakai:
#   ./tools/deploy/assemble.sh                       # pakai VITE_API_BASE_URL default same-origin
#   VITE_API_BASE_URL=https://api.example.com ./tools/deploy/assemble.sh
#
# CATATAN: Monorepo TS — tidak ada root package.json. Script ini build tiap
# subproyek secara independen (sesuai konvensi AGENTS.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/deploy-artifacts"
BACKEND_SRC="$ROOT/backend"
WEB_SRC="$ROOT/web"

VITE_API_BASE_URL="${VITE_API_BASE_URL:-/}" # same-origin default → SPA panggil /api/*

log() { printf '\033[1;34m[assemble]\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m[assemble]\033[0m ERROR: %s\n' "$*" >&2
  exit 1
}

command -v npm >/dev/null || fail "npm tidak ditemukan"

# ---- Bersihkan output lama
rm -rf "$OUT"
mkdir -p "$OUT/backend" "$OUT/web"

# ---- Build backend
log "membangun backend ..."
(cd "$BACKEND_SRC" && npm run build) || fail "backend build gagal"
[ -f "$BACKEND_SRC/dist/main.js" ] || fail "dist/main.js tidak ada (backend build tidak menghasilkan)??"
cp -r "$BACKEND_SRC/dist" "$OUT/backend/dist"
cp "$BACKEND_SRC/package.json" "$BACKEND_SRC/package-lock.json" "$OUT/backend/"

# Hapus script `build` dari package.json deploy: dist sudah di-compile, dan
# Heroku node buildpack otomatis menjalankan `npm run build` (=`nest build`)
# yang butuh src/ + @nestjs/cli (tidak dikirim). `scripts` tidak masuk lockfile,
# maka package-lock tetap sinkron.
(cd "$OUT/backend" && node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  delete p.scripts?.build;
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
')

# ---- Build web
log "membangun web (VITE_API_BASE_URL=${VITE_API_BASE_URL}) ..."
(cd "$WEB_SRC" && VITE_API_BASE_URL="$VITE_API_BASE_URL" npm run build) || fail "web build gagal"
[ -f "$WEB_SRC/dist/index.html" ] || fail "web/dist/index.html tidak ada"
cp -r "$WEB_SRC/dist/." "$OUT/web/"

# ---- Template & Procfile (diriwayat dari tools/deploy)
cp "$ROOT/tools/deploy/Procfile" "$OUT/backend/Procfile"
cp "$ROOT/tools/deploy/Caddyfile" "$OUT/Caddyfile"
cp "$ROOT/tools/deploy/Dockerfile" "$OUT/Dockerfile"
cp "$ROOT/tools/deploy/env.production.example" "$OUT/env.production.example"
cp "$ROOT/tools/deploy/README.md" "$OUT/README.md"

log "SELESAI → paket deploy di: $OUT"
log "  - Heroku:  cd deploy-artifacts/backend && git init && git add -A && heroku buildpacks:set heroku/nodejs && git push"
log "  - VPS/Caddy: ikuti deploy-artifacts/README.md"
