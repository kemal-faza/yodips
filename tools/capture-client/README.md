# Capture Client

Captures SSO/Microsoft/Kulon/SIAP session cookies from the user's running Chrome
and sends them to the server's handoff endpoint. No credentials are ever
entered into the backend — the user logs in manually in their own browser.

## Prerequisites

1. Node.js 18+.
2. `npm install` in this directory (installs `playwright-core`).
3. Chrome launched with a profile copy + remote debugging port:
   `google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-sso-profile`
   (Chrome 150+ refuses remote debugging on the default profile.)
4. Log into Undip SSO → Kulon in that Chrome window.

## Usage

```bash
node capture-handoff.mjs \
  --api https://your-server.example.com \
  --app-url https://your-server.example.com \
  --cdp http://127.0.0.1:9223 \
  --identity 24060121130000
```

`--identity` is optional — the server derives the NIM from the Kulon session
when possible.

`--app-url` is **required and validated at startup** (before the tool connects to
Chrome or sends any handoff): it must be an absolute `http://` or `https://` URL
with no credentials and no fragment. It opens the SPA at `/login#access_token=<JWT>`.
The JWT is carried ONLY in the URL **fragment** (`#`), which browsers never send
to the server — so request/proxy/CDN logs cannot capture it. The tool never
prints the JWT or a full URL containing it; if `--app-url` is missing or invalid
the tool exits with an error before any session is created. The SPA reads the
fragment only when `VITE_LOGIN_MODE=handoff` (dev/test fallback), consumes it
once, and removes it from the address bar/history immediately. Treat the JWT
like a password: anyone who obtains it can act as you until it expires.

## Dashboard cold/warm benchmark

This benchmark measures browser-side dashboard loading in an already authenticated Chrome. It connects over CDP, creates and closes only its own page, and disconnects without closing Chrome. It never prints or stores cookies, JWTs, response bodies, or upstream data.

Start the web app and backend, log in normally (or complete the extension handoff), then start Chrome with remote debugging enabled. Run:

```bash
node tools/capture-client/benchmark-dashboard.mjs \
  --app-url http://localhost:5173 \
  --cdp http://127.0.0.1:9223 \
  --scenario all \
  --output dashboard-benchmark.json
```

The scenarios are:

- `first-post-login`: a fresh dashboard navigation using the existing authenticated browser context;
- `cold-reload`: a fresh page navigation, which resets the SPA's in-memory cache;
- `warm-reload`: a subsequent navigation classified as warm.

The report contains time-to-useful-content, dashboard response status/bytes, and time-to-complete. The `cold`/`warm` header describes the browser lifecycle used for measurement; it does not claim that backend caches were cleared. Reset backend caches separately before calling a run truly backend-cold.

For backend call counts and slice p50/p95, collect the structured backend log for the same run and analyze it with:

```bash
npm --prefix tools run analyze:observability -- /path/to/backend.log > dashboard-telemetry-report.json
```

Compare the three scenario reports and telemetry reports manually. Do not commit either report when it contains user data, cookies, JWTs, response bodies, or other PII.

## Manual-login baseline

The login flow may require a real user, MFA, or an extension handoff. Use the
manual watcher when automation should not touch the browser:

```bash
touch /tmp/yodips-backend.log
node tools/capture-client/manual-dashboard-baseline.mjs \
  --log /tmp/yodips-backend.log \
  --scenario first-post-login \
  --output /tmp/yodips-first-post-login.json
```

Start the watcher before logging in. Complete the login manually, then press
Enter when useful Dashboard content is visible. The watcher reads only new
structured telemetry lines, reports the dashboard request, slice timings,
upstream call counts, and a separate manual wall-clock marker, then exits after
the first dashboard request settles. Repeat with `cold-reload` and
`warm-reload` after the initial session is ready. Manual login/redirect time is
reported separately and must not be compared with the five-second dashboard
target. The report never stores cookies, JWTs, response bodies, or PII.
