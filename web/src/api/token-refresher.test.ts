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
