// Pure, injection-friendly core of the extension. No `chrome` import — all side
// effects (cookie read, storage, tab open, HTTP) arrive via `deps`. This keeps
// the whole handoff logic unit-testable without a browser.
export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const SSO_LOGIN_URL = 'https://sso.undip.ac.id/auth/user/login';
export const KULON_OIDC_URL = 'https://kulon2.undip.ac.id/auth/oidc/';
export const SIAP_SSO_URL = 'https://siap.undip.ac.id/sso/login';
// The real Kazan SSO session cookie. Opening the SSO login page sets a
// `csrftoken` cookie before any authentication — so session detection MUST key
// on this exact name, not on mere domain presence.
export const SSO_SESSION_COOKIE = 'ci_session_sso';
export const POLL_INTERVAL_MS = 3000;
export const PHASE_TIMEOUT_MS = 3 * 60_000; // per-service login deadline (like CDP)

// The orchestration cascade order: central Kazan SSO first, then Kulon and SIAP
// auto-login via the SSO session. Used to derive which cookies must be cleared
// before (re)opening a login tab so stale session cookies cannot fast-track a
// premature handoff (which the backend then rejects as expired → relogin loop).
export const PHASE_CHAIN = ['sso', 'kulon', 'siap'];

/**
 * Cookie patterns to clear for a single service phase. Clearing a stale session
 * cookie BEFORE opening its login tab makes `evaluateCookies` return false for
 * that service, so the orchestration genuinely waits for the user to log in
 * instead of immediately POSTing a handoff on the stale cookie (which the
 * backend rejects → close/reopen loop).
 */
export function cookiePatternsForPhase(phase) {
  if (phase === 'sso') {
    return [
      { domain: 'sso.undip.ac.id', name: SSO_SESSION_COOKIE },
      { domain: 'undip.ac.id', name: SSO_SESSION_COOKIE },
    ];
  }
  if (phase === 'kulon') {
    return [{ domain: 'kulon2.undip.ac.id', name: /^MoodleSession/ }];
  }
  // 'siap'
  return [
    { domain: 'siap.undip.ac.id', name: /^(?:sia_|sipp|ciapp_)/ },
    { domain: 'undip.ac.id', name: /^(?:sia_|sipp|ciapp_)/ },
  ];
}

/** Downstream phases (including `phase`) whose cookies must be cleared. The SSO
 *  cascade auto-propagates sso → kulon → siap, so a stale downstream cookie
 *  would otherwise fast-track a premature handoff after the upstream login. */
export function phasesToClear(phase) {
  const idx = PHASE_CHAIN.indexOf(phase);
  return idx === -1 ? [] : PHASE_CHAIN.slice(idx);
}

/**
 * Generate a SSO ticket compatible with the backend's SSOTicketService:
 * base64 of the current unix second timestamp.
 *
 * Uses `btoa` (not Node `Buffer`) because MV3 service workers run in the
 * browser, where Buffer is undefined. For the ASCII digit timestamp the
 * output is identical to `Buffer.from(...).toString('base64')`.
 */
export function generateTicket() {
  return btoa(String(Math.floor(Date.now() / 1000)));
}

/** Build the Kulon OIDC service URL with a fresh ticket. */
export function buildKulonTicketUrl() {
  return `${KULON_OIDC_URL}?t=${generateTicket()}`;
}

/** Build the SIAP SSO service URL with a fresh ticket. */
export function buildSiapTicketUrl() {
  return `${SIAP_SSO_URL}?t=${generateTicket()}`;
}

export function cookiesToStr(cookies, pred) {
  return cookies
    .filter((c) => pred(c.domain))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Like cookiesToStr, but the predicate receives the full cookie object. */
function cookiesToStrByCookie(cookies, pred) {
  return cookies
    .filter((c) => pred(c))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** True for the parent Undip domain or any of its subdomains. */
function isUndipParent(d) {
  return d === 'undip.ac.id' || d.endsWith('.undip.ac.id');
}

/**
 * A SIAP cookie. Sessions usually live on `siap.undip.ac.id` / `.siap.undip.ac.id`,
 * but some deployments store the session on the parent `.undip.ac.id` domain. On
 * the parent domain only name-precise matches count (to avoid a bare `csrftoken`
 * or the Kazan `ci_session_sso` cookie tripping SIAP detection).
 */
function isSiapCookie(c) {
  if (c.domain.includes('siap.undip.ac.id')) return true;
  return isUndipParent(c.domain) && /^(?:sia_|siap|ciapp_)/i.test(c.name);
}

/**
 * Evaluate which required session cookies are present.
 */
export function evaluateCookies(cookies) {
  return {
    // Kazan SSO requires the actual `ci_session_sso` cookie. The login page
    // sets a `csrftoken` cookie on the same domain before authentication, so
    // domain-presence alone is NOT a valid signal.
    hasSso: cookies.some(
      (c) =>
        c.name === SSO_SESSION_COOKIE &&
        (c.domain.includes('sso.undip.ac.id') || isUndipParent(c.domain)),
    ),
    // Kulon requires a real Moodle session cookie. A bare `csrftoken` or OIDC
    // pre-auth cookie on the kulon domain appears before the session is live;
    // treating it as "logged in" triggers a premature handoff → KULON_STALE
    // relogin loop. Key on the `MoodleSession` name, not domain presence.
    hasKulon: cookies.some(
      (c) =>
        c.domain.includes('kulon2.undip.ac.id') && /^MoodleSession/.test(c.name),
    ),
    hasSiap: !!cookiesToStrByCookie(cookies, isSiapCookie),
  };
}

/**
 * Which service to re-establish first after the backend reports a stale Kulon
 * session (KULON_STALE). KULON_STALE means Kulon went stale while the central
 * Kazan SSO session is the one that re-propagates to it — so if SSO is still
 * valid, re-open Kulon directly (no pointless SSO page → no cookies.onChanged
 * deadlock when SSO is already live). If SSO itself is missing, start from SSO.
 */
export function reloginPhase(cookieFlags) {
  return cookieFlags.hasSso ? 'kulon' : 'sso';
}

/**
 * Decide the next orchestration step given the current phase and cookies.
 * - 'wait': keep waiting for the current service's cookie
 * - 'open-kulon': SSO done, navigate the SAME tab to the Kulon ticket
 * - 'open-siap': kulon done, navigate the SAME tab to the SIAP login
 * - 'handoff': all cookies present, POST the handoff
 */
export function nextAction(state, cookies) {
  const { hasSso, hasKulon, hasSiap } = evaluateCookies(cookies);
  if (state.phase === 'sso') {
    return hasSso ? 'open-kulon' : 'wait';
  }
  if (state.phase === 'siap') {
    return hasSiap ? 'handoff' : 'wait';
  }
  // phase 'kulon'
  if (!hasKulon) return 'wait';
  return hasSiap ? 'handoff' : 'open-siap';
}

/** Build the HandoffDto body from the full cookie list. */
export function buildHandoffBody(cookies) {
  return {
    kulonCookie: cookiesToStr(cookies, (d) => d.includes('kulon2.undip.ac.id')),
    ssoCookie: cookiesToStrByCookie(
      cookies,
      (c) => c.domain.includes('sso.undip.ac.id') ||
        (isUndipParent(c.domain) && c.name === SSO_SESSION_COOKIE),
    ),
    microsoftCookie: cookiesToStr(
      cookies,
      (d) => d.includes('microsoftonline.com') || d.includes('login.live.com'),
    ),
    siapCookie: cookiesToStrByCookie(cookies, isSiapCookie),
  };
}

/** POST the cookies to the backend handoff endpoint. */
export async function performHandoff(deps, cookies) {
  const stored = (await deps.getServerUrl()) || DEFAULT_SERVER_URL;
  const serverUrl = stored.replace(/\/+$/, '');
  const res = await deps.fetchHandoff(`${serverUrl}/api/auth/session/handoff`, buildHandoffBody(cookies));
  if (!res.ok) {
    // Propagate the backend's machine-readable error code/reason (KULON_STALE,
    // KULON_NO_COOKIE) so callers can decide whether to retry or surface.
    const message =
      res.status === 429
        ? 'Terlalu banyak percobaan handoff. Tunggu beberapa detik lalu coba lagi.'
        : `Handoff gagal (${res.status})`;
    return {
      ok: false,
      status: res.status,
      code: res.code,
      reason: res.reason,
      message,
    };
  }
  return {
    ok: true,
    accessToken: res.accessToken,
    hasSso: res.hasSso,
    hasMicrosoft: res.hasMicrosoft,
    hasKulon: res.hasKulon,
    hasSiap: res.hasSiap,
  };
}

/** Decide the next orchestration step from a backend handoff result.
 *  - 'ok'    → all of sso/kulon/siap verified by the backend — done
 *  - 'open'  → the backend reports at least one service invalid → re-open that
 *              service's login tab (re-capture), regardless of cookie presence
 *  - 'error' → the handoff itself failed
 * This is the single source of truth for re-capture decisions. It keys on the
 * backend's VERIFIED validity flags, NOT on mere cookie presence in the browser
 * (a stale cookie can still be present, which used to cause silent incomplete
 * reuse → SIAP/Kulon 500s).
 */
export function nextHandoffStep(result) {
  if (!result.ok) {
    return { action: 'error', message: result.message };
  }
  if (result.hasSso && result.hasKulon && result.hasSiap) {
    return { action: 'ok', accessToken: result.accessToken };
  }
  const phase = !result.hasSso ? 'sso' : !result.hasKulon ? 'kulon' : 'siap';
  return { action: 'open', phase };
}

/**
 * Entry point for messages from the web app.
 * - 'ping'  → cheap liveness probe (no cookies touched)
 * - 'handoff' → reads the browser cookies, POSTs them to the backend, and
 *     orchestrates whatever session is missing.
 * Return statuses:
 *   'ok'      — all sso/kulon/siap sessions captured (JWT returned)
 *   'started' — a session is missing or incomplete; the background opens a fresh
 *               login tab for the returned `phase` ('sso' | 'kulon' | 'siap')
 *   'relogin' — a captured session went stale; background restarts from SSO
 *   'error'   — fatal failure
 */
export async function handleHandoffMessage(message, deps) {
  if (message && message.action === 'ping') {
    return { status: 'ok' };
  }
  // Cheap read of the last completed handoff result (no cookies, no side
  // effects, no tab opens). Lets the SPA recover the JWT even if every
  // content-bridge push was missed — the self-healing poll polls this.
  if (message && message.action === 'result') {
    const last = await deps.getLastResult();
    return last ?? { status: 'active' };
  }
  // Full logout: clear the SSO/Kulon/SIAP session cookies so the next login
  // cannot fast-path-reuse a stale session and is forced to open a fresh tab.
  if (message && message.action === 'logout') {
    await deps.clearSessionCookies();
    return { status: 'ok' };
  }
  if (!message || message.action !== 'handoff') {
    return { status: 'error', message: 'Unknown action' };
  }

  // One flow, one tab: if an orchestrated login is already active (a login tab
  // is open and its deadline has not passed), a re-click / duplicate handoff
  // message must NOT open a second tab, re-capture cookies, wipe the cached
  // result, or POST another handoff (which would burn the backend throttle).
  // Instead it answers "resume" — the background keeps the existing flow and
  // the SPA simply keeps waiting on the already-open tab. The deadline check
  // lets an expired (orphaned) state start a fresh flow instead.
  const activeFlow = await deps.getFlowState();
  if (activeFlow && activeFlow.deadline > Date.now()) {
    return { status: 'started', resume: true, phase: activeFlow.phase };
  }

  const cookies = await deps.getCookies();
  const cookieFlags = evaluateCookies(cookies);

  // A new flow invalidates any previously stored result so the SPA cannot
  // accidentally pull a stale JWT from a prior (completed) login.
  await deps.clearLastResult();

  // Without a Kulon cookie there is nothing to hand off — orchestrate from SSO.
  if (!cookieFlags.hasKulon) {
    return { status: 'started', phase: 'sso' };
  }

  const result = await performHandoff(deps, cookies);
  if (!result.ok) {
    if (result.code === 'KULON_STALE') {
      return {
        status: 'relogin',
        phase: reloginPhase(cookieFlags),
        message: 'Session Kulon kedaluwarsa — login ulang dibuka',
      };
    }
    return { status: 'error', message: result.message, code: result.code };
  }

  // Decide re-capture based on the backend's verified flags (not cookie presence).
  const step = nextHandoffStep(result);
  if (step.action === 'ok') {
    return { status: 'ok', accessToken: step.accessToken };
  }
  return { status: 'started', incomplete: true, phase: step.phase };
}
