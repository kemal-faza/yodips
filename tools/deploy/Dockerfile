# Deploy package — backend container (opsi VPS docker).
# Build: backend harus sudah `npm run build` (dist/ ada) sebelum docker build.
#   cd deploy-artifacts/backend && docker build -t undip-sso-backend .
#   docker run -d -p 127.0.0.1:3000:3000 --env-file .env undip-sso-backend
FROM node:22-alpine
WORKDIR /app
# install deps produksi saja (tanpa dev/build)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# kode hasil build (sudah jadi) — ganti kalau struktur beda
COPY dist ./dist
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
