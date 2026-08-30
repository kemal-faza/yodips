import { KulonUpstreamSession } from './kulon-upstream.session';
import { SessionStore } from '../session/session-store';
import { DataCache } from '../cache/data-cache';
import { InMemoryDataCache } from '../cache/in-memory-data.cache';

class FakeStore extends SessionStore {
  constructor(private map: Map<string, any>) { super(); }
  async set(k: string, v: any) { this.map.set(k, v); }
  async get(k: string) { return this.map.get(k) ?? null; }
  async clear(k: string) { this.map.delete(k); }
  async all() { return Array.from(this.map.values()); }
}

function htmlWithSesskey(sk: string) {
  return `<html><body><input type="hidden" name="sesskey" value="${sk}"/></body></html>`;
}

describe('KulonUpstreamSession.getContext', () => {
  let store: FakeStore;
  let cache: DataCache;
  const cookie = 'MoodleSession=abc123';
  const cookie2 = 'MoodleSession=xyz999';

  beforeEach(() => {
    store = new FakeStore(new Map([['2304012012345', { kulonCookie: cookie }]]));
    cache = new InMemoryDataCache(60_000);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('fetches sesskey on cold cache, reuses cached on warm (1 upstream fetch)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: async () => htmlWithSesskey('sk1'),
    } as unknown as Response);
    const seam = new KulonUpstreamSession(store, cache);

    const ctx1 = await seam.getContext('2304012012345');
    const ctx2 = await seam.getContext('2304012012345');
    expect(ctx1.sesskey).toBe('sk1');
    expect(ctx2.sesskey).toBe('sk1');
    expect(spy).toHaveBeenCalledTimes(1); // warm cache -> no refetch
  });

  it('single-flights concurrent getContext (2 callers = 1 /my/ fetch)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: async () => htmlWithSesskey('sk1'),
    } as unknown as Response);
    const seam = new KulonUpstreamSession(store, cache);

    const [a, b] = await Promise.all([
      seam.getContext('2304012012345'),
      seam.getContext('2304012012345'),
    ]);
    expect(a.sesskey).toBe('sk1');
    expect(b.sesskey).toBe('sk1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses a fingerprint key — a changed cookie is a cache miss (refetch)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200, url: 'https://kulon2.undip.ac.id/my/',
      text: async () => htmlWithSesskey('sk1'),
    } as unknown as Response).mockResolvedValueOnce({
      ok: true, status: 200, url: 'https://kulon2.undip.ac.id/my/',
      text: async () => htmlWithSesskey('sk2'),
    } as unknown as Response);
    const seam = new KulonUpstreamSession(store, cache);

    await seam.getContext('2304012012345');
    store.map.set('2304012012345', { kulonCookie: cookie2 });
    const ctx = await seam.getContext('2304012012345');
    expect(ctx.sesskey).toBe('sk2');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws stale 401 when no cookie in session store', async () => {
    const empty = new FakeStore(new Map());
    const seam = new KulonUpstreamSession(empty, cache);
    await expect(seam.getContext('nobody')).rejects.toMatchObject({ reason: 'no-cookie' });
  });
});
