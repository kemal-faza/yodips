// backend/src/siap/siap-upstream.session.spec.ts
import { SiapUpstreamSession } from './siap-upstream.session';
import { SessionStore } from '../session/session-store';
import { DataCache } from '../cache/data-cache';
import { InMemoryDataCache } from '../cache/in-memory-data.cache';
import { SiapApiUpstream } from './siap-api';
import { StaleUpstreamError } from '../upstream/upstream-fetch';

class FakeStore extends SessionStore {
  constructor(private map: Map<string, any>) { super(); }
  async set(k: string, v: any) { this.map.set(k, v); }
  async get(k: string) { return this.map.get(k) ?? null; }
  async clear(k: string) { this.map.delete(k); }
  async all() { return Array.from(this.map.values()); }
}

const NIM = '2304012012345';
const EMAIL = 'nim@students.undip.ac.id';

function makeSeam(overrides: {
  store?: SessionStore; cache?: DataCache; api?: SiapApiUpstream;
  scrape?: (c: string) => Promise<{ nim: string; emailSso: string }>;
}) {
  const store = overrides.store ?? new FakeStore(new Map([[NIM, { identity: NIM, emailSso: EMAIL, siapCookie: 'c1' }]]));
  const cache = overrides.cache ?? new InMemoryDataCache(60_000);
  const scrape = overrides.scrape ?? (async () => ({ nim: NIM, emailSso: EMAIL }));
  const api = overrides.api ?? {
    mintToken: jest.fn().mockResolvedValue({ token: 'T1', data: {} }),
    fetch: jest.fn(),
  } as unknown as SiapApiUpstream;
  return { seam: new SiapUpstreamSession(store, cache, api, scrape), api, cache };
}

describe('SiapUpstreamSession.getContext', () => {
  it('resolves identity from session store + mints token once', async () => {
    const { seam, api } = makeSeam({});
    const ctx = await seam.getContext(NIM);
    expect(ctx).toEqual({ emailSso: EMAIL, nim: NIM, token: 'T1' });
    expect(api.mintToken).toHaveBeenCalledTimes(1);
  });

  it('caches identity + token — second call is 0 mint + 0 scrape', async () => {
    const { seam, api } = makeSeam({});
    await seam.getContext(NIM);
    await seam.getContext(NIM);
    expect(api.mintToken).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent getContext → 1 mint for N callers', async () => {
    const { seam, api } = makeSeam({});
    await Promise.all([seam.getContext(NIM), seam.getContext(NIM), seam.getContext(NIM)]);
    expect(api.mintToken).toHaveBeenCalledTimes(1);
  });

  it('scrapes identity when session store has no emailSso, then caches it', async () => {
    const store = new FakeStore(new Map([[NIM, { identity: NIM, siapCookie: 'c1' }]]));
    const scrape = jest.fn(async () => ({ nim: NIM, emailSso: EMAIL }));
    const { seam } = makeSeam({ store, scrape });
    const ctx = await seam.getContext(NIM);
    expect(ctx.emailSso).toBe(EMAIL);
    expect(scrape).toHaveBeenCalledTimes(1);
    // cached: second call does not scrape again
    await seam.getContext(NIM);
    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it('does NOT write scraped emailSso back to the session store', async () => {
    const store = new FakeStore(new Map([[NIM, { identity: NIM, siapCookie: 'c1' }]]));
    const { seam } = makeSeam({ store, scrape: async () => ({ nim: NIM, emailSso: EMAIL }) });
    await seam.getContext(NIM);
    const stored = await store.get(NIM);
    expect(stored.emailSso).toBeUndefined();
  });

  it('throws stale 401 when no siapCookie', async () => {
    const empty = new FakeStore(new Map());
    const { seam } = makeSeam({ store: empty });
    await expect(seam.getContext('nobody')).rejects.toMatchObject({ reason: 'no-cookie' });
  });

  it('throws stale 401 when emailSso cannot be resolved (no store, no cache, no scrape)', async () => {
    const store = new FakeStore(new Map([[NIM, { identity: NIM, siapCookie: 'c1' }]]));
    const { seam } = makeSeam({ store, scrape: async () => ({ nim: NIM, emailSso: '' }) });
    await expect(seam.getContext(NIM)).rejects.toMatchObject({ reason: 'no-emailSso' });
  });
});
