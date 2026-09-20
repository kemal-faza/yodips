# Contributing to YoDips

Thanks for wanting to help. YoDips is a small project, so the fastest path to a merged change is a focused, tested pull request that follows the conventions below.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Bug reports** — use the bug report issue form. Include the version you are on and steps to reproduce.
- **Feature requests** — open an issue first, especially for anything that touches the API or the auth flow. It is much cheaper to agree on a design before you write the code.
- **Pull requests** — fixes, features, docs, tests, and translation of the Indonesian UI are all welcome.
- **Security issues** — never in a public issue. Follow [SECURITY.md](SECURITY.md).

## Before you start

- **Never commit credentials or captured session data.** No `.env` files, no cookies, no JWTs, no real NIM or names. `backend/test/fixtures/` is gitignored because the captures contain personal data.
- **Do not commit `docs/`.** It is a local-only working directory (gitignored on purpose).
- **Open an issue before a large refactor** so we can talk about scope first.

## Repository layout

| Directory | Stack | Test runner |
| --- | --- | --- |
| [`backend/`](backend) | NestJS + TypeScript | Jest |
| [`web/`](web) | Vue 3 + Vite + Tailwind + shadcn-vue | Vitest (jsdom) |
| [`extension/`](extension) | Chrome/Edge MV3 + TypeScript | Vitest |
| [`mobile/`](mobile) | Kotlin + Jetpack Compose | Gradle (JVM unit tests) |
| [`tools/`](tools) | Node scripts for capture/deploy/benchmarks | Vitest |

There is **no root task runner** — no pnpm workspaces, turbo, or nx. Each subproject is independently installable and runnable. Install and test only what you touch.

## Prerequisites

- **Node.js 22** (the version CI uses)
- **JDK 17** + **Android SDK 35** for `mobile/` (`compileSdk`/`targetSdk` are 35, `minSdk` is 26)

## Local setup

```bash
cp backend/.env.example backend/.env
cp web/.env.example web/.env
```

Every backend variable that matters is documented in the [README](README.md#environment). For local development `SESSION_BACKEND=memory` is enough — no Redis required.

## Running the checks

> **Unset `NODE_ENV` before installing or testing.** If your shell (or a container) has `NODE_ENV=production`, two things break in ways that point nowhere near the cause: `npm install` and `npm ci` **silently skip every devDependency**, and the web suite fails with component tests reporting `undefined` emits while four suites die with `No such built-in module: node:`. Everything passes with `NODE_ENV` unset or set to `test`.

CI runs all of these, so run the ones that cover what you changed:

```bash
# backend — http://localhost:3000
cd backend && npm ci && npm run lint && npm test

# web — http://localhost:5173
cd web && npm ci && npm run build && npm test

# extension — builds into dist/, load unpacked at chrome://extensions
cd extension && npm ci && npm run build && npm test

# mobile
cd mobile && ./gradlew :app:testDebugUnitTest

# tools
cd tools && npm ci && npm test
```

`npm test` in `backend/` accepts a path, which is the quick loop while iterating:

```bash
cd backend && npx jest src/auth/auth.service.spec.ts
```

## Testing conventions and gotchas

These are the traps that cost real time. Please read the ones for the subproject you touch.

**Backend**

- **No dynamic `import()` inside services.** Jest runs as CommonJS and fails with *"dynamic import callback was invoked without --experimental-vm-modules"*. Use static imports.
- Tests that would hit a real upstream URL must **mock `global.fetch`**.
- `@UseGuards(X)` on a controller needs `.overrideGuard(X)` in the test, not just a provider mock.
- Specs using `@nestjs/testing` with class-validator need `import 'reflect-metadata'` on the first line.
- **Keep parsing pure.** HTML/JSON parsers live in `kulon/kulon-parse.ts` and `siap/siap-parse.ts` with no fetch or Nest dependencies. That is what makes them cheap to test — keep new parsing logic there.
- Fixtures under `backend/test/fixtures/` are gitignored (they hold personal data). Some SIAP specs expect you to have copied them locally; a missing fixture is not a bug in your change.

**Web**

- Tests run in jsdom, and `reka-ui` is heavy to import, so the Vitest `testTimeout` is deliberately raised. Do not lower it to "fix" a slow suite.

**Extension**

- `extension/src/core/` must stay **dependency-free pure TypeScript with no `chrome` imports** — that is what makes the state machine unit-testable. All `chrome.*` I/O goes through the thin adapter in `background.ts`.
- Backend error codes are mirrored in `core/contract.ts`. Import them; do not hardcode error strings.

**Mobile**

- Pure parsers and helpers are split out specifically so they are JVM-testable, and **unit tests must not touch the network** — inject a fake token refresher instead.
- `BASE_URL` is baked per build type by Gradle. Debug builds point at `http://10.0.2.2:3000` for the emulator; on a USB device run `adb reverse tcp:3000 tcp:3000`. Do not hardcode a URL in source.

## Pull requests

- **One concern per PR.** Unrelated refactors make review slow.
- **Match the surrounding style.** Backend uses ESLint + Prettier (`npm run lint`, `npm run format`); other subprojects follow their neighbours.
- **Commit messages** follow Conventional Commits with a scope: `feat|fix|refactor|perf|docs|test|chore|ci|build|<scope>`. Common scopes are `backend`, `web`, `extension`, `mobile`, `contract`, `tools`, `ci`. The body may be in Indonesian — that is the project norm.
- **Add tests for behaviour changes.** If you fix a parser, add the input that used to break it as a fixture.
- **Update the docs you invalidate.** User-facing behaviour changes belong in `README.md`, and install/upgrade changes in `INSTALL.md`.
- CI must be green: gitleaks secret scan, `npm audit` on the three npm subprojects, plus a test and build job per subproject.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
