# DESIGN.md — Undip SSO Aggregator

> Architectural design of the system, described in the **deep-module** vocabulary:
> a **module** (interface + implementation living at a **seam**) is **deep** when a
> lot of behaviour sits behind a small interface. Depth gives callers **leverage**
> and maintainers **locality**.
>
> This file complements (not replaces) `docs/CHECKPOINT.md` — that is the living
> *status* log; this is the living *shape* of the code. Update this when a module's
> interface or seam moves, not when a feature lands.
>
> Cross-cutting term to know: every module that talks to an Undip web service
> speaks its **session cookie** into a **validity guard** first. That repetition is
> the single biggest design tension in the codebase — see "Shared validity probe".

---

## 1. The core idea

Undip's services (SSO, Kulon/Moodle, SIAP) are **web-only**: no public API, no
programmatic auth, session state lives in domain-bound httpOnly cookies. On top
of them sits one backend that owns the sign-in problem and hands clean endpoints
to any client.

Two decisions drive every seam in the system:

1. **The backend never sees credentials.** The user always authenticates inside
   their own browser (extension handoff, interactive window, or mobile WebView).
   The backend only ever receives *cookies* and *validates* them.
2. **A session is the unit of value.** Each user's state is a small set of
   cookies (`ssoCookie`, `kulonCookie`, `siapCookie`, `microsoftCookie`) stored
   server-side behind one interface. Every downstream call re-uses that single
   session instead of re-authenticating.

Everything else — the modules below — is a way of honouring those two decisions.

```
                 ┌──────────────────────────────────────────────┐
   user browser  │   Extension(MV3) → cookies → POST /handoff   │
   (auth here,   │   or interactive window / mobile WebView     │
   never backend)│                                              │
                 └──────────────────────┬───────────────────────┘
                                        │ cookies, no credentials
                                        ▼
                 ┌──────────────────────────────────────────────┐
                 │   SessionStore  (the seam)                   │
                 │   ┌───────────┐        ┌───────────────┐     │
                 │   │ InMemory  │        │  Redis (AES)  │     │
                 │   └───────────┘        └───────────────┘     │
                 └───────────┬──────────────────┬───────────────┘
                             │ session per user │
            ┌────────────────┼──────────────────┼────────────────┐
            ▼                ▼                  ▼                ▼
      KulonService      SiapService      MicrosoftAuth    SSOAuthService
      (Moodle scrape)   (Laravel scrape) (OIDC adapter)   (form login)
            └──────────────────┬───────────────────────────┘
                               ▼
                    JWT issued to the client (sub = NIM)
```

---

## 2. The modules at a glance

| Module | Surface (methods / endpoints) | Kind | Depth |
|---|---|---|---|
| `AuthService` (`auth/`) | `login`, `captureSsoSession`, `handleSessionHandoff`, `me`, microsoft glue | Facade/orchestrator over all sub-modules | **Deep** — one entry point per login story |
| `KulonService` (`kulon/`) | `checkSessionValid`, `getSessionIdentity`, `getCourses`, `getAssignments`, `getAllAssignments`, `getAssignmentDetail`, `getCourseContent` | Moodle client + HTML scorer | **Deep** — huge scraping hidden behind typed contracts |
| `SiapService` (`siap/`) | `checkSessionValid`, `getProfile`, `getIrs`, `getKhs` | Laravel client + HTML/JSON scorer | **Deep** — mirrors Kulon |
| `SessionStore` (`session/`) | `set`, `get`, `clear`, `all` | Persistence seam | **Shallow interface, deep guarantees** (TTL, encryption, fail-fast) |
| `SSOAuthService` / `SSOTicketService` (`sso/`) | `login`, `buildServiceUrl`, `generateTicket` | SSO form login + ticket minting | Medium |
| `MicrosoftAuthService` (`microsoft/`) | `getAuthUrl`, `handleCallback` | OIDC adapter | Medium adapter |
| `PlaywrightAuthService` (`playwright/`) | `launchAndCaptureSession`, `connectOverCDP` | Browser capture | **Deprecated for production**; dev/test fallback |
| `AuthController` / `KulonController` / `SiapController` | HTTP verbs | Thin HTTP adapters over services | Shallow (correctly so) |
| `AccessToken` + validity flags | `{ hasSso, hasKulon, hasSiap, hasMicrosoft, complete }` | The **interface contract** all clients learn | — |

**Web (Vue SPA):**

| Module | Surface | Kind |
|---|---|---|
| `apiClient` (`api/client.ts`) | ~10 typed `get*/post*` + axios interceptors | Thin typed adapter over REST |
| `useAuthStore` / `useKulonStore` / `useThemeStore` | `login`, `fetchMe`, `logout`, `ensureAssignments`, … | Frontend state seams |
| `router/index.ts` | Routes + boot gate (`beforeEach`) | Guard she'll + navigation |
| `utils/*` (`assignment`, `date`, `kulon`, `pagination`) | Pure functions | Deep logic hidden from components |
| `views/*` + `components/*` | UI trees | Shallow render over stores |

**Extension (MV3):**

| Module | Surface | Kind |
|---|---|---|
| `background.js` | message handling + orchestration state machine | Orchestrator |
| `messages.js` | `nextAction`, `nextHandoffStep`, `evaluateCookies`, `performHandoff` | **Deep** — pure decision logic, heavily unit-tested |
| `content-bridge.js`, `popup/*` | handoff-result bridge + options UI | Adapters |

---

## 3. The central seam: `SessionStore`

This is the one place the system *really* varies, and it is a genuine seam —
both principles of a real seam hold:

```ts
// src/session/session-store.ts  — the interface (12 lines)
export abstract class SessionStore {
  abstract set(identity: string, session: CapturedSession): Promise<void>;
  abstract get(identity: string): Promise<CapturedSession | null>;
  abstract clear(identity: string): Promise<void>;
  abstract all(): Promise<CapturedSession[]>;
}
```

Two adapters fill it:

- **`InMemorySessionStore`** (`SESSION_BACKEND=memory`) — zero-dep, dev/test.
- **`RedisSessionStore`** (`SESSION_BACKEND=redis`) — AES-256-GCM at rest, 7-day
  sliding TTL, keyed `sso:session:{identity}`.

**Why this shape is deep:** the interface is 4 tiny async methods, but the
*guarantees* behind it are substantial — sliding re-encryption-on-access TTL,
tamper-resistant decryption (bad key → `null`, never a throw), and a `factory`
(`createSessionStore` in `session.module.ts`) that **fails fast at startup**
rather than silently degrading to memory. The `set/get/clear/all` names carry a
lot of behaviour the callers never think about. A caller that swaps backend from
memory → redis changes zero code.

**The deletion test:** delete `SessionStore` and the complexity reappears in
`AuthController`, `KulonController`, and `SiapController` — every one of them
would have to own TTL + storage + (in prod) the encryption. It earns its keep.

**Internal vs external seam:** the *external* seam is `set/get/clear/all`.
Within the implementation, Redis store has its own *internal* seam (envelope
versioning, AES-GCM) used by its own unit tests — but that is private, not part
of the interface.

> Design note ("one adapter = hypothetical seam"): the memory adapter alone
> would be a hypothetical seam. The **redis adapter is the second one that makes
> it real**. That is exactly the right moment to have added the interface.

---

## 4. The most important interface: the **session shape** + validity flags

The single most-leveraged contract in the system is not a method — it is the
shape returned by `/auth/me`, `/auth/sso/capture`, and `/auth/session/handoff`:

```ts
{ sub, authenticated, hasSso, hasMicrosoft, hasKulon, hasSiap, complete }
```

Every client learns this one shape and reuses it in several places:

- **Backend** `AuthService.me()` derives it from the store, per service.
- **Web** `useAuthStore.fetchMe()` maps it to a boot status
  (`'ok' | 'incomplete' | 'invalid' | 'error'`); the `complete === false` case
  triggers a clean re-login rather than a half-working dashboard.
- **Extension** `messages.js nextHandoffStep(result)` uses the *same* flags to
  decide — based on **backend-verified validity**, not cookie presence — whether
  a service is stale and must be re-captured.

That one shape is the **language across all four targets** (backend, web,
extension, and future mobile). It is the interface the whole system converges
on.

**Critical correctness invariant** surfaced by the deep-module review (fixed
2026-08-08): these flags must mean **validity**, not cookie *presence*. Earlier
the extension reused any old Kulon/SIAP session when the cookie merely existed,
which produced a serving-a-stale-session bug. The fix made `nextHandoffStep` the
single source of truth for reuse, keyed on backend-returned validity.

---

## 5. `KulonService` — a deep module worth copying

Kulon (Moodle 4, "moove" theme) disables its REST web service and most
individual AJAX methods (`core_course_get_contents`, 
`core_course_get_course_module_by_instance`, `mod_assign_get_submission_status`,
`core_webservice_get_site_info` are all disabled). So a *lot* of the service is
HTML scraping discipline hidden behind typed contracts.

The interface is small and stable (the `KulonAssignment`, `KulonCourse`,
`KulonSubmission`, `KulonCourseContent` types are the **stable web/mobile
contract**):

```
checkSessionValid(cookie) → { valid, reason }
getSessionIdentity(cookie) → NIM | null
getCourses(cookie, sesskey) → KulonCourse[]        // timeline 'inprogress'|'past'
getAssignments(cookie, sesskey) → KulonAssignment[]// outstanding only
getAllAssignments(cookie, sesskey) → KulonAssignment[] // incl. completed, quiz
getAssignmentDetail(cookie, id, cmid) → KulonAssignmentDetail
getCourseContent(cookie, sesskey, courseId) → KulonCourseContent
```

Behind that small interface is layer after layer of learned, brittle reality —
all localised here so callers (and only this module's tests) have to care:

- **Identity:** `core_webservice_get_site_info` first, fall back to scraping NIM
  off the `/user/profile.php` `<title>`, `null` on any failure.
- **Timeline classification:** fetches `'all'` + `'inprogress'` + `'hidden'`,
  merges/dedupes by id, tags `timelineStatus`. Moodle's own `inprogress` bucket
  is the *source of truth* for "active", because course names carry no reliable
  semester marker (verified live). Name-parsing survives only as display label.
- **Full assignment list:** `getAllAssignments` aggregates each course's
  `/mod/assign/index.php` **and** `/mod/quiz/index.php` pages (one fetch each,
  bounded concurrency 4) because the calendar action-events feed only surfaces
  outstanding items.
- **Detail scraping:** description from `#intro .no-overflow`, name from
  `#page-header h1` (which sits *outside* `#region-main`), files from
  `pluginfile.php` (skipping `/theme/`), submission status/grade/timestamp from
  the `<div class="submissionstatustable">` block — never a throw, worst case
  `{ status: 'unknown' }`.

**Testability through the interface:** the contract types are what fixtures
(`backend/test/fixtures/kulon/*.html`) exercise. The parsers are pure
string-in → typed-object-out; the tests feed *real* captured HTML, not synthetic
input — a discipline the checkpoint repeatedly warns is the only reliable way to
catch Moodle's real phrasing.

**The seam discipline note:** `KulonController.getSesskey()` duplicates a slice
of session-probing the service also has. That is a small, arguably-shallow seam
worth acknowledging (the controller owns *HTTP mapping* to 401/502; the service
owns *validity semantics*). It is deliberate, but it is the kind of thing that
should collapse into the shared validity probe below if Kulon gets a third site.

---

## 6. `SiapService` — the copy that proved the pattern

SIAP (Laravel) mirrors Kulon exactly: cookie-driven, loop of services disabled,
server-rendered pages + a couple of AJAX endpoints. `SiapService` is nearly a
structural twin of `KulonService`:

```
checkSessionValid(cookie) → { valid, reason }   // probe /pages/mhs/dashboard, marker "tabmhs_profile"
getProfile(cookie) → SiapProfile                // 15+ fields incl. biodata, NIM, IPK, foto
getIrs(cookie) → SiapIrs                        // GET ajax_irs_diambil → { total_sks, html }
getKhs(cookie) → SiapKhs                        // POST get_khs per semester → IPK/IP
```

Same depth pattern: a tiny stable interface, and behind it dozens of parsing
helpers (`pickProfileValue(?:Html)`, `rowCells`, `dataRows`, `parseKhsNilai`,
`semesterLabel`, `currentSemesterCount`, a uniform `stale()` 401 mapper). All
the scraping fragility lives here and nowhere else.

**The deliberate asymmetry:** SIAP's AJAX calls can return HTTP 200 with an HTML
*login page* in the body (not JSON). `siapFetchJson` defends against that —
Content-Type check + try/catch → uniform 401. This is a **must-remember error
mode** encoded in the interface the controllers rely on.

---

## 7. Auth: the flow orchestration (the real "god" module — and why it's OK)

`AuthService` (`auth.service.ts`) is the biggest net-behaviour module. It has a
small interface (`login`, `captureSsoSession`, `handleSessionHandoff`, `me` +
microsoft glue) but orchestrates *everything*:

- **`captureSsoSession`** — smart-reuse an existing fresh+valid session (no
  browser window), else launch the interactive flow (Playwright), verify Kulon
  validity, derive identity, store, issue JWT.
- **`handleSessionHandoff`** — the production login: take cookies from the
  extension, verify Kulon, derive identity (fallback to `dto.identity`), store
  per-user, issue JWT `sub = NIM`.
- **`me`** — derive the `has*`/`complete` contract from the store.

**Why it doesn't violate depth:** most of its "behaviour" is *delegation to
deeper modules* (Kulon, Siap, Playwright, SessionStore, TicketService). Its true
added value is the **decision logic**: *when can a session be reused?* (fresh +
Kulon-verified), *when must we re-capture?*, *how do we map validity to the
flags contract?*. That decision logic is exactly what you want centralised in one
place — spreading it across three controllers would break locality.

The controllers (`auth.controller.ts`) are then correctly **shallow**: thin HTTP
adapters + `@Throttle` decorators so the login-critical, no-guard endpoints
(`sso/capture` 5/min, `handoff` 30/min) are DoS-hardened without circular
dependency on the JWT guard they are the source of.

---

## 8. The "validity probe" refactor that keeps being deferred

Here is the clearest **Deepening opportunity** in the codebase (explicitly
backlogged in CHECKPOINT as D7):

Kulon and SIAP each repeat the same *shape*:

```
probe(cookie):
  no cookie?        → { valid:false, reason:'no-cookie' }
  fetch → !ok/throw → { valid:false, reason:'stale' }
  final URL is login → { valid:false, reason:'stale' }
  page lacks marker  → { valid:false, reason:'stale' }
  else               → { valid:true,  reason:'ok' }
```

That is a **shared scaffold**: a `SessionProbe` module — `probe(baseUrl, marker)`
(or a small abstract base `CounCookieClient` that both `SiapService` and
`KulonService` extend) — would collapse the duplicated probe/`401`-mapping into
one deep module. The checkpoint is *right* to defer it: **two occurrences is the
minimum to justify a seam** ("one adapter = hypothetical seam"). With only two
services, extracting it buys little. **Do it the moment MANDALA/Scholarship/Event
(arrival of a third service at P2.5) lands** — that is the moment the interface
becomes real and each new service becomes a small scraper + config.

---

## 9. Web SPA: where the depth lives (and where it shouldn't)

The web app is mostly **shallow rendering over the backend contract**, and that
is correct. Its genuine depth is concentrated in a few places:

- **`apiClient` interceptors** — encode a subtle policy in one seam: a 401 on
  `/api/kulon/*` means *Kulon session stale* (keep token, show re-login card)
  while a 401 elsewhere means *JWT invalid* (wipe token, redirect). Splitting
  these two meanings is the whole stability of the SPA.
- **`router/index.ts` boot gate** — runs `fetchMe()` exactly once and maps the
  `has*/complete` contract to `'ok' | 'incomplete' | 'invalid' | 'error'`. The
  `'error'` (backend down) case deliberately does **not** bounce, to avoid a
  login loop. That one decision is the diff between "annoying" and "unusable".
- **`utils/*`** — `assignment.ts` (status display logic), `date.ts`
  (Indonesian relative dates), `kulon.ts` (`groupCoursesBySemester`),
  `pagination.ts`. These are pure, deep, unit-tested — exactly the length of
  UI logic that should *not* live in components.
- **`useKulonStore`** — the `ensure*`/`isHidden`/`hide`/`unhide` lazy-load+cache
  surface. Small, but carries the `hidden-assignments` persistence decision
  (currently `localStorage`, per-device — a documented cross-device backlog).

**Everything else** (views, `ui/*` shadcn components) is intentionally shallow —
thin composition. That is where UI should stay; the moment a view grows deep
parsing/decision logic, the discipline is to push it down into `utils/` or up
into a store.

**Leaked seam to watch:** the SPA *and* the extension both read/write the
`hidden-assignments` and theme state in `localStorage`, and the extension sends
its JWT to the SPA via a `postMessage` bridge tagged `undip-sso-extension`.
`useAuthStore.onExtensionResult` validates that tag. That is a real (if thin)
cross-target seam — keep the tag check, and treat "who may post into the SPA" as
an interface invariant.

---

## 10. Extension: a state machine with the decision logic separated

The extension is the *recommended production login path*. Its architecture is
deliberately split so the **decision logic is pure and testable** and the
**side-effecting orchestration is thin**:

- **`messages.js`** — pure functions: `evaluateCookies`, `nextAction`,
  `nextHandoffStep`, `performHandoff`. No `chrome.*` calls. This is the deep
  module; it is the object of the extension's unit tests (40 passing).
- **`background.js`** — the MV3 service worker *state machine*: opens ONE tab to
  the missing service (sso → kulon → siap), wakes on `chrome.cookies.onChanged`
  (plus a periodic safety-net poll to defeat lazy-navigation edge cases), gates
  concurrent passes with an `isProcessing` in-flight lock, and enforces a
  3-min/service deadline via `chrome.alarms`. It uses `deps()` to inject all
  `chrome.*` calls, so the state machine is also unit-testable.

**The behavioural contract** (the reason for the 2026-08-08 fix): reuse is only
allowed when the **backend reports every service verified**. `nextHandoffStep`
reads the backend's `hasSso/hasKulon/hasSiap` flags (not cookie presence) and
re-opens the stale service in the *same* tab when any is invalid; on
`KULON_STALE` it re-establishes from the central SSO session (capped at
`RELOGIN_MAX = 2` to defeat cookie-flip loops). That single-source-of-truth for
"is it fine to reuse?" is the extension's most valuable invariant.

---

## 11. Interfaces callers must know (the real "API surface")

The whole system is a few typed contracts + one storage seam. What every new
client (e.g. the planned `mobile/`) must learn:

**The session contract** (returned from capture/handoff/me):
`{ accessToken, hasSso, hasMicrosoft, hasKulon, hasSiap, complete }` —
validity flags, not cookie presence.

**Login entry points (no JWT, throttled):**
- `POST /api/auth/session/handoff` — send cookies, get JWT. THE production login.
- `POST /api/auth/sso/capture` — interactive window (deprecated for prod).
- `GET /api/auth/microsoft/login` + `/callback` — Kulon OIDC.

**Data endpoints (JWT `Bearer` required):** `/api/kulon/*`, `/api/siap/*`.

**Auth invariant everyone relies on:** the backend never stores or receives
credentials; it only ever validates cookies obtained in the user's own browser.
Mobile must capture in an in-app WebView (`CookieManager`) and hand the cookies
to `/handoff` — creds stay on device, MFA runs on the real page.

---

## 12. Testing surfaces (where each module's depth is exercised)

| Module | Test surface | What it proves |
|---|---|---|
| `SessionStore` + adapters | `in-memory-session.store.spec`, `redis-session.store.spec` | TTL sliding, envelope tamper-safety, fail-fast factory |
| `KulonService` | `kulon.service.spec` + real HTML fixtures | Scrapers map *real* Moodle HTML → typed contract |
| `SiapService` | `siap.service.spec` + real fixtures | Server-render/JSON parsers, stale→401 mapping |
| `AuthService` | `auth.service.spec` | Reuse-vs-recapture decision, identity derivation |
| `messages.js` (extension) | `messages.test.js` | `nextAction`/`nextHandoffStep`/`evaluateCookies` decision logic |
| Web `utils/*`, stores, router | `.test.ts` per file | Boot gate mapping, status labels, relative dates, pagination |
| Controllers | `.controller.spec` with `overrideGuard` | HTTP mapping, 401/404/502 semantics, throttle |

**Test-discipline notes baked in:**
- Tests cross the **interface** (`checkSessionValid`), not past it into parsers
  — "the interface is the test surface".
- No `await import()` in NestJS services (Jest CJS).
- Real-URL fetches are mocked via `global.fetch`; controller guards via
  `.overrideGuard`.
- Fixtures are **real captured HTML**, not synthetic — the only way to beat
  Moodle's actual phrasing.

---

## 13. Seam inventory & where to make the next cut

| Seam | Interface | Adapters (real or hypothetical) | Verdict |
|---|---|---|---|
| Session persistence | `SessionStore` | InMemory + Redis | **Real** — keep |
| Service session-probing | probe(cookie)→valid | Kulon ×2 + Siap ×2 patterns | **Hypothetical** — 3rd service makes it real (D7) |
| Browser capture | launch/capture | Playwright (interactive) + extension (handoff) + mobile WebView | **Real** — extension wins; others deprecate/fallback |
| JWT issuance | capture/handoff/me | — | Core |
| Cross-target flags contract | `has*`/`complete` | backend/web/extension/mobile | **Core language** — document, don't duplicate semantics |

**Order of deepening** (when the backlog says "go"): extract the shared validity
probe when a 3rd service appears; move `hidden-assignments` persistence behind a
real per-user endpoint when cross-device is wanted; stand up the backend → mobile
contract by just pointing a Kotlin client at the same endpoints.

---

## 14. Anti-patterns this design deliberately avoids

- **No credentials anywhere in backend.** Browserless credential-auth is a
  recorded NON-GOAL, not an omission.
- **No shallow god-controller.** `AuthService` looks central but delegates to
  deep modules; its own logic (reuse decisions, validity mapping) is bounded.
- **No fabricated seams.** Only the `SessionStore` and (eventually) the validity
  probe justify an interface; the codebase does not invent adapters for things
  that never vary.
- **No "interface keyword" obsession.** The real interfaces are the *shapes*
  (`KulonAssignment`, the `has*` contract), not TypeScript `interface`
  declarations.
- **No premature extraction.** D7 waits for a third consumer; the SPA's shallow
  views stay shallow.
