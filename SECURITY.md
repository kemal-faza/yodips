# Security Policy

YoDips handles live academic sessions: it captures SSO/Kulon/SIAP cookies, stores them encrypted, and mints JWTs from them. A flaw here can expose a student's grades, schedule, and identity — so reports are genuinely welcome, and taken seriously.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting:** [Report a vulnerability](https://github.com/kemal-faza/yodips/security/advisories/new)

That channel is private between you and the maintainer. **Please do not open a public issue** for anything exploitable — a public report can be used against every current user before a fix ships.

Helpful reports include:

- What the flaw is, and which component it lives in (`backend/`, `web/`, `extension/`, `mobile/`)
- Steps to reproduce, or a proof of concept
- The impact you believe it has, and what an attacker gains
- Any suggested fix or mitigation

### What to expect

This is a single-maintainer project maintained alongside coursework, so there is no guaranteed response window. Reports are triaged on a best-effort basis. Please allow for that before disclosing publicly; coordinated disclosure is appreciated, and credit will be given in the advisory unless you prefer otherwise.

## Scope

**In scope**

- The backend API — authentication, session handling, JWT issuance and validation, guards, rate limiting
- The browser extension's cookie capture and handoff flow
- The web app and the Android app
- Session storage: encrypted Redis (`AES-256-GCM`), the in-memory dev store, and the 7-day sliding TTL
- Secret handling in CI and in the deployment configuration

**Out of scope**

- Vulnerabilities in Undip's own systems (SSO, Kulon, SIAP) — report those to Undip's IT, not here
- Anything that requires an already-compromised device, browser profile, or malicious extension with broad permissions
- Social engineering, phishing, or physical access
- Volumetric denial of service against the public deployment
- Missing hardening headers or similar findings with no demonstrated impact

## Design decisions that are not vulnerabilities

Two things look like bugs but are deliberate. Reporting them as-is costs us both time — report them only if you can show a real impact:

- **`POST /api/auth/session/handoff` and `POST /api/auth/sso/capture` have no JWT guard.** They are the endpoints that *create* the JWT, so they cannot require one. They are protected by strict rate limits plus validation of the captured session against the upstream service. A report is in scope if you can forge an identity that passes that validation, or bypass the rate limit in a way that matters.
- **Identity is never taken from client input.** `JWT sub` is always the NIM derived from the validated Kulon session. If you find a path where a client-supplied value influences identity, that is a serious finding — please report it.

## Handling secrets

Never include real cookies, JWTs, session IDs, passwords, NIM, or names in a report, issue, or commit. Redact or synthesise them. `backend/.env` and captured fixtures are gitignored for exactly this reason, and CI runs gitleaks over the full history on every push.

## Safe harbour

Good-faith research is welcome. Please test against your **own** account and a **local** deployment (`http://localhost:3000`), not the production instance. Do not access, modify, or exfiltrate another person's data, and do not run destructive or high-volume tests against production. Research conducted in that spirit will not be pursued or reported.

## Supported versions

Only the latest release of each artifact is supported. Fixes ship as a new release rather than as backports:

| Artifact | Supported |
| --- | --- |
| Chrome/Edge extension | latest published version |
| Android APK | latest GitHub Release |
| Backend (`backend/`) | tip of `main` |
| Web (`web/`) | tip of `main` |
