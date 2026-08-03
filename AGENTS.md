# AGENTS.md — Undip SSO Aggregator

Monorepo: `backend/` (NestJS, the only app built so far), plus planned `web/` (Vue 3 SPA) and `mobile/` (Kotlin). All clients consume the backend API.

## Running the backend

```bash
cd backend
npm run start:prod     # runs node dist/main (needs `npm run build` first)
npm run start:dev      # watch mode
npm run build          # nest build
npm test               # jest (all specs in src/**/*.spec.ts)
npx jest src/auth/auth.service.spec.ts   # single test file
```

**All 28 tests pass / 9 suites.** Env comes from `backend/.env` (gitignored; `backend/.env.example` is the tracked template).

## CRITICAL: auth is browser-automation based — a running Chrome is required

The app authenticates to Undip SSO by **connecting to the user's already-running Chrome via CDP** (`playwright-core`), reading the **httpOnly** SSO/Microsoft/Kulon session cookies, storing them server-side in `SessionStore`, and issuing a JWT. This is the ONLY viable auth because the university SSO has MFA + httpOnly/domain-bound cookies + no public API.

- `POST /api/auth/sso/capture` **is the login mechanism** — it launches Chrome automation and returns the JWT. It deliberately has **no JWT guard** (circular dependency), only a strict `@Throttle` (5/min) to prevent DoS.
- **If the user's Chrome isn't running with `--remote-debugging-port`, capture fails** with "SSO session not found". The `CDP_URL` env points at it (e.g. `http://127.0.0.1:9223`).
- Chrome 150+ refuses remote debugging on the **default** profile — use a profile copy (`--user-data-dir=/tmp/chrome-sso-profile`). Never kill the user's Chrome.
- SessionStore is **in-memory** — a restart wipes it; re-capture needed.

## Kulon (Moodle) integration gotcha

Kulon's standard REST web service (`/webservice/rest/server.php`) is **disabled**. Use the session-based AJAX API instead: `lib/ajax/service.php?sesskey=<sesskey>` with the captured Moodle cookie. `sesskey` is parsed from the Kulon page HTML (`name="sesskey"`). Verified methods: `core_course_get_enrolled_courses_by_timeline_classification`, `core_calendar_get_action_events_by_timesort`, `block_recentlyaccesseditems_get_recent_items`.

## Key modules & endpoints

```
src/auth/       POST /api/auth/login, /sso/capture, /microsoft/login, /microsoft/callback, GET /me
src/playwright/ PlaywrightAuthService — captures session cookies from Chrome via CDP
src/session/    SessionStore — in-memory session holder
src/kulon/      GET /api/kulon/courses, /assignments (JWT-guarded)
src/microsoft/  OIDC authorization-code flow (with `state` CSRF protection)
src/sso/        SSOTicketService (base64 timestamp tickets), SSOAuthService (manual login)
src/config/     env.validation.ts — validated via class-validator
```

Endpoints that hit paid/expensive upstreams (login, capture, microsoft) are rate-limited via `@nestjs/throttler` (global 30/min, tighter per-route).

## Env quirks (do not "fix" these)

- `validateEnv` uses `validateSync({ whitelist: true })` but **must NOT** use `forbidNonWhitelisted` — NestJS passes the entire `process.env`, so it would reject unrelated OS vars.
- `JWT_SECRET` must be a real random value (generate with `openssl rand -hex 32`); never commit it.
- `CORS_ORIGIN` is comma-separated, read in `main.ts`.
- `docs/` is gitignored (history was rewritten to remove it — do not re-add docs to git).

## Testing quirks

- **No `await import()` / dynamic import in services** — Jest (CommonJS) fails with "dynamic import callback was invoked without --experimental-vm-modules". Use static imports.
- Tests that call `fetch` on real URLs (e.g. Kulon sesskey) must mock `global.fetch`.
- `@UseGuards(X)` in controllers needs `.overrideGuard(X)` in tests, not just a provider mock.
- `@nestjs/testing` + `class-validator` need `import 'reflect-metadata'` at the top of spec files.

## Security baseline (already hardened)

helmet + explicit CORS allowlist, global ValidationPipe, JWT server-side session refs (never raw cookies in tokens), OIDC `state` CSRF protection, gitleaks/semgrep/npm-audit/trivy clean. Run `npm audit` before shipping. `docs/security/2026-08-03-backend-security-review.md` has the full report (local, gitignored).