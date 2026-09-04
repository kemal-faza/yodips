// YD-AUTH-002: the deprecated capture tool delivers the handoff JWT via a URL
// FRAGMENT (`#access_token=…`), which browsers never send to the server, so
// request/proxy logs cannot capture it. This module is the SINGLE source of
// truth for parsing + validating that fragment — shared by the SPA LoginView
// (which consumes the token) and the router guard (which must let a valid
// handoff hash through to /login instead of redirecting an authenticated user
// past it). Keeping the strict-shape regex here avoids a second, inconsistent
// token check drifting apart in the guard.
//
// Returns null for absent/malformed fragments; the caller decides whether to
// scrub/consume (LoginView) or to gate a redirect (router guard).

export const FRAGMENT_TOKEN_MAX_LEN = 4096;

// Loose-but-strict JWT-shape guard: exactly three NONEMPTY segments separated
// by '.', each segment URL-safe base64url (header.payload.signature). Enough
// to drop garbage before it reaches localStorage; the backend fully verifies
// the signature on use.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Parse + validate `#access_token=<jwt>` out of a raw location hash. */
export function parseFragmentAccessToken(hash: string | undefined): string | null {
  if (!hash || hash.length === 0) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^access_token=([^&]+)/.exec(raw);
  if (!match) return null;
  const token = match[1];
  if (!token || token.length === 0 || token.length > FRAGMENT_TOKEN_MAX_LEN) return null;
  if (!JWT_SHAPE.test(token)) return null;
  return token;
}

/** True when a raw location hash carries a VALID strict-shape handoff token. */
export function isHandoffAccessTokenHash(hash: string | undefined): boolean {
  return parseFragmentAccessToken(hash) !== null;
}
