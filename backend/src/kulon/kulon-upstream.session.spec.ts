import { KulonUpstreamSession } from './kulon-upstream.session';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { isKulonCookieRenewal, sameCapturedSession, SessionStore } from '../session/session-store';
import type { CapturedSession } from '../playwright/playwright-auth.service';
import { DataCache } from '../cache/data-cache';
import { InMemoryDataCache } from '../cache/in-memory-data.cache';
import type { TelemetryRuntime } from '../observability/telemetry';

class FakeStore extends SessionStore {
  constructor(public map: Map<string, unknown>) {
    super();
  }
  set(k: string, v: CapturedSession): Promise<void> {
    this.map.set(k, v);
    return Promise.resolve();
  }
  get(k: string): Promise<CapturedSession | null> {
    return Promise.resolve(
      (this.map.get(k) as CapturedSession | undefined) ?? null,
    );
  }
  getIfGeneration(k: string, generation: string): Promise<CapturedSession | null> {
    const rec = (this.map.get(k) as CapturedSession | undefined) ?? null;
    if (!rec || rec.sessionGeneration !== generation) return Promise.resolve(null);
    return Promise.resolve(rec);
  }
  replaceIfUnchanged(
    k: string,
    generation: string,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'> {
    const rec = (this.map.get(k) as CapturedSession | undefined) ?? null;
    if (!rec || rec.sessionGeneration !== generation) return Promise.resolve('dead');
    if (!sameCapturedSession(rec, expected)) return Promise.resolve('conflict');
    if (!isKulonCookieRenewal(k, generation, expected, replacement)) {
      return Promise.reject(new Error('Invalid session renewal replacement'));
    }
    this.map.set(k, replacement);
    return Promise.resolve('updated');
  }
  clear(k: string): Promise<void> {
    this.map.delete(k);
    return Promise.resolve();
  }
  clearIfGeneration(k: string, generation: string): Promise<boolean> {
    const rec = this.map.get(k) as CapturedSession | undefined;
    if (!rec) return Promise.resolve(true);
    if (rec.sessionGeneration !== generation) return Promise.resolve(false);
    this.map.delete(k);
    return Promise.resolve(true);
  }
  all(): Promise<CapturedSession[]> {
    return Promise.resolve(
      Array.from(this.map.values()).map((value) => value as CapturedSession),
    );
  }
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
  const COOKIE_A = 'MoodleSession=AAA';
  const COOKIE_B = 'MoodleSession=BBB';
  let store: FakeStore;
  let cache: DataCache;

  beforeEach(() => {
    store = new FakeStore(
      new Map([['U1', { identity: 'U1', kulonCookie: COOKIE_A, sessionGeneration: GEN_A, capturedAt: Date.now() }]]),
    );
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
    const ctx = await (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_A });
    expect(ctx.cookie).toBe(COOKIE_A);
    expect(ctx.sesskey).toBe('skA');
  });

  it('reports a missing Kulon cookie as upstream stale while the backend session is live', async () => {
    store.map.set('U1', { kulonCookie: '', sessionGeneration: GEN_A, capturedAt: Date.now() });
    const seam = new KulonUpstreamSession(store, cache);
    await expect(seam.getContextForSession({ sub: 'U1', sessionGeneration: GEN_A }))
      .rejects.toMatchObject({ status: 401, reason: 'no-cookie' });
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
    store.map.set('U1', { kulonCookie: COOKIE_B, sessionGeneration: GEN_B, capturedAt: Date.now() });
    await expect(
      (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_A }),
    ).rejects.toMatchObject({ status: 401 });
    // Never touched upstream with either cookie (no B leak, no A use).
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('KulonUpstreamSession generation-scoped sesskey (findings 1+2)', () => {
  const GEN_A = 'a'.repeat(32);
  const GEN_B = 'b'.repeat(32);
  const SAME_COOKIE = 'MoodleSession=SAME';

  function scopedStore(cookie: string, generation: string) {
    return new FakeStore(
      new Map([['U1', { identity: 'U1', kulonCookie: cookie, sessionGeneration: generation, capturedAt: Date.now() }]]),
    );
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
    const ctxA = await (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_A });
    expect(ctxA.sesskey).toBe('skA');
    // Same cookie, new generation: must NOT reuse A's cached sesskey entry.
    store.map.set('U1', { identity: 'U1', kulonCookie: SAME_COOKIE, sessionGeneration: GEN_B, capturedAt: Date.now() });
    const ctxB = await (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_B });
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
    const pendingA = (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_A });
    // B replacement lands while A's /my/ fetch is still in flight.
    store.map.set('U1', { identity: 'U1', kulonCookie: SAME_COOKIE, sessionGeneration: GEN_B, capturedAt: Date.now() });
    const pendingB = (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_B });
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
    await (seam as any).getContextForSession({ sub: 'U1', sessionGeneration: GEN_A });
    const ctx = await seam.getContextForCurrent('U1');
    expect(ctx.sesskey).toBe('skA');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a legacy record without a generation is stale on the current path (never unscoped)', async () => {
    const store = new FakeStore(new Map([['U1', { identity: 'U1', kulonCookie: SAME_COOKIE }]]));
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
    store = new FakeStore(
      new Map([['2304012012345', { identity: '2304012012345', kulonCookie: cookie, sessionGeneration: 'c'.repeat(32) }]]),
    );
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
    store.map.set('2304012012345', { identity: '2304012012345', kulonCookie: cookie2, sessionGeneration: 'd'.repeat(32) });
    const ctx = await seam.getContext('2304012012345');
    expect(ctx.sesskey).toBe('sk2');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws stale 401 when no cookie in session store', async () => {
    const empty = new FakeStore(new Map());
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
