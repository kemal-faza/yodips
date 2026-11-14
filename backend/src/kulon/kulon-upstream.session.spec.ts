import { KulonUpstreamSession } from './kulon-upstream.session';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { isKulonCookieRenewal, sameCapturedSession, SessionStore } from '../session/session-store';
import type { CapturedSession, SessionRef } from '../session/session-contract';
import { DataCache } from '../cache/data-cache';
import { InMemoryDataCache } from '../cache/in-memory-data.cache';
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
  constructor(public map = new Map<string, CapturedSession>()) {
    super();
  }

  seed(session: CapturedSession): this {
    this.map.set(keyOf(session), session);
    return this;
  }

  set(session: CapturedSession): Promise<void> {
    this.seed(session);
    return Promise.resolve();
  }

  getIfGeneration(ref: SessionRef): Promise<CapturedSession | null> {
    const rec = this.map.get(`${ref.sub}:${ref.clientId}`) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return Promise.resolve(null);
    return Promise.resolve(rec);
  }

  replaceIfUnchanged(
    ref: SessionRef,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'> {
    const key = `${ref.sub}:${ref.clientId}`;
    const rec = this.map.get(key) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return Promise.resolve('dead');
    if (!sameCapturedSession(rec, expected)) return Promise.resolve('conflict');
    if (!isKulonCookieRenewal(ref, expected, replacement)) {
      return Promise.reject(new Error('Invalid session renewal replacement'));
    }
    this.map.set(key, replacement);
    return Promise.resolve('updated');
  }

  clearIfGeneration(ref: SessionRef): Promise<boolean> {
    const key = `${ref.sub}:${ref.clientId}`;
    const rec = this.map.get(key);
    if (!rec) return Promise.resolve(true);
    if (rec.sessionGeneration !== ref.sessionGeneration) return Promise.resolve(false);
    this.map.delete(key);
    return Promise.resolve(true);
  }

  listBySub(sub: string): Promise<CapturedSession[]> {
    return Promise.resolve([...this.map.values()].filter((s) => s.identity === sub));
  }

  clearAllForSub(sub: string): Promise<number> {
    let cleared = 0;
    for (const [key, session] of this.map) {
      if (session.identity !== sub) continue;
      this.map.delete(key);
      cleared += 1;
    }
    return Promise.resolve(cleared);
  }

  all(): Promise<CapturedSession[]> {
    return Promise.resolve([...this.map.values()]);
  }

  migrateLegacyKeys(): Promise<{ scanned: number; migrated: number }> {
    return Promise.resolve({ scanned: 0, migrated: 0 });
  }
}

function kulonSession(
  clientId: string,
  generation: string,
  overrides: Partial<CapturedSession> = {},
): CapturedSession {
  return {
    identity: 'U1',
    clientId,
    ssoCookie: '',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=AAA',
    siapCookie: '',
    capturedAt: Date.now(),
    sessionGeneration: generation,
    ...overrides,
  };
}

function storeOf(...sessions: CapturedSession[]): FakeStore {
  const store = new FakeStore();
  for (const session of sessions) store.seed(session);
  return store;
}

function htmlWithSesskey(sk: string) {
  return `<html><body><input type="hidden" name="sesskey" value="${sk}"/></body></html>`;
}

function recordingRuntime(): { runtime: TelemetryRuntime; events: unknown[] } {
  const events: unknown[] = [];
  let now = 0n;
  return {
    events,
    runtime: {
      sink: { record: (event) => events.push(event) },
      wallNowMs: () => 0,
      monotonicNowNs: () => {
        now += 1_000_000n;
        return now;
      },
    },
  };
}

describe('KulonUpstreamSession.ajax', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves dead-session HTTP failures as typed 401 errors', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      url: 'https://kulon2.undip.ac.id/login/index.php',
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(
      seam.ajax('cookie', 'sesskey', 'method', {}),
    ).rejects.toMatchObject({
      reason: 'http-not-ok',
    });
    await expect(
      seam.ajax('cookie', 'sesskey', 'method', {}),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  it('classifies AJAX network failures as typed transient errors', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('connection reset'));
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(
      seam.ajax('cookie', 'sesskey', 'method', {}),
    ).rejects.toMatchObject({
      reason: 'fetch-threw',
    });
    await expect(
      seam.ajax('cookie', 'sesskey', 'method', {}),
    ).rejects.toMatchObject({
      status: 502,
    });
  });

  it('parses application errors inside the timed ajax attempt and emits one safe event', async () => {
    const { runtime, events } = recordingRuntime();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/lib/ajax/service.php?sesskey=secret',
      json: async () => [
        { error: true, exception: { message: 'Web service is disabled' } },
      ],
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never, undefined, runtime);

    await expect(seam.ajax('cookie', 'secret', 'method', { courseid: 42 })).rejects.toMatchObject({
      reason: 'api-endpoint',
    });
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'kulon',
        operation: 'ajax',
        route: 'POST /lib/ajax/service.php',
        outcome: 'stale',
        reason: 'api-endpoint',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(JSON.stringify(events)).not.toContain('42');
  });

  it('records exactly one session-probe event for a valid sesskey page', async () => {
    const { runtime, events } = recordingRuntime();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: async () => htmlWithSesskey('sesskey'),
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never, undefined, runtime);

    await expect(seam.checkSessionValid('cookie')).resolves.toEqual({
      valid: true,
      reason: 'ok',
    });
    expect(events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'kulon',
        operation: 'session_probe',
        route: 'GET /my/',
        outcome: 'ok',
        status: 200,
      }),
    ]);
  });

  it('keeps sesskey transport failures as a 502 compatibility response with a reason', async () => {
    const { runtime, events } = recordingRuntime();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection reset'));
    const seam = new KulonUpstreamSession(undefined as never, undefined, runtime);

    await expect(seam.fetchSesskeyOrThrow('cookie')).rejects.toMatchObject({
      status: 502,
      response: { message: 'Gagal terhubung ke Kulon', detail: 'BAD_GATEWAY' },
      reason: 'fetch-threw',
    });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'kulon',
        operation: 'sesskey',
        route: 'GET /my/',
        outcome: 'network_error',
        reason: 'fetch-threw',
      }),
    ]);
  });

  it.each([401, 302, 503])(
    'keeps a non-ok sesskey response-less error at outward 401 (%i)',
    async (status) => {
      const { runtime, events } = recordingRuntime();
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status,
        url: 'https://kulon2.undip.ac.id/my/',
      } as unknown as Response);
      const seam = new KulonUpstreamSession(undefined as never, undefined, runtime);

      await expect(seam.fetchSesskeyOrThrow('cookie')).rejects.toMatchObject({
        status: 401,
        reason: 'http-not-ok',
      });
      expect(events).toEqual([
        expect.objectContaining({
          operation: 'sesskey',
          route: 'GET /my/',
          outcome: 'http_error',
          status,
          reason: 'http-not-ok',
        }),
      ]);
    },
  );
});

describe('KulonUpstreamSession.getContextForSession (B: generation-qualified TOCTOU seam)', () => {
  const GEN_A = 'a'.repeat(32);
  const GEN_B = 'b'.repeat(32);
  const CLIENT_A = 'client-a';
  const CLIENT_B = 'client-b';
  const COOKIE_A = 'MoodleSession=AAA';
  const COOKIE_B = 'MoodleSession=BBB';
  let store: FakeStore;
  let cache: DataCache;

  beforeEach(() => {
    store = storeOf(kulonSession(CLIENT_A, GEN_A, { kulonCookie: COOKIE_A }));
    cache = new InMemoryDataCache(60_000);
    jest.restoreAllMocks();
  });

  it('resolves the cookie for the exact live generation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('skA')),
    } as unknown as Response);
    const seam = new KulonUpstreamSession(store, cache);
    const ctx = await (seam as any).getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_A,
    });
    expect(ctx.cookie).toBe(COOKIE_A);
    expect(ctx.sesskey).toBe('skA');
  });

  it('a record from another device cannot satisfy the ref', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const seam = new KulonUpstreamSession(store, cache);
    await expect(
      seam.getContextForSession({
        sub: 'U1',
        clientId: CLIENT_B,
        sessionGeneration: GEN_A,
      }),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
    // No upstream call with either device's cookie material.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a missing Kulon cookie as upstream stale while the backend session is live', async () => {
    store.seed(kulonSession(CLIENT_A, GEN_A, { kulonCookie: '' }));
    const seam = new KulonUpstreamSession(store, cache);
    await expect(seam.getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_A,
    })).rejects.toMatchObject({ status: 401, reason: 'no-cookie' });
  });

  it('replacement between guard and service read rejects SESSION_DEAD and never returns B cookie to an A-token', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('skB')),
    } as unknown as Response);
    const seam = new KulonUpstreamSession(store, cache);
    // Guard validated A (live at that moment). Re-login replaces with B before
    // the service/upstream read.
    store.seed(kulonSession(CLIENT_A, GEN_B, { kulonCookie: COOKIE_B }));
    await expect(
      (seam as any).getContextForSession({
        sub: 'U1',
        clientId: CLIENT_A,
        sessionGeneration: GEN_A,
      }),
    ).rejects.toMatchObject({ status: 401 });
    // Never touched upstream with either cookie (no B leak, no A use).
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('KulonUpstreamSession generation-scoped sesskey (findings 1+2)', () => {
  const GEN_A = 'a'.repeat(32);
  const GEN_B = 'b'.repeat(32);
  const CLIENT_A = 'client-a';
  const CLIENT_B = 'client-b';
  const SAME_COOKIE = 'MoodleSession=SAME';

  function scopedStore(cookie: string, generation: string) {
    return storeOf(kulonSession(CLIENT_A, generation, { kulonCookie: cookie }));
  }

  afterEach(() => jest.restoreAllMocks());

  it('sesskey entries are generation-scoped: the same cookie under A->B refetches (no cross-generation reuse)', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/my/',
        text: () => Promise.resolve(htmlWithSesskey('skA')),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/my/',
        text: () => Promise.resolve(htmlWithSesskey('skB')),
      } as unknown as Response);
    const store = scopedStore(SAME_COOKIE, GEN_A);
    const seam = new KulonUpstreamSession(store, new InMemoryDataCache(60_000));
    const ctxA = await (seam as any).getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_A,
    });
    expect(ctxA.sesskey).toBe('skA');
    // Same cookie, new generation: must NOT reuse A's cached sesskey entry.
    store.seed(kulonSession(CLIENT_A, GEN_B, { kulonCookie: SAME_COOKIE }));
    const ctxB = await (seam as any).getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_B,
    });
    expect(ctxB.sesskey).toBe('skB');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('concurrent A + B sesskey resolves never join one flight', async () => {
    let releaseA!: (v: Response) => void;
    const gateA = new Promise<Response>((resolve) => { releaseA = resolve; });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockReturnValueOnce(gateA)
      .mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/my/',
        text: () => Promise.resolve(htmlWithSesskey('skB')),
      } as unknown as Response);
    const store = scopedStore(SAME_COOKIE, GEN_A);
    const seam = new KulonUpstreamSession(store, new InMemoryDataCache(60_000));
    const pendingA = (seam as any).getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_A,
    });
    // B replacement lands while A's /my/ fetch is still in flight.
    store.seed(kulonSession(CLIENT_A, GEN_B, { kulonCookie: SAME_COOKIE }));
    const pendingB = (seam as any).getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_B,
    });
    releaseA({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('skA')),
    } as unknown as Response);
    const [ctxA, ctxB] = await Promise.all([pendingA, pendingB]);
    expect(ctxA.sesskey).toBe('skA');
    expect(ctxB.sesskey).toBe('skB');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('getContextForCurrent shares the live generation scoped entry (0 extra fetches)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('skA')),
    } as unknown as Response);
    const store = scopedStore(SAME_COOKIE, GEN_A);
    const seam = new KulonUpstreamSession(store, new InMemoryDataCache(60_000));
    await (seam as any).getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_A,
    });
    const ctx = await seam.getContextForCurrent('U1');
    expect(ctx.sesskey).toBe('skA');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves the current context from the newest live device record', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('skNew')),
    } as unknown as Response);
    const older = kulonSession(CLIENT_B, GEN_B, {
      kulonCookie: 'MoodleSession=OLD',
      capturedAt: Date.now() - 1_000,
    });
    const newer = kulonSession(CLIENT_A, GEN_A, {
      kulonCookie: 'MoodleSession=NEW',
      capturedAt: Date.now(),
    });
    const store = storeOf(older, newer);
    const listSpy = jest.spyOn(store, 'listBySub');
    const seam = new KulonUpstreamSession(store, new InMemoryDataCache(60_000));

    // Prime the newer device's generation-scoped entry, then prove the current
    // read lands on it (same key) instead of the older device or a refetch.
    await seam.getContextForSession({
      sub: 'U1',
      clientId: CLIENT_A,
      sessionGeneration: GEN_A,
    });
    const ctx = await seam.getContextForCurrent('U1');

    expect(ctx.cookie).toBe(newer.kulonCookie);
    expect(ctx.sesskey).toBe('skNew');
    expect(listSpy).toHaveBeenCalledWith('U1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to an older device when the newest record has no Kulon cookie', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('skOld')),
    } as unknown as Response);
    const older = kulonSession(CLIENT_B, GEN_B, {
      kulonCookie: 'MoodleSession=OLD',
      capturedAt: Date.now() - 1_000,
    });
    const newer = kulonSession(CLIENT_A, GEN_A, {
      kulonCookie: '',
      capturedAt: Date.now(),
    });
    const store = storeOf(older, newer);
    const seam = new KulonUpstreamSession(store, new InMemoryDataCache(60_000));

    const ctx = await seam.getContextForCurrent('U1');

    expect(ctx.cookie).toBe(older.kulonCookie);
    expect(ctx.sesskey).toBe('skOld');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a legacy record without a generation is stale on the current path (never unscoped)', async () => {
    const store = storeOf({
      identity: 'U1',
      clientId: CLIENT_A,
      kulonCookie: SAME_COOKIE,
    } as CapturedSession);
    const seam = new KulonUpstreamSession(store, new InMemoryDataCache(60_000));
    await expect(seam.getContextForCurrent('U1')).rejects.toMatchObject({ reason: 'no-cookie' });
  });
});

describe('KulonUpstreamSession.getContext', () => {
  let store: FakeStore;
  let cache: DataCache;
  const cookie = 'MoodleSession=abc123';
  const cookie2 = 'MoodleSession=xyz999';

  beforeEach(() => {
    store = storeOf(kulonSession('client-a', 'c'.repeat(32), {
      identity: '2304012012345',
      kulonCookie: cookie,
    }));
    cache = new InMemoryDataCache(60_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches sesskey on cold cache, reuses cached on warm (1 upstream fetch)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('sk1')),
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
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: () => Promise.resolve(htmlWithSesskey('sk1')),
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
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/my/',
        text: () => Promise.resolve(htmlWithSesskey('sk1')),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://kulon2.undip.ac.id/my/',
        text: () => Promise.resolve(htmlWithSesskey('sk2')),
      } as unknown as Response);
    const seam = new KulonUpstreamSession(store, cache);

    await seam.getContext('2304012012345');
    store.seed(kulonSession('client-a', 'd'.repeat(32), {
      identity: '2304012012345',
      kulonCookie: cookie2,
    }));
    const ctx = await seam.getContext('2304012012345');
    expect(ctx.sesskey).toBe('sk2');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws stale 401 when no cookie in session store', async () => {
    const empty = new FakeStore();
    const seam = new KulonUpstreamSession(empty, cache);
    await expect(seam.getContext('nobody')).rejects.toMatchObject({
      reason: 'no-cookie',
    });
  });
});

describe('KulonUpstreamSession.ajaxMany', () => {
  const BATCH_URL =
    'https://kulon2.undip.ac.id/lib/ajax/service.php?sesskey=sk';

  afterEach(() => jest.restoreAllMocks());

  function okBatch(payload: unknown, headers?: Headers): Response {
    return {
      ok: true,
      status: 200,
      url: BATCH_URL,
      headers,
      json: async () => payload,
    } as unknown as Response;
  }

  const twoRequests = [
    { methodname: 'core_courseformat_get_state', args: { courseid: 1 } },
    { methodname: 'core_courseformat_get_state', args: { courseid: 2 } },
  ];

  it('indexes every entry 0..N-1 itself, ignoring caller-supplied indexes', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        okBatch([
          { error: false, data: 'first' },
          { error: false, data: 'second' },
        ]),
      );
    const seam = new KulonUpstreamSession(undefined as never);
    const requests = [
      { methodname: 'core_courseformat_get_state', args: { courseid: 1 }, index: 9 },
      { methodname: 'core_courseformat_get_state', args: { courseid: 2 } },
    ];

    await seam.ajaxMany('cookie', 'sk', requests);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BATCH_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Cookie).toBe('cookie');
    expect(JSON.parse(String(init.body))).toEqual([
      { index: 0, methodname: 'core_courseformat_get_state', args: { courseid: 1 } },
      { index: 1, methodname: 'core_courseformat_get_state', args: { courseid: 2 } },
    ]);
  });

  it('maps positional results, keeping a string payload verbatim and entry errors typed', async () => {
    const stateString = '{"section":[{"number":0,"title":"General"}]}';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      okBatch([
        { error: false, data: stateString },
        { error: true, exception: { errorcode: 'invalidparameter', message: 'Invalid course id' } },
      ]),
    );
    const seam = new KulonUpstreamSession(undefined as never);

    const batch = await seam.ajaxMany('cookie', 'sk', twoRequests);

    expect(batch.status).toBe(200);
    expect(batch.results).toEqual([
      { error: false, errorcode: null, message: null, data: stateString },
      { error: true, errorcode: 'invalidparameter', message: 'Invalid course id', data: undefined },
    ]);
  });

  it('returns a shorter-than-requested response as a prefix instead of throwing', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okBatch([{ error: false, data: 'only-entry' }]));
    const seam = new KulonUpstreamSession(undefined as never);

    const batch = await seam.ajaxMany('cookie', 'sk', [
      ...twoRequests,
      { methodname: 'core_courseformat_get_state', args: { courseid: 3 } },
    ]);

    expect(batch.results).toHaveLength(1);
    expect(batch.results[0]).toEqual({
      error: false,
      errorcode: null,
      message: null,
      data: 'only-entry',
    });
  });

  it('preserves the ajax() dead-session classification for non-ok responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      url: 'https://kulon2.undip.ac.id/login/index.php',
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(seam.ajaxMany('cookie', 'sk', twoRequests)).rejects.toMatchObject({
      reason: 'http-not-ok',
    });
    await expect(seam.ajaxMany('cookie', 'sk', twoRequests)).rejects.toBeInstanceOf(
      StaleUpstreamError,
    );
  });

  it('classifies a login redirect as a typed stale error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/login/index.php',
      json: async () => [],
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(seam.ajaxMany('cookie', 'sk', twoRequests)).rejects.toMatchObject({
      reason: 'login-redirect',
    });
  });

  it('classifies an unparseable body as malformed-json', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: BATCH_URL,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(seam.ajaxMany('cookie', 'sk', twoRequests)).rejects.toMatchObject({
      reason: 'malformed-json',
    });
  });

  it('classifies an html body as html-content-type', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: BATCH_URL,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response);
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(seam.ajaxMany('cookie', 'sk', twoRequests)).rejects.toMatchObject({
      reason: 'html-content-type',
    });
  });

  it('classifies a non-array batch body as an api-endpoint failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okBatch({ 0: { error: false, data: 1 } }));
    const seam = new KulonUpstreamSession(undefined as never);

    await expect(seam.ajaxMany('cookie', 'sk', twoRequests)).rejects.toMatchObject({
      reason: 'api-endpoint',
    });
  });
});

describe('probeForKeepAlive', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns invalid when the page has no sesskey marker', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<html><body>login</body></html>', { status: 200 }),
    );
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: false,
      kind: 'invalid',
      setCookies: [],
    });
  });

  it('is valid on a logged-in page carrying name="sesskey"', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<input type="hidden" name="sesskey" value="abc">', {
        status: 200,
      }),
    );
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: true,
      setCookies: [],
    });
  });

  it('rejects a 200 login page whose JS config mentions sesskey', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        '<body id="page-login-index"><script>M.cfg={"sesskey":"abc"};</script></body>',
        { status: 200 },
      ),
    );
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: false,
      kind: 'invalid',
      setCookies: [],
    });
  });

  it('stops at a redirect into /login/ without following it', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 303,
        headers: {
          location: '/login/index.php',
          'set-cookie': 'MoodleSession=ANON; Path=/',
        },
      }),
    );
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: false,
      kind: 'invalid',
      setCookies: ['MoodleSession=ANON; Path=/'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns rate-limited on 429', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: false,
      kind: 'rate-limited',
      setCookies: [],
    });
  });

  it('returns transient on 503', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: false,
      kind: 'transient',
      setCookies: [],
    });
  });

  it('returns transient on a network failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection reset'));
    const svc = new KulonUpstreamSession(undefined as never);
    await expect(svc.probeForKeepAlive('MoodleSession=OLD')).resolves.toEqual({
      valid: false,
      kind: 'transient',
      setCookies: [],
    });
  });
});
