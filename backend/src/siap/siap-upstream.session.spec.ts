// backend/src/siap/siap-upstream.session.spec.ts
import { SiapUpstreamSession } from './siap-upstream.session';
import { SessionStore } from '../session/session-store';
import type { CapturedSession, SessionRef } from '../session/session-contract';
import { DataCache } from '../cache/data-cache';
import { InMemoryDataCache } from '../cache/in-memory-data.cache';
import { SiapApiUpstream } from './siap-api';
import {
  getTimedFetchTransportReason,
  StaleUpstreamError,
} from '../upstream/upstream-fetch';
import type { TelemetryRuntime } from '../observability/telemetry';

/** Composite key, mirroring the production stores. */
function keyOf(record: { identity: string; clientId: string }): string {
  return `${record.identity}:${record.clientId}`;
}

/**
 * Production-shaped fake: one record per `<identity>:<clientId>` and every
 * ref-based read is device-qualified. `seed()` is synchronous so fixtures read
 * like a table of records rather than a sequence of store writes.
 */
class FakeStore extends SessionStore {
  constructor(public map = new Map<string, CapturedSession>()) { super(); }

  seed(session: CapturedSession): this {
    this.map.set(keyOf(session), session);
    return this;
  }

  async set(session: CapturedSession) { this.seed(session); }

  async getIfGeneration(ref: SessionRef) {
    const rec = this.map.get(`${ref.sub}:${ref.clientId}`) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return null;
    return rec;
  }

  async clearIfGeneration(ref: SessionRef) {
    const key = `${ref.sub}:${ref.clientId}`;
    const rec = this.map.get(key);
    if (!rec) return true;
    if (rec.sessionGeneration !== ref.sessionGeneration) return false;
    this.map.delete(key);
    return true;
  }

  async replaceIfUnchanged(
    ref: SessionRef,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'> {
    const key = `${ref.sub}:${ref.clientId}`;
    const rec = this.map.get(key) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return 'dead';
    if (JSON.stringify(rec) !== JSON.stringify(expected)) return 'conflict';
    this.map.set(key, replacement);
    return 'updated';
  }

  async listBySub(sub: string) {
    return [...this.map.values()].filter((s) => s.identity === sub);
  }

  async clearAllForSub(sub: string) {
    let cleared = 0;
    for (const [key, session] of this.map) {
      if (session.identity !== sub) continue;
      this.map.delete(key);
      cleared += 1;
    }
    return cleared;
  }

  async all() { return [...this.map.values()]; }

  async migrateLegacyKeys() { return { scanned: 0, migrated: 0 }; }
}

const NIM = '2304012012345';
const EMAIL = 'nim@students.undip.ac.id';
const DEFAULT_GEN = 'd'.repeat(32);
const CLIENT_A = 'client-a';
const CLIENT_B = 'client-b';

function session(
  clientId: string,
  overrides: Partial<CapturedSession> = {},
): CapturedSession {
  return {
    identity: NIM,
    clientId,
    ssoCookie: '',
    microsoftCookie: '',
    kulonCookie: '',
    siapCookie: 'c1',
    capturedAt: Date.now(),
    sessionGeneration: DEFAULT_GEN,
    ...overrides,
  };
}

function ref(clientId: string, sessionGeneration = DEFAULT_GEN): SessionRef {
  return { sub: NIM, clientId, sessionGeneration };
}

function storeWith(...sessions: CapturedSession[]): FakeStore {
  const store = new FakeStore();
  for (const record of sessions) store.seed(record);
  return store;
}

function makeSeam(overrides: {
  store?: SessionStore; cache?: DataCache; api?: SiapApiUpstream;
  scrape?: (c: string) => Promise<{ nim: string; emailSso: string }>;
  runtime?: TelemetryRuntime;
}) {
  const store = overrides.store ?? storeWith(
    session(CLIENT_A, { emailSso: EMAIL, siapCookie: 'c1', sessionGeneration: DEFAULT_GEN }),
  );
  const cache = overrides.cache ?? new InMemoryDataCache(60_000);
  const scrape = overrides.scrape ?? (async () => ({ nim: NIM, emailSso: EMAIL }));
  const api = overrides.api ?? {
    mintToken: jest.fn().mockResolvedValue({ token: 'T1', data: {} }),
    fetch: jest.fn(),
  } as unknown as SiapApiUpstream;
  return {
    seam: new SiapUpstreamSession(store, cache, api, scrape, overrides.runtime),
    api,
    cache,
  };
}

function recordingRuntime(): { runtime: TelemetryRuntime; events: any[] } {
  const events: any[] = [];
  return {
    events,
    runtime: {
      sink: { record: (event) => events.push(event) },
      wallNowMs: () => 1_000,
      monotonicNowNs: () => 1_000_000n,
    },
  };
}

describe('SiapUpstreamSession.getContextForSession (B: generation-qualified TOCTOU seam)', () => {
  const GEN_A = 'a'.repeat(32);
  const GEN_B = 'b'.repeat(32);
  it('resolves identity+token for the exact live generation', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: 'cA', sessionGeneration: GEN_A }),
    );
    const { seam, api } = makeSeam({ store });
    const ctx = await (seam as any).getContextForSession(ref(CLIENT_A, GEN_A));
    expect(ctx).toEqual({ emailSso: EMAIL, nim: NIM, token: 'T1' });
    expect(api.mintToken).toHaveBeenCalledTimes(1);
  });

  it('a record from another device cannot satisfy the ref', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: 'cA', sessionGeneration: GEN_A }),
    );
    const { seam, api } = makeSeam({ store });
    await expect(
      seam.getContextForSession(ref(CLIENT_B, GEN_A)),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
    expect(api.mintToken).not.toHaveBeenCalled();
  });

  it('replacement between guard and service read rejects SESSION_DEAD and never mints with B', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: 'cA', sessionGeneration: GEN_A }),
    );
    const { seam, api } = makeSeam({ store });
    // Re-login replaces with B before the qualified read.
    store.seed(session(CLIENT_A, { emailSso: EMAIL, siapCookie: 'cB', sessionGeneration: GEN_B }));
    await expect(
      (seam as any).getContextForSession(ref(CLIENT_A, GEN_A)),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
    expect(api.mintToken).not.toHaveBeenCalled();
    // B itself is hittable with its own generation.
    const ctxB = await (seam as any).getContextForSession(ref(CLIENT_A, GEN_B));
    expect(ctxB.token).toBe('T1');
  });

  it('getCookieForSession returns the exact-generation cookie and rejects a replacement with SESSION_DEAD', async () => {
    const store = storeWith(
      session(CLIENT_A, { siapCookie: 'cA', sessionGeneration: GEN_A }),
    );
    const { seam } = makeSeam({ store });
    await expect((seam as any).getCookieForSession(ref(CLIENT_A, GEN_A))).resolves.toBe('cA');
    store.seed(session(CLIENT_A, { siapCookie: 'cB', sessionGeneration: GEN_B }));
    await expect(
      (seam as any).getCookieForSession(ref(CLIENT_A, GEN_A)),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
  });
});

describe('SiapUpstreamSession.getKhsContextForSession', () => {
  it('resolves API identity and token for a live generation without a web cookie', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: '', sessionGeneration: DEFAULT_GEN }),
    );
    const { seam, api } = makeSeam({ store });

    await expect(
      seam.getKhsContextForSession(ref(CLIENT_A)),
    ).resolves.toEqual({ emailSso: EMAIL, nim: NIM, token: 'T1' });
    expect(api.mintToken).toHaveBeenCalledWith(EMAIL, NIM);
  });

  it('returns the optional web cookie from the same live-generation snapshot', async () => {
    const store = storeWith(
      session(CLIENT_A, {
        emailSso: EMAIL,
        siapCookie: 'cookie-a',
        sessionGeneration: DEFAULT_GEN,
      }),
    );
    const { seam } = makeSeam({ store });

    await expect(
      seam.getKhsContextForSession(ref(CLIENT_A)),
    ).resolves.toMatchObject({ token: 'T1', siapCookie: 'cookie-a' });
  });

  it('does not resolve a KHS context from a replacement generation', async () => {
    const genA = 'a'.repeat(32);
    const genB = 'b'.repeat(32);
    const store = storeWith(
      session(CLIENT_A, {
        emailSso: EMAIL,
        siapCookie: 'cookie-b',
        sessionGeneration: genB,
      }),
    );
    const { seam, api } = makeSeam({ store });

    await expect(
      seam.getKhsContextForSession(ref(CLIENT_A, genA)),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(api.mintToken).not.toHaveBeenCalled();
  });

  it('reports missing SIAP cookie as upstream stale without killing the live backend session', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: '', sessionGeneration: DEFAULT_GEN }),
    );
    const { seam, api } = makeSeam({ store });
    const sessionRef = ref(CLIENT_A);

    await expect(seam.getContextForSession(sessionRef)).rejects.toMatchObject({
      status: 401,
      reason: 'no-cookie',
    });
    await expect(seam.getCookieForSession(sessionRef)).rejects.toMatchObject({
      status: 401,
      reason: 'no-cookie',
    });
    expect(api.mintToken).not.toHaveBeenCalled();
  });
});

describe('SiapUpstreamSession.getApiContextForSession', () => {
  it('resolves API identity and token without a web cookie', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: '', sessionGeneration: DEFAULT_GEN }),
    );
    const { seam, api } = makeSeam({ store });

    await expect(
      seam.getApiContextForSession(ref(CLIENT_A)),
    ).resolves.toEqual({ emailSso: EMAIL, nim: NIM, token: 'T1' });
    expect(api.mintToken).toHaveBeenCalledWith(EMAIL, NIM);
  });

  it('never returns the stored web cookie', async () => {
    const store = storeWith(
      session(CLIENT_A, {
        emailSso: EMAIL,
        siapCookie: 'sia_app_session=stale',
        sessionGeneration: DEFAULT_GEN,
      }),
    );
    const { seam } = makeSeam({ store });

    const ctx = await seam.getApiContextForSession(ref(CLIENT_A));
    expect(ctx).toEqual({ emailSso: EMAIL, nim: NIM, token: 'T1' });
    expect('siapCookie' in ctx).toBe(false);
  });

  it('fails with no-emailSso when the live record has no identity source', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: undefined, siapCookie: '', sessionGeneration: DEFAULT_GEN }),
    );
    const { seam, api } = makeSeam({ store });

    await expect(
      seam.getApiContextForSession(ref(CLIENT_A)),
    ).rejects.toMatchObject({ reason: 'no-emailSso' });
    expect(api.mintToken).not.toHaveBeenCalled();
  });

  it('keeps SESSION_DEAD for a dead session record', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: '', sessionGeneration: 'e'.repeat(32) }),
    );
    const { seam, api } = makeSeam({ store });

    await expect(
      seam.getApiContextForSession(ref(CLIENT_A)),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(api.mintToken).not.toHaveBeenCalled();
  });
});

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
    const store = storeWith(
      session(CLIENT_A, { emailSso: undefined, siapCookie: 'c1', sessionGeneration: DEFAULT_GEN }),
    );
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
    const store = storeWith(
      session(CLIENT_A, { emailSso: undefined, siapCookie: 'c1', sessionGeneration: DEFAULT_GEN }),
    );
    const { seam } = makeSeam({ store, scrape: async () => ({ nim: NIM, emailSso: EMAIL }) });
    await seam.getContext(NIM);
    const stored = await store.getIfGeneration(ref(CLIENT_A));
    expect(stored?.emailSso).toBeUndefined();
  });

  it('throws stale 401 when no siapCookie', async () => {
    const empty = new FakeStore();
    const { seam } = makeSeam({ store: empty });
    await expect(seam.getContext('nobody')).rejects.toMatchObject({ reason: 'no-cookie' });
  });

  it('throws stale 401 when emailSso cannot be resolved (no store, no cache, no scrape)', async () => {
    const store = storeWith(
      session(CLIENT_A, { emailSso: undefined, siapCookie: 'c1', sessionGeneration: DEFAULT_GEN }),
    );
    const { seam } = makeSeam({ store, scrape: async () => ({ nim: NIM, emailSso: '' }) });
    await expect(seam.getContext(NIM)).rejects.toMatchObject({ reason: 'no-emailSso' });
  });
});

describe('SiapUpstreamSession generation-scoped identity/token caches (findings 1+2)', () => {
  const GEN_A = 'a'.repeat(32);
  const GEN_B = 'b'.repeat(32);
  const EMAIL_B = 'b@students.undip.ac.id';

  function scopedStore() {
    return storeWith(
      session(CLIENT_A, { emailSso: EMAIL, siapCookie: 'cA', sessionGeneration: GEN_A }),
    );
  }

  function scopedSeam(store: FakeStore, cache: DataCache, mintToken: jest.Mock) {
    const api = { mintToken, fetch: jest.fn() } as unknown as SiapApiUpstream;
    return new SiapUpstreamSession(store, cache, api, async () => ({ nim: NIM, emailSso: EMAIL }));
  }

  it('getContextForSession(B) never returns A cached token/identity after an A->B replacement', async () => {
    const store = scopedStore();
    const cache = new InMemoryDataCache(60_000);
    const mintToken = jest
      .fn()
      .mockResolvedValueOnce({ token: 'T_A', data: {} })
      .mockResolvedValue({ token: 'T_B', data: {} });
    const seam = scopedSeam(store, cache, mintToken);
    const ctxA = await seam.getContextForSession(ref(CLIENT_A, GEN_A));
    expect(ctxA.token).toBe('T_A');
    // Re-login replaces the live record; the primed A cache must not leak to B.
    store.seed(session(CLIENT_A, {
      emailSso: EMAIL_B,
      siapCookie: 'cB',
      sessionGeneration: GEN_B,
    }));
    const ctxB = await seam.getContextForSession(ref(CLIENT_A, GEN_B));
    expect(ctxB.token).toBe('T_B');
    expect(ctxB.emailSso).toBe(EMAIL_B);
    expect(mintToken).toHaveBeenCalledTimes(2);
    expect(mintToken).toHaveBeenLastCalledWith(EMAIL_B, NIM);
  });

  it('deferred A mint + B replacement: B never joins the A flight (2 mints, B gets B token)', async () => {
    const store = scopedStore();
    const cache = new InMemoryDataCache(60_000);
    let releaseA!: (v: { token: string; data: object }) => void;
    const mintGate = new Promise<{ token: string; data: object }>((resolve) => {
      releaseA = resolve;
    });
    const mintToken = jest
      .fn()
      .mockReturnValueOnce(mintGate)
      .mockResolvedValue({ token: 'T_B', data: {} });
    const seam = scopedSeam(store, cache, mintToken);
    const pendingA = seam.getContextForSession(ref(CLIENT_A, GEN_A));
    // B replacement lands while A's mint is still in flight.
    store.seed(session(CLIENT_A, {
      emailSso: EMAIL_B,
      siapCookie: 'cB',
      sessionGeneration: GEN_B,
    }));
    const ctxB = await seam.getContextForSession(ref(CLIENT_A, GEN_B));
    releaseA({ token: 'T_A', data: {} });
    const ctxA = await pendingA;
    expect(ctxA.token).toBe('T_A');
    expect(ctxB.token).toBe('T_B');
    expect(ctxB.emailSso).toBe(EMAIL_B);
    expect(mintToken).toHaveBeenCalledTimes(2);
  });

  it('getContextForCurrent resolves the live ref and shares the scoped entry (0 extra mints)', async () => {
    const store = scopedStore();
    const cache = new InMemoryDataCache(60_000);
    const mintToken = jest.fn().mockResolvedValue({ token: 'T_A', data: {} });
    const seam = scopedSeam(store, cache, mintToken);
    await seam.getContextForSession(ref(CLIENT_A, GEN_A));
    const ctx = await seam.getContextForCurrent(NIM);
    expect(ctx.token).toBe('T_A');
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('resolves the current context from the newest live device record and shares its scoped token', async () => {
    const store = storeWith(
      session(CLIENT_B, {
        emailSso: EMAIL,
        siapCookie: 'cOld',
        sessionGeneration: GEN_B,
        capturedAt: 1_000,
      }),
      session(CLIENT_A, {
        emailSso: EMAIL,
        siapCookie: 'cNew',
        sessionGeneration: GEN_A,
        capturedAt: 2_000,
      }),
    );
    const cache = new InMemoryDataCache(60_000);
    const mintToken = jest.fn().mockResolvedValue({ token: 'T_A', data: {} });
    const seam = scopedSeam(store, cache, mintToken);

    // Prime the newer device's generation-scoped entry, then prove the current
    // read lands on it (same key) instead of the older device or a refetch.
    await seam.getContextForSession(ref(CLIENT_A, GEN_A));
    const listSpy = jest.spyOn(store, 'listBySub');
    const currentRef = await seam.getCurrentSessionRef(NIM);
    const ctx = await seam.getContextForCurrent(NIM);

    expect(currentRef).toEqual(ref(CLIENT_A, GEN_A));
    expect(ctx.token).toBe('T_A');
    expect(listSpy).toHaveBeenCalledWith(NIM);
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('falls back to an older device when the newest record has no SIAP cookie', async () => {
    const store = storeWith(
      session(CLIENT_B, {
        emailSso: EMAIL,
        siapCookie: 'cOld',
        sessionGeneration: GEN_B,
        capturedAt: 1_000,
      }),
      session(CLIENT_A, {
        emailSso: EMAIL,
        siapCookie: '',
        sessionGeneration: GEN_A,
        capturedAt: 2_000,
      }),
    );
    const cache = new InMemoryDataCache(60_000);
    const mintToken = jest.fn().mockResolvedValue({ token: 'T_B', data: {} });
    const seam = scopedSeam(store, cache, mintToken);

    await expect(seam.getCurrentSessionRef(NIM)).resolves.toEqual(ref(CLIENT_B, GEN_B));
    await expect(seam.getContextForCurrent(NIM)).resolves.toMatchObject({ token: 'T_B' });
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('getContextForCurrent after a B-replacement uses the B-scoped entry (never A cached)', async () => {
    const store = scopedStore();
    const cache = new InMemoryDataCache(60_000);
    const mintToken = jest
      .fn()
      .mockResolvedValueOnce({ token: 'T_A', data: {} })
      .mockResolvedValue({ token: 'T_B', data: {} });
    const seam = scopedSeam(store, cache, mintToken);
    await seam.getContextForSession(ref(CLIENT_A, GEN_A));
    store.seed(session(CLIENT_A, {
      emailSso: EMAIL_B,
      siapCookie: 'cB',
      sessionGeneration: GEN_B,
    }));
    const ctx = await seam.getContextForCurrent(NIM);
    expect(ctx.token).toBe('T_B');
    expect(ctx.emailSso).toBe(EMAIL_B);
    expect(mintToken).toHaveBeenCalledTimes(2);
  });
});

describe('SiapUpstreamSession.fetchText', () => {
  it('preserves a stale error and handles a rejecting async onStale callback', async () => {
    const { seam } = makeSeam({});
    const hookError = new Error('callback failure must not leak');
    const onStale = jest.fn(async () => {
      throw hookError;
    });
    const response = {
      ok: false,
      status: 403,
      url: 'https://siap.undip.ac.id/pages/mhs/dashboard',
      headers: new Headers(),
    } as unknown as Response;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      jest.spyOn(global, 'fetch').mockResolvedValue(response);

      const outward = await seam
        .fetchText('https://siap.undip.ac.id/pages/mhs/dashboard', undefined, { onStale })
        .catch((error: unknown) => error);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(outward).toBeInstanceOf(StaleUpstreamError);
      expect((outward as StaleUpstreamError).reason).toBe('http-not-ok');
      expect(onStale).toHaveBeenCalledWith('http-not-ok', null, undefined);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('uses the fixed profile-page context and records one safe event per attempt', async () => {
    const { runtime, events } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const url = 'https://siap.undip.ac.id/pages/mhs/dashboard';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html>profile</html>',
    } as Response);

    await expect(seam.fetchText(url, { redirect: 'follow' })).resolves.toBe('<html>profile</html>');
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap',
        operation: 'profile_page',
        route: 'GET /pages/mhs/dashboard',
        outcome: 'ok',
        status: 200,
      }),
    ]);
  });

  it('uses fixed attendance-page and notification-action contexts for text and JSON', async () => {
    const { runtime, events } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const attendanceUrl = 'https://siap.undip.ac.id/jadwal_mahasiswa/mhs/jadwal/get_absen';
    const notificationUrl = 'https://siap.undip.ac.id/pages/mhs/dashboard/ajax/unread';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: attendanceUrl,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<table>attendance</table>',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: notificationUrl,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => ({ status: 'ok', message: 'done' }),
      } as Response);

    await expect(seam.fetchText(attendanceUrl, { method: 'POST' })).resolves.toContain('attendance');
    await expect(seam.fetchJson(notificationUrl, { method: 'POST' })).resolves.toEqual({
      status: 'ok',
      message: 'done',
    });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap',
        operation: 'attendance_page',
        route: 'POST /jadwal_mahasiswa/mhs/jadwal/get_absen',
        outcome: 'ok',
      }),
      expect.objectContaining({
        service: 'siap',
        operation: 'notification_action',
        route: 'POST /pages/mhs/dashboard/ajax/unread',
        outcome: 'ok',
      }),
    ]);
  });

  it('times the session probe and keeps its no-throw stale contract', async () => {
    const { runtime, events } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const url = 'https://siap.undip.ac.id/pages/mhs/dashboard';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html>login</html>',
    } as Response);

    await expect(seam.checkSessionValid('sia_app_session=TEST')).resolves.toEqual({
      valid: false,
      reason: 'stale',
    });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap',
        operation: 'session_probe',
        route: 'GET /pages/mhs/dashboard',
        outcome: 'stale',
        reason: 'login-redirect',
      }),
    ]);
  });

  it('passes through a non-2xx QR JSON body while recording an HTTP error event', async () => {
    const { runtime, events } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const url = 'https://siap.undip.ac.id/master_perkuliahan/mhs/absensi/process/';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      url,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'error', message: 'QR expired' }),
    } as Response);

    await expect(seam.fetchJsonAllowingHttpErrors(url, { method: 'POST' })).resolves.toEqual({
      httpOk: false,
      status: 400,
      body: { status: 'error', message: 'QR expired' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap',
        operation: 'qr_presence',
        route: 'POST /master_perkuliahan/mhs/absensi/process/',
        outcome: 'http_error',
        reason: 'http-not-ok',
        status: 400,
      }),
    ]);
  });

  it('maps a QR redirect-loop transport to a 502 while retaining its marker', async () => {
    const { runtime, events } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const url = 'https://siap.undip.ac.id/master_perkuliahan/mhs/absensi/process/';
    const transport = Object.assign(new TypeError('fetch failed SECRET'), {
      cause: new Error('redirect count exceeded'),
    });
    jest.spyOn(global, 'fetch').mockRejectedValue(transport);

    await expect(seam.fetchJsonAllowingHttpErrors(url, { method: 'POST' })).rejects.toMatchObject({
      reason: 'fetch-threw',
      status: 502,
    });
    expect(getTimedFetchTransportReason(transport)).toBe('redirect-loop');
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap',
        operation: 'qr_presence',
        route: 'POST /master_perkuliahan/mhs/absensi/process/',
        outcome: 'network_error',
        reason: 'redirect-loop',
      }),
    ]);
  });

  it('maps a non-JSON QR process response to stale 401 with a parse event', async () => {
    const { runtime, events } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const url = 'https://siap.undip.ac.id/master_perkuliahan/mhs/absensi/process/';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => {
        throw new Error('not JSON SECRET');
      },
    } as unknown as Response);

    await expect(seam.fetchJsonAllowingHttpErrors(url, { method: 'POST' })).rejects.toMatchObject({
      reason: 'non-json-process',
      status: 401,
    });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap',
        operation: 'qr_presence',
        outcome: 'parse_error',
        reason: 'non-json-process',
      }),
    ]);
  });

  it('rejects a page URL outside the fixed SIAP origin before fetching', async () => {
    const { runtime } = recordingRuntime();
    const seam = new SiapUpstreamSession(undefined as never, undefined, undefined, undefined, runtime);
    const fetchMock = jest.spyOn(global, 'fetch');
    fetchMock.mockClear();
    await expect(seam.fetchText('https://evil.example/pages/mhs/dashboard')).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('probeForKeepAlive', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is valid when the dashboard carries the auth marker', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<div id="tabmhs_profile"></div>', { status: 200 }),
    );
    const { seam } = makeSeam({});
    await expect(seam.probeForKeepAlive('sia_app_session=OLD')).resolves.toEqual({
      valid: true,
      setCookies: [],
    });
  });

  it('is invalid on 401', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const { seam } = makeSeam({});
    await expect(seam.probeForKeepAlive('sia_app_session=OLD')).resolves.toEqual({
      valid: false,
      kind: 'invalid',
      setCookies: [],
    });
  });

  it('is rate-limited on 429', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    const { seam } = makeSeam({});
    await expect(seam.probeForKeepAlive('sia_app_session=OLD')).resolves.toEqual({
      valid: false,
      kind: 'rate-limited',
      setCookies: [],
    });
  });
});
