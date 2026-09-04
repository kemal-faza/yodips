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
