# SSO

A small aggregator for Universitas Diponegoro's single sign‑on. Instead of hopping between SSO, Kulon, and SIAP every time you need something, this sits in the middle: sign in once, and it holds your session and hands the apps on top a clean REST API.

Three pieces work together:

- **`backend/`** — NestJS + TypeScript API. Owns the sign‑in logic and turns Undip's web‑only services into simple endpoints.
- **`web/`** — Vue 3 + Vite single‑page app. The face you talk to: dashboard, Kulon courses, akademik profile.
- **`mobile/`** — Kotlin (Jetpack Compose), wired to the same API. Planned; the directory is scaffolding for now.
- **`extension/`** — a Chrome/Edge MV3 extension. The recommended way to log in (details below).

---

## Why does this exist?

Most of Undip's services authenticate against SSO but expose no public API. To read your grades on SIAP or pull your Kulon assignments programmatically, you would scrape pages by hand or log in everywhere.

This project centralizes that. Sign in **once** in your own browser, and every downstream service reuses that single session. Anything you build on top, a schedule widget, a grade tracker, a personal portal, just calls ordinary REST endpoints instead of fighting browser sessions.

## How sign‑in works

Your password never reaches the backend. All three services use httpOnly cookies bound to their own domains, and SSO has MFA, so there is no credential API to call. Instead you log in manually in your own browser, the session is captured where the cookies live, and the backend only ever sees cookies that are already valid.

There are two ways in:

1. **Browser extension (recommended).** The MV3 extension reads the SSO, Kulon, and SIAP cookies straight from your everyday browser via `chrome.cookies`. It opens a single tab to any missing service (Kulon first, then SIAP), waits for the login to finish, closes the tab, and sends the captured session to `POST /api/auth/session/handoff`. The backend verifies the Kulon session, derives your identity (your NIM), and returns a JWT that comes back to the web app. When the extension is installed, the web app hides the older login button.
2. **Interactive login (deprecated fallback).** For development and testing only. The backend opens a *visible* browser window through Playwright so you can log in yourself, then captures the session. It always uses an isolated fresh profile (`CHROME_PROFILE_DIR`), never your private browser. This path is superseded by the extension.

Microsoft/Entra is a separate case since Kulon uses Microsoft OIDC rather than the YoDips page, so it gets its own callback flow: `/api/auth/microsoft/login` → `/api/auth/microsoft/callback`.

## What you get

The web dashboard brings the data together on one page:

- Your IPK, cumulative SKS (against the 144‑SKS target), and semester SKS at a glance.
- IP trend, grade distribution, and SKS accumulation charts.
- Your daily/weekly schedule (from the IRS) and a live task list for Kulon assignments with the closest deadlines.
- A notifications popover, an akademik profile page, and a Kulon section for your courses and assignment details.

On the backend side, that data is just ordinary endpoints.

## The API surface

All routes live under `/api`.

| Method | Path | What it's for |
| --- | --- | --- |
| `POST` | `/auth/login` | Manual credentials login (legacy, dev only) |
| `POST` | `/auth/sso/capture` | Browser‑automation capture (deprecated) |
| `GET` | `/auth/microsoft/login` | Start Microsoft/Entra OIDC for Kulon |
| `GET` | `/auth/microsoft/callback` | OIDC redirect target |
| `POST` | `/auth/session/handoff` | Accept a captured session and issue a JWT |
| `GET` | `/auth/me` | Current user from your token (also a validity probe) |
| `GET` | `/kulon/courses` | Courses from Kulon, with lecturer names merged in |
| `GET` | `/kulon/assignments` · `/all` | Assignments, grouped or flat |
| `GET` | `/kulon/assignments/:id/detail` | One assignment's details |
| `GET` | `/kulon/courses/:id/content` | A course's content |
| `GET` | `/siap/profile` | Your SIAP profile |
| `GET` | `/siap/irs` | IRS (study‑plan) records |
| `GET` | `/siap/khs` | KHS (grades) records |
| `GET` | `/siap/lecturers` | Lecturer names per study‑plan code |
| `GET` | `/siap/notifications` | SIAP notifications |
| `POST` | `/siap/notifications/:id/unread` | Mark a notification unread |

> Every request except the login/callback entry points requires a JWT `Authorization: Bearer …` header. The handoff and capture endpoints deliberately have no JWT guard, since issuing a token is their whole job; they are rate‑limited instead (30/min for handoff, 5/min for capture).
>
> `POST /auth/sso/capture` (Playwright interactive capture) is **deprecated** for production. The browser extension is the supported path.

## Getting started

### Prerequisites

- Node.js 18+ (v20 LTS recommended) and npm
- Google Chrome or Chromium for the interactive capture fallback
- Redis (only if you run the session store in `redis` mode, see below)

### 1. Environment

Copy the example config and fill in your secrets:

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

**Backend** — the important ones:

| Variable | Meaning |
| --- | --- |
| `SSO_BASE_URL` / `SSO_LOGIN_PATH` | YoDips endpoints |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Token signing secret (generate with `openssl rand -hex 32`) and lifetime |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma‑separated |
| `MS_*` | Microsoft Entra app credentials for Kulon OIDC |
| `CHROME_PATH` / `CHROME_PROFILE_DIR` | Browser binary and isolated profile for the interactive window (deprecated) |
| `SESSION_BACKEND` | `memory` (dev/test, no Redis) or `redis` (production) |

**Production only** (`SESSION_BACKEND=redis`): also set `REDIS_URL`, `SESSION_ENC_KEY`, and `SESSION_TTL_MS`.

### 2. Backend

```bash
cd backend
npm install
npm run start:dev       # dev with reload; default http://localhost:3000
```

### 3. Web

```bash
cd web
npm install
npm run dev             # default http://localhost:5173
```

Point the web app at the API via `VITE_API_BASE_URL` (it defaults to `http://localhost:3000`).

### 4. Extension

```bash
cd extension
npm install
npm run dev             # vite build --watch into dist/
```

Build, then load the `dist/` directory as an unpacked extension in `chrome://extensions`. Re‑build and reload after any change to its code.

## Session storage

Sessions sit behind a small interface so you can swap the implementation without touching the rest:

- **`memory`** — an in‑memory store. Zero setup, perfect for development and tests, but sessions don't survive a restart and aren't shared across instances.
- **`redis`** — production‑grade. Sessions persist and share across replicas and are encrypted before writing. Requires Redis + `SESSION_ENC_KEY`.

## Scripts & tests

Each subproject runs independently (no root task runner). Test counts as of 2026‑08‑13:

- **backend** 195 tests (Jest) — `cd backend && npm test`
- **web** 267 tests (Vitest + jsdom) — `cd web && npm test`
- **extension** 64 tests (Vitest) — `cd extension && npm test`

The backend also ships `npm run build` (nest build) and `npm run start:prod` (runs `node dist/main`; build first). The web app builds with `npm run build` (`vue-tsc -b && vite build`).

## Security notes

- Always generate a real `JWT_SECRET` before serving anything outside localhost.
- Keep `SESSION_BACKEND=memory` for development; use `redis` in production so sessions are encrypted at rest.
- Your credentials never reach the backend. The only thing it accepts is already‑valid cookies, and your identity is always derived from the verified Kulon session, never from anything a client claims.
- The interactive capture window deliberately uses a fresh isolated profile so it never touches your personal browser sessions.

---

Built with [Nest](https://nestjs.com), [Vue](https://vuejs.org), [Tailwind CSS](https://tailwindcss.com) + [shadcn‑vue](https://www.shadcn-vue.com), and [Playwright](https://playwright.dev) (deprecated login path — the browser extension is the recommended way in).