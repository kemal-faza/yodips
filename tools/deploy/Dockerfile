# Deploy package — backend container (opsi VPS docker).
# Build: backend harus sudah `npm run build` (dist/ ada) sebelum docker build.
#   cd deploy-artifacts/backend && docker build -t undip-sso-backend .
# Run hardened (YD-INFRA-001) — runtime-only flags, lihat README.md:
#   docker run -d --name undip-sso-backend -p 127.0.0.1:3000:3000 --env-file .env \
#     --read-only --tmpfs /tmp:size=64m --cap-drop ALL \
#     --security-opt no-new-privileges --pids-limit 256 \
#     undip-sso-backend
FROM node:22-alpine
WORKDIR /app

# install deps produksi saja (tanpa dev/build).
# CATATAN: npm ci WAJIB jalan sebagai root (butuh tulis /app + node_modules);
# filesystem di-chown ke node SETELAH install, lalu USER node untuk runtime.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R node:node /app

# kode hasil build (sudah jadi) — chown supaya terbaca user node.
COPY --chown=node:node dist ./dist

ENV NODE_ENV=production
# Jalankan sebagai non-root (uid 1000). Rootfs boleh read-only saat runtime:
# backend tidak menulis selain /tmp (tmpfs). Lihat README.md utk flags runtime.
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
