import type { SessionRef } from '../session/session-store';
import { cacheKeyForCurrent, cacheKeyForSession } from '../session/session-scope';

/**
 * Which session a Kulon call speaks for. `session` carries the caller's ref (so
 * the key is bound to a session generation); `current` is the internal polling
 * path that addresses a user by `sub`.
 */
export type KulonScope =
  | { kind: 'session'; ref: SessionRef }
  | { kind: 'current'; sub: string };

/** Per-course fallback fan-out while merging course progress. */
export const COURSE_PROGRESS_CONCURRENCY = 4;

export function normalizeKulonScope(scope?: KulonScope | string): KulonScope | undefined {
  if (typeof scope === 'string') return { kind: 'current', sub: scope };
  return scope;
}

/**
 * Cache key for a Kulon payload. The single owner of the `kulon` namespace, so
 * a scope change cannot silently fork one caller's cache from another's.
 */
export function kulonCacheKey(scope: KulonScope, ...parts: string[]): string {
  return scope.kind === 'session'
    ? cacheKeyForSession(scope.ref, 'kulon', ...parts)
    : cacheKeyForCurrent(scope.sub, 'kulon', ...parts);
}
