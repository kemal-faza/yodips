# Changelog

Notable changes to YoDips, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Two things worth knowing:

- **Tags track the Android app's `versionName`.** The browser extension is versioned independently in
  `extension/manifest.json` and ships inside the same tag, so a release may bump one, the other, or both.
- **This file is the human-readable index.** The full commit-level notes for every tag are generated from
  history by [`.github/workflows/release.yml`](.github/workflows/release.yml) and are always available on the
  [Releases page](https://github.com/kemal-faza/yodips/releases), together with the signed APK, the extension
  zip, and `SHA256SUMS.txt`.

## [Unreleased]

## [0.6.6] - 2026-09-20

- Layered elevation on Android so surfaces read as 3D: card surfaces brighter than the background, shadows
  drawn to follow the object's shape instead of a bevel effect.
- Dark mode shadows reworked to match the web recipe (0.6 alpha, tapered profile), with depth expressed
  through a ladder of surface luminances rather than a single shadow.
- FAB keeps its light-mode styling in dark mode — only the colours differ.

## [0.6.5] - 2026-09-20

- Android: assignment attachments can be opened; notifications can be opened and cleared (with a
  confirmation); skeleton loading on first load; slide transitions between pages.
- Android: consistent date, time, and number formatting across screens, plus chart contrast and
  label/bar placement fixes.
- Web: elevation system with a neutral tint scale and clearer visual hierarchy; theme-change wipe
  animation; Geist self-hosted, dropping the Google Fonts dependency.
- Fixed: assignment status pills duplicated within the same tab, IRS cards hiding the day, gallery
  attendance not visible and never reporting its result, panel shadows clipped by `overflow-x-clip`.

## [0.6.4] - 2026-09-19

- Mobile dashboard telemetry watchers for performance work.

## [0.6.3] - 2026-09-19

- Performance: dashboard Kulon fan-out reduced and routed through a summary endpoint, slice-aware web
  dashboard caching, lazy-loaded academic charts, native HTTP response compression.
- Tooling: six-slice backend log watcher, repeatable dashboard benchmark and baseline capture, clean
  telemetry report output.

## [0.6.2] - 2026-09-18

- **Contract:** a single source of truth for the backend API contract, with a drift guard that fails the
  build when a client falls behind it.
- **Backend:** upstream fetch split into four modules, one live-session seam with a `SESSION_DEAD` factory,
  session policy extracted into `session-record-policy`. Overrode `multer` to `^2.3.0`, closing four high
  severity DoS advisories.
- **Mobile:** single-flight `SessionFlight` primitive, token auto-refresh on boot and foreground (removing
  a false re-login dialog), scrollable SSO login inside the WebView, date-aware upcoming classes.
- **Web:** deadlines shown in local time, `@unovis` bumped to `^1.7.0` to close a critical `maplibre-gl`
  advisory, cache cleared and views remounted on a fresh session to drop leftover 401s.
- **Extension:** bumped to 0.3.6.

## [0.6.1] - 2026-09-06

- Per-component grade detail on the KHS screen (backend `get_detail_nilai` plus a new Android screen).
- Early session-expiry detection at boot on Android and PWA: a dead session shows the re-login dialog
  immediately instead of only after an action fails.
- Aggregate semester progress bars on the courses page; schedule calendar opens on the current month and
  today's date; `&` in assignment detail renders correctly instead of showing `&amp;`.
- Task list ordering reworked per tab.

## [0.6.0] - 2026-09-05

- **Session identity is now generation-scoped (`sessionGeneration`)** — previously issued JWTs are no
  longer accepted. Every user has to sign in once after this release.
- Logout is now comprehensive: it revokes the server-side session and unregisters the push device rather
  than only clearing local state.
- FCM push registration and cancellation hardened against races, including cancellation mid-flight.
- Fail-closed CIDR policy for `TRUST_PROXY_HOPS`; `fast-uri` override bringing `npm audit` to zero.
- Extension 0.3.5: serialized login flow and single-flight handoff per epoch.

## [0.5.2] - 2026-08-30

- Assignment descriptions render as Markdown on mobile and web (`htmlToMarkdown` via turndown,
  `descriptionMarkdown` on the API).
- Web Push (VAPID) subscriptions with notification history in IndexedDB and a header bell on the
  dashboard; the poller is tuned for web push when FCM is not in play.
- IRS shows only current-semester courses, with attendance totals from scheduled meetings.
- Service worker moved off `localStorage` to IndexedDB.

## [0.5.0] - 2026-08-27

- Assignment detail screen: description, submission status, files, open-in-Kulon.
- Attendance scanning from the gallery, alongside the camera.
- Push notification history screen on Android and a search bar on the tasks page.
- The extension was unchanged in this release (stayed at 0.3.4).

## [0.4.0] - 2026-08-23

- FCM push notifications end to end: a notification store abstraction with a Redis-backed
  implementation, a 15-minute poller with diff detection, the FCM sender and device registration
  endpoints, and Android token lifecycle, display, and tap-to-navigate handling.
- Release workflow restores `google-services.json` from a secret and fails loudly when it is missing.

## [0.3.3] - 2026-08-22

- Silent JWT rotation: `POST /api/auth/refresh`, a silent refresh in the web axios interceptor, and a
  silent refresh plus retry in the Android SSO repository.
- `BASE_URL` baked per Android build type via `BuildConfig`.
- Auth failures return 401 rather than Nest's default 403.
- GitHub Actions bumped off the Node 20 runtime.

## [0.3.1] - 2026-08-20

- JWT and SSO/Kulon/SIAP cookies are encrypted at rest with AES-256-GCM and a non-exportable Android
  KeyStore key. Sessions written before this change are rejected, so one re-login is expected — that is
  deliberate, not a bug.
- A universal re-login dialog appears wherever a session expires.
- Added the public `/privacy` page and privacy policy.

## [0.3.0] - 2026-08-19

- First tagged release, publishing the signed Android APK and the extension zip.

[Unreleased]: https://github.com/kemal-faza/yodips/compare/v0.6.6...HEAD
[0.6.6]: https://github.com/kemal-faza/yodips/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/kemal-faza/yodips/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/kemal-faza/yodips/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/kemal-faza/yodips/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/kemal-faza/yodips/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/kemal-faza/yodips/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kemal-faza/yodips/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/kemal-faza/yodips/compare/v0.5.0...v0.5.2
[0.5.0]: https://github.com/kemal-faza/yodips/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kemal-faza/yodips/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/kemal-faza/yodips/compare/v0.3.2...v0.3.3
[0.3.1]: https://github.com/kemal-faza/yodips/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kemal-faza/yodips/releases/tag/v0.3.0
