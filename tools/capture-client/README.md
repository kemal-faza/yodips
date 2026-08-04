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
when possible. `--app-url` opens the SPA at `/login?token=<JWT>` after success.
