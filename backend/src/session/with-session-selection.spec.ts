import { StaleUpstreamError } from '../upstream/stale-classification';
import { withFirstLive } from './with-session-selection';

const session = (clientId: string, generation: string, capturedAt: number) => ({
  identity: 'NIM1',
  clientId,
  ssoCookie: 'sso',
  microsoftCookie: '',
  kulonCookie: 'kulon',
  siapCookie: 'siap',
  capturedAt,
  sessionGeneration: generation,
});

it('tries sessions newest-first and retries only on stale', async () => {
  const a = session('a', 'a'.repeat(32), 2);
  const b = session('b', 'b'.repeat(32), 1);
  const store = { listBySub: async () => [b, a] } as any;
  const seen: string[] = [];
  const attempt = async (ref: any) => {
    seen.push(ref.clientId);
    if (ref.clientId === 'a') {
      throw new StaleUpstreamError('Kulon', 'login-redirect');
    }
    return 'ok';
  };
  await expect(
    withFirstLive(store, 'NIM1', attempt, () => new Error('empty')),
  ).resolves.toBe('ok');
  expect(seen).toEqual(['a', 'b']);
});

it('builds the full ref for every attempt', async () => {
  const one = session('client-a', 'a'.repeat(32), 1);
  const store = { listBySub: async () => [one] } as any;
  const refs: unknown[] = [];
  await withFirstLive(
    store,
    'NIM1',
    async (ref) => {
      refs.push(ref);
      return 'ok';
    },
    () => new Error('empty'),
  );
  expect(refs).toEqual([
    {
      sub: 'NIM1',
      clientId: 'client-a',
      sessionGeneration: 'a'.repeat(32),
    },
  ]);
});

it('throws onEmpty when the user has no live session', async () => {
  const store = { listBySub: async () => [] } as any;
  const attempt = jest.fn();
  const empty = new Error('no-session');
  await expect(
    withFirstLive(store, 'NIM1', attempt, () => empty),
  ).rejects.toBe(empty);
  expect(attempt).not.toHaveBeenCalled();
});

it('does not retry a non-stale failure', async () => {
  const a = session('a', 'a'.repeat(32), 2);
  const b = session('b', 'b'.repeat(32), 1);
  const store = { listBySub: async () => [a, b] } as any;
  const attempt = jest.fn().mockRejectedValue(new Error('boom'));
  await expect(
    withFirstLive(store, 'NIM1', attempt, () => new Error('empty')),
  ).rejects.toThrow('boom');
  expect(attempt).toHaveBeenCalledTimes(1);
});

it('rethrows the last stale error when every candidate is stale', async () => {
  const a = session('a', 'a'.repeat(32), 2);
  const b = session('b', 'b'.repeat(32), 1);
  const store = { listBySub: async () => [a, b] } as any;
  const first = new StaleUpstreamError('Kulon', 'http-not-ok');
  const last = new StaleUpstreamError('Kulon', 'login-redirect');
  const attempt = jest
    .fn()
    .mockRejectedValueOnce(first)
    .mockRejectedValueOnce(last);
  await expect(
    withFirstLive(store, 'NIM1', attempt, () => new Error('empty')),
  ).rejects.toBe(last);
  expect(attempt).toHaveBeenCalledTimes(2);
});

it('caps the candidate list at the ten newest devices', async () => {
  const sessions = Array.from({ length: 12 }, (_, index) =>
    session(`c${index}`, 'a'.repeat(32), index),
  );
  const store = { listBySub: async () => sessions } as any;
  const attempt = jest
    .fn()
    .mockRejectedValue(new StaleUpstreamError('Kulon', 'http-not-ok'));
  await expect(
    withFirstLive(store, 'NIM1', attempt, () => new Error('empty')),
  ).rejects.toBeInstanceOf(StaleUpstreamError);
  expect(attempt).toHaveBeenCalledTimes(10);
  const tried = attempt.mock.calls.map(([ref]: [{ clientId: string }]) => ref.clientId);
  expect(tried).toEqual([
    'c11', 'c10', 'c9', 'c8', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2',
  ]);
  expect(sessions).toHaveLength(12); // the store's array is not mutated
});
