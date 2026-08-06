# SSO

A small aggregator around Undip's (Universitas Diponegoro) single sign‑on. Instead of hopping between SSO, Kulon, and SIAP every time you need something, **SSO** sits in the middle — signs in once, holds your session, and hands a clean REST API to the apps on top of you use to study.

It's three pieces working together:

- **`backend/`** — NestJS + TypeScript API. Owns all the sign‑in logic and turns Undip's web‑only services into simple endpoints.
- **`web/`** — Vue 3 + Vite single‑page app. The face you talk to.
- **`mobile/`** — Kotlin (Jetpack Compose), wired to the same API. Planned; the directory is scaffolding for now.

---

## Why does this exist?

Most of Undip's services authenticate against SSO but don't expose a public API. To read your grades on SIAP or pull your Kulon assignments programmatically, you'd either scrape pages by hand or re–log in everywhere.

This project centralizes that. Sign in **once** (through the backend, in one of two ways — see below), and every downstream service reuses that single session. Layers you build on top — a schedule widget, a grade tracker, a personal portal — just call ordinary REST endpoints instead of fighting browser sessions.

## How sign‑in works

The backend supports two complementary flows. Pick whichever fits the situation:

1. **Automated browser capture** — the backend drives a headless Chrome via **Playwright** (CDP at `CDP_URL`), signs into SSO, and captures the session cookie. Good for scripts and background jobs.
2. **Interactive login** — if you'd rather watch it happen, the backend pops up a *visible* browser window for you to log in yourself, then captures the resulting session. It always uses an isolated fresh profile (`CHROME_PROFILE_DIR`) — never your everyday Chrome profile with its stored sessions.

**Microsoft / Entra (Kulon)** — Kulon uses Microsoft OIDC rather than the Undip SSO page, so it gets its own callback flow: `/api/auth/microsoft/login` → `/api/auth/microsoft/callback`.

## The API surface

All routes live under `/api`.

| Method | Path | What it's for |
| --- | --- | --- |
| `POST` | `/auth/login` | Exchange credentials for a JWT |
| `POST` | `/auth/sso/capture` | Capture an SSO session (browser automation) |
| `GET` | `/auth/microsoft/login` | Start Microsoft/Entra OIDC for Kulon |
| `GET` | `/auth/microsoft/callback` | OIDC redirect target |
| `POST` | `/auth/session/handoff` | Move a captured session to the store |
| `GET` | `/auth/me` | Current user from your token |
| `GET` | `/kulon/courses` | Courses from Kulon |
| `GET` | `/kulon/assignments` · `/all` | Assignments, grouped or flat |
| `GET` | `/kulon/assignments/:id/detail` | One assignment's details |
| `GET` | `/kulon/courses/:id/content` | A course's content |
| `GET` | `/siap/profile` | Your SIAP profile |
| `GET` | `/siap/irs` | IRS (study‑plan) records |
| `GET` | `/siap/khs` | KHS (grades) records |

> Every request except the login/callback entry points requires a JWT `Authorization: Bearer …` header.

## Getting started

### Prerequisites

- Node.js 18+ (v20 LTS recommended) and npm
- Google Chrome or Chromium for the Playwright capture flows
- Redis (only if you run the session store in `redis` mode — see below)

### 1. Environment

Copy the example config and fill in your secrets:

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

**Backend** — the important ones:

| Variable | Meaning |
| --- | --- |
| `SSO_BASE_URL` / `SSO_LOGIN_PATH` | Undip SSO endpoints |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Token signing secret (generate with `openssl rand -hex 32`) and lifetime |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma‑separated |
| `MS_*` | Microsoft Entra app credentials for Kulon OIDC |
| `CDP_URL` / `SSO_LOGIN_URL` / `SSO_CAPTURE_TIMEOUT_MS` | Playwright capture tuning |
| `CHROME_PATH` | Browser binary for the interactive window. Defaults to Chrome; point it at Edge and it uses that instead |
| `SESSION_BACKEND` | `memory` (dev/test, no Redis) or `redis` (production) |

**Production only** (`SESSION_BACKEND=redis`): also set `REDIS_URL`, `SESSION_ENC_KEY`, and `SESSION_TTL_MS`.

> `CHROME_PATH` example: the interactive login window can open in whatever browser you prefer — set `CHROME_PATH=/usr/bin/microsoft-edge` to use Edge, for instance. The window *always* runs in an isolated fresh profile.

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

## Session storage

Sessions are stored behind a small interface so you can swap the implementation without touching the rest:

- **`memory`** — an in‑memory store. Zero setup, perfect for development and tests, but sessions don't survive a restart and aren't shared across instances.
- **`redis`** — production‑grade. Sessions persist and share across replicas; encrypted before writing. Requires Redis + `SESSION_ENC_KEY`.

## Scripts & tests

The backend ships with Jest specs covering the auth, capture, session, Kulon, and SIAP services. Run them with:

```bash
cd backend
npm test
```

## Security notes

- Always generate a real `JWT_SECRET` before serving anything outside localhost.
- Keep `SESSION_BACKEND=memory` for development; use `redis` in production so sessions are encrypted at rest.
- The interactive capture window deliberately uses a fresh isolated profile so it never touches your personal Chrome sessions.

---

Built with [Nest](https://nestjs.com), [Vue](https://vuejs.org), and [Playwright](https://playwright.dev).
