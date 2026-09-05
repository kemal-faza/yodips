import { HttpException, HttpStatus } from '@nestjs/common';
import { isSessionRef, type SessionRef } from './session-store';

/**
 * Generation-scoped coordination keys (review findings 1+2).
 *
 * Every authenticated (JwtAuthGuard) SingleFlight slot and session-sensitive
 * cache entry MUST be keyed by BOTH halves of the SessionRef (`sub` +
 * `sessionGeneration`): a `sub`-only key lets a stale A-token join a live
 * B-generation's in-flight run or read B's cached token/identity/payload.
 * Background (poller) paths own no JWT, so they use the explicit
 * `current:` namespace — a literal that can never collide with a 32-hex
 * generation — keeping their slots/entries apart from every scoped key.
 *
 * This module is the ONLY place that builds such keys: callers pass a
 * SessionRef (compile-time) and a malformed ref fails closed with
 * 401 SESSION_DEAD instead of producing a key.
 */

/** Namespace segment for background/current-session keys (never a generation). */
export const CURRENT_SESSION_NAMESPACE = 'current';

/** Key segments may not smuggle `:` separators (fail-closed, mirrors cache-policy charset). */
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

function requireSegment(name: string, value: string): void {
  if (typeof value !== 'string' || !SEGMENT.test(value)) {
    throw new TypeError(`Invalid session-scope key segment for ${name}`);
  }
}

function requireSub(sub: string): void {
  if (typeof sub !== 'string' || !SEGMENT.test(sub)) {
    throw new TypeError('Invalid session-scope sub');
  }
}

/** Fail closed: a malformed ref never yields a key (stale session, re-login). */
function requireRef(ref: SessionRef): void {
  if (!isSessionRef(ref)) {
    throw new HttpException(
      { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** Authenticated SingleFlight slot: `<method>:<sub>:<generation>`. */
export function flightKeyForSession(ref: SessionRef, method: string): string {
  requireRef(ref);
  requireSegment('method', method);
  return `${method}:${ref.sub}:${ref.sessionGeneration}`;
}

/** Background SingleFlight slot: `<method>:current:<sub>` (never a scoped key). */
export function flightKeyForCurrent(sub: string, method: string): string {
  requireSub(sub);
  requireSegment('method', method);
  return `${method}:${CURRENT_SESSION_NAMESPACE}:${sub}`;
}

/** Authenticated payload/token cache key: `<sub>:<generation>:<parts...>`. */
export function cacheKeyForSession(ref: SessionRef, ...parts: string[]): string {
  requireRef(ref);
  if (parts.length === 0) throw new TypeError('session-scope cache key needs parts');
  for (const part of parts) requireSegment('part', part);
  return `${ref.sub}:${ref.sessionGeneration}:${parts.join(':')}`;
}

/** Background payload cache key: `current:<sub>:<parts...>`. */
export function cacheKeyForCurrent(sub: string, ...parts: string[]): string {
  requireSub(sub);
  if (parts.length === 0) throw new TypeError('session-scope cache key needs parts');
  for (const part of parts) requireSegment('part', part);
  return `${CURRENT_SESSION_NAMESPACE}:${sub}:${parts.join(':')}`;
}

/**
 * Resolve the CURRENT live record into a SessionRef for background flows.
 * Returns null when there is no usable live session (absent record, legacy
 * record without a generation, or a record for another identity) — callers
 * map null to a stale 401 and never fall back to an unscoped key.
 */
export function currentRefForSession(
  sub: string,
  session: { identity?: unknown; sessionGeneration?: unknown } | null | undefined,
): SessionRef | null {
  if (typeof sub !== 'string' || !SEGMENT.test(sub)) return null;
  if (typeof session !== 'object' || session === null) return null;
  if (session.identity !== sub) return null;
  const candidate = { sub, sessionGeneration: session.sessionGeneration };
  return isSessionRef(candidate) ? candidate : null;
}
