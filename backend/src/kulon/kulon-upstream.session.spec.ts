import { KulonUpstreamSession } from './kulon-upstream.session';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { SessionStore } from '../session/session-store';
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
  clear(k: string): Promise<void> {
    this.map.delete(k);
    return Promise.resolve();
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
    const seam = new KulonUpstreamSession();

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
    const seam = new KulonUpstreamSession();

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
    const seam = new KulonUpstreamSession(undefined, undefined, runtime);

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
    const seam = new KulonUpstreamSession(undefined, undefined, runtime);

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
    const seam = new KulonUpstreamSession(undefined, undefined, runtime);

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
      const seam = new KulonUpstreamSession(undefined, undefined, runtime);

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

describe('KulonUpstreamSession.getContext', () => {
  let store: FakeStore;
  let cache: DataCache;
  const cookie = 'MoodleSession=abc123';
  const cookie2 = 'MoodleSession=xyz999';

  beforeEach(() => {
    store = new FakeStore(
      new Map([['2304012012345', { kulonCookie: cookie }]]),
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
    store.map.set('2304012012345', { kulonCookie: cookie2 });
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
