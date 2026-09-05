import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import {
  cacheKeyForCurrent,
  cacheKeyForSession,
  CURRENT_SESSION_NAMESPACE,
  currentRefForSession,
  flightKeyForCurrent,
  flightKeyForSession,
} from './session-scope';
import { classifyCacheKey } from '../cache/cache-policy';

const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);
const refA = { sub: 'U1', sessionGeneration: GEN_A };
const refB = { sub: 'U1', sessionGeneration: GEN_B };

describe('session-scope (generation-scoped coordination keys)', () => {
  it('exposes a current-session namespace literal that can never be a generation', () => {
    expect(CURRENT_SESSION_NAMESPACE).toBe('current');
    expect(CURRENT_SESSION_NAMESPACE).not.toMatch(/^[0-9a-f]{32}$/);
  });

  it('flightKeyForSession embeds method + sub + generation (A and B never join)', () => {
    const a = flightKeyForSession(refA, 'siap.profile');
    const b = flightKeyForSession(refB, 'siap.profile');
    expect(a).toContain('U1');
    expect(a).toContain(GEN_A);
    expect(a).toContain('siap.profile');
    expect(a).not.toBe(b);
    expect(b).toContain(GEN_B);
  });

  it('flightKeyForCurrent lives in the current namespace, apart from every scoped key', () => {
    const cur = flightKeyForCurrent('U1', 'siap.jadwal');
    expect(cur).toContain(CURRENT_SESSION_NAMESPACE);
    expect(cur).toContain('U1');
    expect(cur).not.toContain(GEN_A);
    expect(cur).not.toBe(flightKeyForSession(refA, 'siap.jadwal'));
    expect(cur).not.toBe(flightKeyForSession(refB, 'siap.jadwal'));
  });

  it('cacheKeyForSession scopes payload keys by sub + generation', () => {
    expect(cacheKeyForSession(refA, 'siap', 'profile')).toBe(
      `U1:${GEN_A}:siap:profile`,
    );
    expect(cacheKeyForSession(refA, 'siap', 'profile')).not.toBe(
      cacheKeyForSession(refB, 'siap', 'profile'),
    );
  });

  it('scoped and current payload keys keep their cache-policy labels', () => {
    expect(classifyCacheKey(cacheKeyForSession(refA, 'siap', 'profile')).label).toBe(
      'siap.profile',
    );
    expect(classifyCacheKey(cacheKeyForCurrent('U1', 'siap', 'jadwal')).label).toBe(
      'siap.jadwal',
    );
    expect(
      classifyCacheKey(cacheKeyForSession(refA, 'kulon', 'courses')).label,
    ).toBe('kulon.courses');
    expect(
      classifyCacheKey(cacheKeyForCurrent('U1', 'kulon', 'assignments', 'all')).label,
    ).toBe('kulon.assignments_all');
  });

  it('cacheKeyForCurrent lives in the current namespace, apart from scoped keys', () => {
    const cur = cacheKeyForCurrent('U1', 'siap', 'jadwal');
    expect(cur).toBe(`current:U1:siap:jadwal`);
    expect(cur).not.toBe(cacheKeyForSession(refA, 'siap', 'jadwal'));
    expect(cur).not.toBe(cacheKeyForSession(refB, 'siap', 'jadwal'));
  });

  it('rejects a malformed SessionRef with 401 SESSION_DEAD (never builds a key)', () => {
    for (const bad of [
      { sub: 'U1', sessionGeneration: 'not-hex' },
      { sub: '', sessionGeneration: GEN_A },
      { sub: 'U1' },
      null,
    ]) {
      let error: unknown;
      try {
        flightKeyForSession(bad as never, 'siap.profile');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'SESSION_DEAD',
      });
    }
  });

  it('rejects key-injection segments (colon/empty) with a TypeError', () => {
    expect(() => flightKeyForSession(refA, 'a:b')).toThrow(TypeError);
    expect(() => cacheKeyForSession(refA, 'siap', '')).toThrow(TypeError);
    expect(() => cacheKeyForCurrent('', 'siap', 'jadwal')).toThrow(TypeError);
  });

  it('currentRefForSession resolves a SessionRef from the live record, null otherwise', () => {
    expect(
      currentRefForSession('U1', {
        identity: 'U1',
        sessionGeneration: GEN_B,
      }),
    ).toEqual({ sub: 'U1', sessionGeneration: GEN_B });
    expect(currentRefForSession('U1', null)).toBeNull();
    // Legacy record without a generation can never scope a key.
    expect(
      currentRefForSession('U1', { identity: 'U1' }),
    ).toBeNull();
    // A record for another identity never scopes this sub.
    expect(
      currentRefForSession('U1', { identity: 'U2', sessionGeneration: GEN_B }),
    ).toBeNull();
    expect(currentRefForSession('', { identity: 'U1', sessionGeneration: GEN_B })).toBeNull();
  });
});
