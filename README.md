# YoDips

One sign-in for all of your Undip accounts. SSO, Kulon, and SIAP share a single door but split your data across three places, and none of them offer an API. YoDips takes your session once and turns everything into one dashboard and one REST API: Kulon assignments, SIAP grades and IRS, class schedules, even QR attendance scanning.

| Part | Stack | What it does |
| --- | --- | --- |
| [`backend/`](backend) | NestJS + TypeScript | Core API: sign-in, Kulon/SIAP aggregation, encrypted sessions, push notifications |
| [`web/`](web) | Vue 3 + Vite + Tailwind + shadcn-vue | Web dashboard: GPA, academic charts, tasks, schedule, profile, notifications |
| [`mobile/`](mobile) | Kotlin + Jetpack Compose | Android app: everything the web has, plus QR attendance scanning |
| [`extension/`](extension) | Chrome/Edge MV3 (TypeScript) | The main way to sign in from a browser |

## Contents

- [Use it without building](#use-it-without-building)
  - [Supported browsers](#supported-browsers)
- [How to sign in](#how-to-sign-in)
  - [On the web](#on-the-web)
  - [On Android](#on-android)
- [Developing locally](#developing-locally)
  - [Environment](#environment)
  - [Architecture notes](#architecture-notes)
- [API overview](#api-overview)
- [Deployment](#deployment)
- [Releasing](#releasing)
- [Security notes](#security-notes)

## Use it without building

No build steps needed if you just want to use it:

- **Web**: [sso.crunchy.my.id](https://sso.crunchy.my.id)
- **Browser extension**: [YoDips on the Chrome Web Store](https://chromewebstore.google.com/detail/eamfeldmafelalbkflomdjlfgfmifgic)
- **Android**: grab the APK from [GitHub Releases](https://github.com/kemal-faza/yodips/releases). Install guide in [`INSTALL.md`](INSTALL.md)

### Supported browsers

The extension targets Chromium (Manifest V3), so besides Chrome it installs straight from that link on Edge, Brave, Opera, Vivaldi, and other Chromium browsers. On Edge, first turn on **Allow extensions from other stores** in `edge://extensions`. An official Edge Add-ons listing is planned; Firefox is not supported yet because its extension platform works differently.

## How to sign in

One rule across every device: your password stays between you and Undip. You sign in yourself, on your own device, and YoDips only reuses the session that already exists. It never asks for or stores your credentials.

### On the web

1. Install the [YoDips extension](https://chromewebstore.google.com/detail/eamfeldmafelalbkflomdjlfgfmifgic).
2. Open [sso.crunchy.my.id](https://sso.crunchy.my.id) and click **Login via Extension**.
3. Sign in with your Undip account in the tab that opens. This is the regular SSO page, including MFA when prompted.
4. That's it. Kulon and SIAP connect on their own, the tab closes, and your dashboard appears.

If a session expires later, the app quietly restores it the same way. No need to click anything.

### On Android

1. Install the app from [Releases](https://github.com/kemal-faza/yodips/releases).
2. Open it and sign in once on the SSO screen inside the app.
3. Done. Kulon and SIAP connect automatically and your dashboard appears.

Notifications for new assignments and schedule changes arrive through Firebase after you sign in.

## Developing locally

Each subproject stands alone; there is no root task runner.

```bash
# backend (NestJS) — http://localhost:3000
cd backend && npm install && npm run start:dev

# web (Vue 3) — http://localhost:5173
cd web && npm install && npm run dev

# extension (MV3 TS) — builds into dist/, load it unpacked at chrome://extensions
cd extension && npm install && npm run dev
```

Mobile (Kotlin): open `mobile/` in Android Studio, or `cd mobile && ./gradlew :app:testDebugUnitTest && ./gradlew assembleDebug`.

Verified test counts as of 2026-08-24: backend **331**, web **318**, extension **118**, mobile **139**.

### Environment

Copy the templates and fill in your secrets:

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

Backend variables that matter most:

| Variable | Meaning |
| --- | --- |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Token signing secret (`openssl rand -hex 32`) and lifetime. Never commit it |
| `CORS_ORIGIN` | Allowed frontend origins, comma-separated |
| `SESSION_BACKEND` | `memory` for dev/test, `redis` for production |
| `REDIS_URL` / `SESSION_ENC_KEY` / `SESSION_TTL_MS` | Required when `SESSION_BACKEND=redis`; sessions are AES-256-GCM encrypted |
| `CACHE_TTL_MS` | TTL for upstream scrape cache (default 5 minutes) |
| `NOTIFICATIONS_ENABLED` / `FIREBASE_SERVICE_ACCOUNT_JSON` | FCM push notifications (production) |
| `MS_*`, `CHROME_PATH` / `CHROME_PROFILE_DIR`, `CDP_URL` | Deprecated legacy login paths; dummies are fine in production |

On the web side, `VITE_API_BASE_URL` points at the backend and `VITE_EXTENSION_ID` bakes in the extension ID used for SPA-extension detection.

### Architecture notes

- Per-user sessions sit behind a small `SessionStore` interface: in-memory for dev, encrypted Redis for production. Restarting the backend while on `memory` logs everyone out.
- Upstream scrape results are cached per user (Redis in production) so pages don't repeat expensive scrapes.
- Kulon/SIAP HTML and JSON parsers live in pure modules (`kulon-parse.ts`, `siap-parse.ts`) with no fetch dependencies, which keeps them easy to test.
- The extension separates its state machine (pure TS in `extension/src/core/`) from the thin `chrome.*` adapter in `background.ts`.

## API overview

All routes live under `/api`. Everything except the endpoints noted below requires an `Authorization: Bearer <JWT>` header.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/session/handoff` | Accept captured cookies, issue a JWT (no JWT guard by design, rate-limited) |
| `POST` | `/auth/refresh` | Rotate the JWT |
| `GET` | `/auth/me` | Identity + validity of the SSO/Kulon/SIAP sessions |
| `GET` | `/kulon/courses` | Kulon courses with lecturer names merged in from SIAP |
| `GET` | `/kulon/assignments/all` | Every assignment and quiz, completed ones included |
| `GET` | `/kulon/assignments/:id/detail` | One assignment's details |
| `GET` | `/kulon/courses/:id/content` | A course's materials |
| `GET` | `/siap/profile` · `/irs` · `/khs` | Profile, IRS, KHS (GPA read straight from the official KHS footer) |
| `GET` | `/siap/jadwal` · `/absen` · `/kehadiran/:id` | Class meetings, attendance summary, per-meeting history |
| `POST` | `/siap/kehadiran` | Proxy a scanned attendance QR to SIAP |
| `GET` | `/siap/lecturers` · `/notifications` | Lecturers per course code; SIAP notifications |
| `POST` | `/siap/notifications/:id/unread` | Mark a notification unread |
| `POST` | `/notifications/device` | Register a device's FCM token |

`POST /auth/sso/capture` and `GET /auth/microsoft/*` still exist but are deprecated, dev/test only.

## Deployment

Production runs the backend on Heroku and the web app on Vercel. A push to `main` that passes CI deploys both automatically through `.github/workflows/deploy-backend.yml` and `deploy-web.yml`. Production requires `SESSION_BACKEND=redis` with `REDIS_URL` + `SESSION_ENC_KEY`, and the custom domain must be registered on Heroku so requests don't die at Cloudflare with a 520. Runbooks live in `tools/deploy/`.

## Releasing

- **Extension**: `cd extension && npm run release <patch|minor|major>` bumps the version, builds, tests, and produces the zip for upload to the Chrome Web Store (and Edge Add-ons). Keep icons 16/32/48/128 in the zip; the store rejects submissions without them.
- **Mobile**: `node mobile/scripts/bump.mjs <X.Y.Z>` bumps `versionCode`/`versionName`.
- **Automatic**: pushing a `v*` tag runs `.github/workflows/release.yml`, which publishes a GitHub Release containing the signed APK, the extension zip, and `SHA256SUMS.txt`.

## Security notes

Your password never reaches the backend. Identity is always derived from the verified Kulon session, never from anything a client claims. JWTs carry server-side session references, not raw cookies. CORS allowlist, helmet, global ValidationPipe, OIDC `state` CSRF protection, and gitleaks/semgrep/npm-audit/trivy gates run in CI. Sessions are encrypted at rest when Redis backs them.
