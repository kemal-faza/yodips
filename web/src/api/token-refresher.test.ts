import { describe, expect, it, vi } from 'vitest';
import { createTokenRefresher } from './token-refresher';

describe('createTokenRefresher (single-flight)', () => {
  it('shares ONE in-flight refresh across concurrent callers', async () => {
    const rawRefresh = vi.fn(async () => 'token-1');
    const refreshOnce = createTokenRefresher(rawRefresh);

    const [a, b, c] = await Promise.all([
      refreshOnce(),
      refreshOnce(),
      refreshOnce(),
    ]);

    expect(rawRefresh).toHaveBeenCalledTimes(1);
    expect(a).toBe('token-1');
    expect(b).toBe('token-1');
    expect(c).toBe('token-1');
  });

  it('starts a NEW refresh only after the previous one settles', async () => {
    let resolveFirst!: (t: string) => void;
    const rawRefresh = vi
      .fn<(p: Promise<string>) => unknown>()
      .mockImplementationOnce(
        () => new Promise<string>((r) => (resolveFirst = r)),
      )
      .mockResolvedValue('token-2');
    const refreshOnce = createTokenRefresher(
      rawRefresh as unknown as () => Promise<string>,
    );

    const first = refreshOnce();
    // While the first refresh is in flight, another caller must NOT start one.
    const piggyback = refreshOnce();
    expect(rawRefresh).toHaveBeenCalledTimes(1);

    resolveFirst('token-1');
    await expect(first).resolves.toBe('token-1');
    await expect(piggyback).resolves.toBe('token-1');

    // Settled -> the next caller starts a fresh refresh.
    await expect(refreshOnce()).resolves.toBe('token-2');
    expect(rawRefresh).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh propagates to every waiter and clears the flight', async () => {
    let rejectFirst!: (e: Error) => void;
    const rawRefresh = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue('token-after-failure');
    const refreshOnce = createTokenRefresher(rawRefresh);

    const p1 = refreshOnce();
    const p2 = refreshOnce();
    rejectFirst(new Error('SESSION_DEAD'));

    await expect(p1).rejects.toThrow('SESSION_DEAD');
    await expect(p2).rejects.toThrow('SESSION_DEAD');

    // Failure settled the flight -> next attempt really re-runs.
    await expect(refreshOnce()).resolves.toBe('token-after-failure');
    expect(rawRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('createTokenRefresher epoch ownership (E0 logout E1)', () => {
  it('E1 waiter never joins an E0 flight and never accepts the E0 token', async () => {
    const { beginLogout, endLogout, isLogoutInProgress } = await import('../lib/logout');
    while (isLogoutInProgress()) endLogout();
    const { createTokenRefresher } = await import('./token-refresher');
    let resolveE0!: (t: string) => void;
    let resolveE1!: (t: string) => void;
    const rawRefresh = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveE0 = r; }))
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveE1 = r; }))
      .mockResolvedValue('token-E2');
    const refreshOnce = createTokenRefresher(rawRefresh);

    const pE0 = refreshOnce(); // epoch E0 flight starts
    expect(rawRefresh).toHaveBeenCalledTimes(1);
    beginLogout();
    endLogout(); // logout FULLY resolves while E0 is pending: epoch E1, flag down
    expect(isLogoutInProgress()).toBe(false);
    const pE1 = refreshOnce(); // E1 waiter must start its OWN flight
    expect(rawRefresh).toHaveBeenCalledTimes(2); // never joins the orphaned E0 flight

    resolveE0('token-E0');
    await expect(pE0).resolves.toBe('token-E0');
    // Old finally must not clear the new flight: E1 is still pending with its own token.
    resolveE1('token-E1');
    await expect(pE1).resolves.toBe('token-E1'); // never 'token-E0'

    // Both settled -> next caller starts fresh (new flight not swallowed).
    await expect(refreshOnce()).resolves.toBe('token-E2');
    expect(rawRefresh).toHaveBeenCalledTimes(3);
    while (isLogoutInProgress()) endLogout();
  });

  it('same-epoch waiters still share one flight (no regression)', async () => {
    const { isLogoutInProgress, endLogout } = await import('../lib/logout');
    while (isLogoutInProgress()) endLogout();
    const { createTokenRefresher } = await import('./token-refresher');
    const rawRefresh = vi.fn(async () => 'token-same-epoch');
    const refreshOnce = createTokenRefresher(rawRefresh);
    const [a, b] = await Promise.all([refreshOnce(), refreshOnce()]);
    expect(rawRefresh).toHaveBeenCalledTimes(1);
    expect(a).toBe('token-same-epoch');
    expect(b).toBe('token-same-epoch');
  });
});
