import 'reflect-metadata';
import {
  classifyUpstreamResponse,
  classifyUpstreamFetch,
  getTimedFetchTransportReason,
  isLoginRedirect,
  isRedirectLoopCause,
  isStaleUpstreamError,
  KULON_SESSION_PROBE,
  SIAP_SESSION_PROBE,
  StaleUpstreamError,
  timedFetch,
  upstreamFetchJson,
  upstreamFetchText,
  validateUpstreamAttempt,
  probeUpstreamSession,
} from './upstream-fetch';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { TelemetryRuntime } from '../observability/telemetry';
import {
  UPSTREAM_ROUTES,
  type UpstreamRoute,
} from '../observability/telemetry-contract';

/** Minimal Response-like stub: only the fields the scaffold reads. */
function resStub(opts: {
  ok?: boolean;
  status?: number;
  url?: string;
  contentType?: string;
  text?: string;
  json?: unknown;
}): Response {
  const body = opts.text ?? '';
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    url: opts.url ?? '',
    headers: new Headers({ 'content-type': opts.contentType ?? 'text/html' }),
    text: async () => body,
    json: async () => {
      if (opts.json !== undefined) return opts.json;
      return JSON.parse(body);
    },
    clone() {
      return resStub(opts);
    },
  } as unknown as Response;
}

afterEach(() => jest.restoreAllMocks());

function recordingRuntime(times: bigint[] = [0n, 4_000_000n]): TelemetryRuntime & {
  events: unknown[];
} {
  let clockIndex = 0;
  const events: unknown[] = [];
  return {
    events,
    sink: { record: (event) => events.push(event) },
    wallNowMs: () => 0,
    monotonicNowNs: () => times[Math.min(clockIndex++, times.length - 1)],
  };
}

function inventoryRoute(
  service: UpstreamRoute['service'],
  operation: string,
): UpstreamRoute {
  const context = UPSTREAM_ROUTES.find(
    (candidate) => candidate.service === service && candidate.operation === operation,
  );
  if (!context) throw new Error('test route missing from inventory');
  return context;
}

describe('isLoginRedirect', () => {
  it('matches /login variants and Microsoft OIDC host', () => {
    expect(isLoginRedirect('https://siap.undip.ac.id/login')).toBe(true);
    expect(isLoginRedirect('https://siap.undip.ac.id/login/')).toBe(true);
    expect(isLoginRedirect('https://kulon2.undip.ac.id/login/index.php')).toBe(
      true,
    );
    expect(isLoginRedirect('https://login.microsoftonline.com/x')).toBe(true);
  });

  it('does not match normal pages or login-ish substrings', () => {
    expect(
      isLoginRedirect('https://siap.undip.ac.id/pages/mhs/dashboard'),
    ).toBe(false);
    expect(isLoginRedirect('https://kulon2.undip.ac.id/my/')).toBe(false);
    expect(isLoginRedirect('https://x/logins')).toBe(false);
    expect(isLoginRedirect(undefined)).toBe(false);
  });
});

describe('isRedirectLoopCause', () => {
  it('detects the undici redirect-count-exceeded cause chain', () => {
    const err = new Error('fetch failed');
    (err as Error & { cause?: unknown }).cause = {
      message: 'redirect count exceeded',
    };
    expect(isRedirectLoopCause(err)).toBe(true);
  });

  it('false for other errors', () => {
    expect(isRedirectLoopCause(new Error('ECONNRESET'))).toBe(false);
    expect(isRedirectLoopCause(null)).toBe(false);
  });
});

describe('StaleUpstreamError', () => {
  it('is a 401 HttpException with the uniform per-service message', () => {
    const e = new StaleUpstreamError('Siap', 'login-redirect');
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((e.getResponse() as { message: string }).message).toContain(
      'Session SIAP expired',
    );
    expect(e.reason).toBe('login-redirect');
  });

  it('carries a custom message when given (Kulon gangguan case)', () => {
    const e = new StaleUpstreamError(
      'Kulon',
      'http-not-ok',
      'Kulon mengalami gangguan. Silakan login ulang via SSO',
    );
    expect(e.message).toBe(
      'Kulon mengalami gangguan. Silakan login ulang via SSO',
    );
  });

  // RED (fix relogin-loop): gangguan upstream yang SEMENTARA bukan sesi mati —
  // klien tidak boleh dipaksa re-login karena 401 palsu. Transport memetakan
  // reason transient ke 502 sedangkan bukti sesi mati tetap 401.
  it('maps transient reasons (fetch-threw, api-endpoint) to 502', () => {
    expect(new StaleUpstreamError('Siap', 'fetch-threw').getStatus()).toBe(
      HttpStatus.BAD_GATEWAY,
    );
    expect(new StaleUpstreamError('Siap', 'api-endpoint').getStatus()).toBe(
      HttpStatus.BAD_GATEWAY,
    );
  });

  it('maps upstream 5xx (http-not-ok) to 502, upstream 4xx stays 401', () => {
    const e5xx = new StaleUpstreamError('Siap', 'http-not-ok', 'msg', {
      status: 503,
    } as Response);
    expect(e5xx.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const e4xx = new StaleUpstreamError('Siap', 'http-not-ok', 'msg', {
      status: 403,
    } as Response);
    expect(e4xx.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('keeps dead-session evidence at 401 (login-redirect, no-cookie, api-credential)', () => {
    expect(new StaleUpstreamError('Siap', 'login-redirect').getStatus()).toBe(
      HttpStatus.UNAUTHORIZED,
    );
    expect(new StaleUpstreamError('Siap', 'no-cookie').getStatus()).toBe(
      HttpStatus.UNAUTHORIZED,
    );
    expect(new StaleUpstreamError('Siap', 'api-credential').getStatus()).toBe(
      HttpStatus.UNAUTHORIZED,
    );
  });
});

describe('isStaleUpstreamError', () => {
  it('true for StaleUpstreamError', () => {
    expect(isStaleUpstreamError(new StaleUpstreamError('Siap'))).toBe(true);
  });

  it('stays true for any 401 HttpException (back-compat with poller)', () => {
    expect(
      isStaleUpstreamError(
        new HttpException({ message: 'x' }, HttpStatus.UNAUTHORIZED),
      ),
    ).toBe(true);
  });

  it('false for other statuses and plain errors', () => {
    expect(
      isStaleUpstreamError(
        new HttpException({ message: 'x' }, HttpStatus.BAD_GATEWAY),
      ),
    ).toBe(false);
    expect(isStaleUpstreamError(new Error('nope'))).toBe(false);
    expect(isStaleUpstreamError(null)).toBe(false);
  });
});

describe('classifyUpstreamFetch', () => {
  it('routes arbitrary legacy URLs through the timed transport seam', async () => {
    let fetchStack = '';
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      fetchStack = new Error().stack ?? '';
      return resStub({ text: '<html>legacy</html>' });
    });

    await expect(
      classifyUpstreamFetch('https://up.test/legacy/arbitrary', { method: 'GET' }),
    ).resolves.toEqual(expect.objectContaining({ kind: 'ok' }));

    expect(fetchStack).toMatch(/timedFetch/);
    expect(fetchStack).not.toMatch(/classifyUpstreamFetch/);
  });

  it('classifies an existing response without performing another fetch', () => {
    const fetch = jest.spyOn(global, 'fetch');
    const out = classifyUpstreamResponse(
      resStub({ url: 'https://siap.undip.ac.id/login/' }),
    );

    expect(out.kind).toBe('stale');
    expect(out.reason).toBe('login-redirect');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('network throw → gateway (caller picks stale vs 502 policy)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const out = await classifyUpstreamFetch('https://up.test/x', {});
    expect(out.kind).toBe('gateway');
    expect(out.reason).toBe('fetch-threw');
    expect(out).not.toHaveProperty('networkMessage');
  });

  it('redirect-loop throw → classified, not gateway', async () => {
    const err = new Error('fetch failed');
    (err as Error & { cause?: unknown }).cause = {
      message: 'redirect count exceeded',
    };
    jest.spyOn(global, 'fetch').mockRejectedValue(err);
    const out = await classifyUpstreamFetch('https://up.test/my/', {});
    expect(out.kind).toBe('stale');
    expect(out.reason).toBe('redirect-loop');
  });

  it('!ok → stale http-not-ok with response attached', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 500 }));
    const out = await classifyUpstreamFetch('https://up.test/x', {});
    expect(out.kind).toBe('stale');
    expect(out.reason).toBe('http-not-ok');
    expect(out.res?.status).toBe(500);
  });

  it('ok but final URL on /login → stale login-redirect', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ url: 'https://siap.undip.ac.id/login/' }));
    const out = await classifyUpstreamFetch('https://up.test/dashboard', {});
    expect(out.kind).toBe('stale');
    expect(out.reason).toBe('login-redirect');
  });

  it('ok page → ok with response attached', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ text: '<html>dashboard</html>' }));
    const out = await classifyUpstreamFetch('https://up.test/dashboard', {});
    expect(out.kind).toBe('ok');
    expect(await out.res!.text()).toContain('dashboard');
  });
});

describe('timedFetch', () => {
  it('records one safe terminal event after consuming a successful body', async () => {
    const runtime = recordingRuntime();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({
        url: 'https://kulon2.undip.ac.id/my/',
        text: 'page',
      }),
    );

    const value = await timedFetch(
      runtime,
      KULON_SESSION_PROBE,
      'https://kulon2.undip.ac.id/my/?x=secret',
      {},
      async (response) => ({
        ok: true,
        value: await response.text(),
        outcome: 'ok',
      }),
    );

    expect(value).toBe('page');
    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        service: 'kulon',
        operation: 'session_probe',
        route: 'GET /my/',
        outcome: 'ok',
        status: 200,
        durationMs: 4,
      }),
    ]);
    expect(JSON.stringify(runtime.events)).not.toContain('?x=secret');
  });

  it('records HTTP errors and rethrows the consumer error unchanged', async () => {
    const runtime = recordingRuntime();
    const error = new StaleUpstreamError('Kulon', 'http-not-ok');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 503 }));

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, 'https://kulon2.undip.ac.id/my/', {}, async (response) => ({
        ok: false,
        error,
        outcome: 'http_error',
        reason: 'http-not-ok',
        status: response.status,
      })),
    ).rejects.toBe(error);

    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'http_error',
        reason: 'http-not-ok',
        status: 503,
        durationMs: 4,
      }),
    ]);
  });

  it('marks a raw network throw without exposing its message', async () => {
    const runtime = recordingRuntime();
    const error = new Error('ECONNRESET secret=never-log');
    jest.spyOn(global, 'fetch').mockRejectedValue(error);

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, 'https://kulon2.undip.ac.id/my/', {}, async () => ({
        ok: true,
        value: 'unreachable',
        outcome: 'ok',
      })),
    ).rejects.toBe(error);

    expect(getTimedFetchTransportReason(error)).toBe('fetch-threw');
    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'network_error',
        reason: 'fetch-threw',
        durationMs: 4,
      }),
    ]);
    expect(JSON.stringify(runtime.events)).not.toContain('ECONNRESET');
  });

  it('marks redirect-loop transport failures distinctly', async () => {
    const runtime = recordingRuntime();
    const error = new Error('fetch failed');
    (error as Error & { cause?: unknown }).cause = {
      message: 'redirect count exceeded',
    };
    jest.spyOn(global, 'fetch').mockRejectedValue(error);

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, 'https://kulon2.undip.ac.id/my/', {}, async () => ({
        ok: true,
        value: 'unreachable',
        outcome: 'ok',
      })),
    ).rejects.toBe(error);

    expect(getTimedFetchTransportReason(error)).toBe('redirect-loop');
    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'network_error',
        reason: 'redirect-loop',
      }),
    ]);
  });

  it('records malformed JSON as parse_error without body evidence', async () => {
    const runtime = recordingRuntime();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({
        url: 'https://kulon2.undip.ac.id/my/',
        contentType: 'application/json',
        text: 'not-json{secret-body}',
      }),
    );

    await expect(
      upstreamFetchJson(
        runtime,
        KULON_SESSION_PROBE,
        'https://kulon2.undip.ac.id/my/',
        {},
      ),
    ).rejects.toBeInstanceOf(StaleUpstreamError);

    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'parse_error',
        reason: 'malformed-json',
        status: 200,
      }),
    ]);
    expect(JSON.stringify(runtime.events)).not.toContain('secret-body');
  });

  it('records an expected stale result exactly once', async () => {
    const runtime = recordingRuntime();
    const error = new StaleUpstreamError('Kulon', 'login-redirect');
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({ url: 'https://kulon2.undip.ac.id/login/' }),
    );

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, 'https://kulon2.undip.ac.id/my/', {}, async () => ({
        ok: false,
        error,
        outcome: 'stale',
        reason: 'login-redirect',
        status: 200,
      })),
    ).rejects.toBe(error);

    expect(runtime.events).toHaveLength(1);
    expect(runtime.events[0]).toEqual(
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'stale',
        reason: 'login-redirect',
        status: 200,
      }),
    );
  });

  it('records an unexpected consumer throw as parse_error/unknown', async () => {
    const runtime = recordingRuntime();
    const error = new Error('consumer failure must be rethrown');
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({ url: 'https://kulon2.undip.ac.id/my/' }),
    );

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, 'https://kulon2.undip.ac.id/my/', {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'parse_error',
        reason: 'unknown',
        status: 200,
      }),
    ]);
  });

  it('turns a mismatched consumer status into parse_error/unknown', async () => {
    const runtime = recordingRuntime();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({ url: 'https://kulon2.undip.ac.id/my/', status: 200 }),
    );

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, 'https://kulon2.undip.ac.id/my/', {}, async () => ({
        ok: true,
        value: 'value',
        outcome: 'ok',
        status: 201,
      })),
    ).rejects.toThrow();

    expect(runtime.events).toEqual([
      expect.objectContaining({
        event: 'upstream.request',
        outcome: 'parse_error',
        reason: 'unknown',
        status: 200,
      }),
    ]);
  });

  it('rejects invalid route context before calling fetch', async () => {
    const runtime = recordingRuntime();
    const fetch = jest.spyOn(global, 'fetch');
    const invalidContext = {
      ...KULON_SESSION_PROBE,
      route: 'GET /not-in-inventory/',
    } as never;

    await expect(
      timedFetch(runtime, invalidContext, 'https://kulon2.undip.ac.id/my/', {}, async () => ({
        ok: true,
        value: 'unreachable',
        outcome: 'ok',
      })),
    ).rejects.toThrow('Invalid upstream route context');

    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.events).toHaveLength(0);
  });

  it.each([
    ['foreign host', 'https://siap.undip.ac.id/my/'],
    ['loopback origin', 'http://127.0.0.1/my/'],
  ])('rejects %s before calling fetch', async (_label, url) => {
    const runtime = recordingRuntime();
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ url: 'https://kulon2.undip.ac.id/my/' }));

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, url, {}, async () => ({
        ok: true,
        value: 'unreachable',
        outcome: 'ok',
      })),
    ).rejects.toThrow('Upstream URL origin is not allowed');

    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.events).toHaveLength(0);
  });

  it.each([
    [
      'kulon',
      KULON_SESSION_PROBE,
      'https://kulon2.undip.ac.id/my/',
      'GET',
    ],
    [
      'siap',
      SIAP_SESSION_PROBE,
      'https://siap.undip.ac.id/pages/mhs/dashboard',
      'GET',
    ],
    [
      'siap-api',
      inventoryRoute('siap-api', 'mintToken'),
      'https://api.siap.undip.ac.id/index.php/mahasiswa_sso',
      'POST',
    ],
    [
      'sso',
      inventoryRoute('sso', 'login_page'),
      'https://sso.undip.ac.id/auth/user/login',
      'GET',
    ],
    [
      'microsoft',
      {
        ...inventoryRoute('microsoft', 'token_exchange'),
        tenantId: 'tenant-a',
      },
      'https://login.microsoftonline.com/tenant-a/oauth2/v2.0/token',
      'POST',
    ],
    [
      'microsoft common tenant',
      {
        ...inventoryRoute('microsoft', 'token_exchange'),
        tenantId: 'common',
      },
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      'POST',
    ],
    [
      'microsoft organizations tenant',
      {
        ...inventoryRoute('microsoft', 'token_exchange'),
        tenantId: 'organizations',
      },
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      'POST',
    ],
    [
      'microsoft domain tenant',
      {
        ...inventoryRoute('microsoft', 'token_exchange'),
        tenantId: 'contoso.onmicrosoft.com',
      },
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
      'POST',
    ],
  ])('accepts the exact trusted %s origin', (_label, context, url, method) => {
    expect(validateUpstreamAttempt(context, url, method)).toEqual({
      service: context.service,
      operation: context.operation,
      route: context.route,
    });
  });

  it.each([
    ['trusted host over HTTP', 'http://kulon2.undip.ac.id/my/'],
    ['trusted host on a non-default port', 'https://kulon2.undip.ac.id:8443/my/'],
  ])('rejects %s before calling fetch', async (_label, url) => {
    const runtime = recordingRuntime();
    const fetch = jest.spyOn(global, 'fetch');

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, url, {}, async () => ({
        ok: true,
        value: 'unreachable',
        outcome: 'ok',
      })),
    ).rejects.toThrow('Upstream URL origin is not allowed');

    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.events).toHaveLength(0);
  });

  it.each([
    ['method', 'https://kulon2.undip.ac.id/my/', { method: 'POST' }],
    ['path', 'https://kulon2.undip.ac.id/other/', {}],
  ])('rejects invalid route %s before calling fetch', async (_label, url, init) => {
    const runtime = recordingRuntime();
    const fetch = jest.spyOn(global, 'fetch');

    await expect(
      timedFetch(runtime, KULON_SESSION_PROBE, url, init, async () => ({
        ok: true,
        value: 'unreachable',
        outcome: 'ok',
      })),
    ).rejects.toThrow('Upstream URL does not match route context');

    expect(fetch).not.toHaveBeenCalled();
    expect(runtime.events).toHaveLength(0);
  });

  describe('Microsoft tenant token routes', () => {
    const context = {
      ...inventoryRoute('microsoft', 'token_exchange'),
      tenantId: 'tenant-a',
    };
    const tokenUrl =
      'https://login.microsoftonline.com/tenant-a/oauth2/v2.0/token';

    it('accepts the configured tenant URL and passes it to fetch', async () => {
      const runtime = recordingRuntime();
      const fetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(resStub({ status: 200, url: tokenUrl }));

      await expect(
        timedFetch(runtime, context, tokenUrl, { method: 'POST' }, async (response) => ({
          ok: true,
          value: 'ok',
          outcome: 'ok',
          status: response.status,
        })),
      ).resolves.toBe('ok');

      expect(fetch).toHaveBeenCalledWith(tokenUrl, { method: 'POST' });
      expect(runtime.events).toEqual([
        expect.objectContaining({
          event: 'upstream.request',
          service: 'microsoft',
          operation: 'token_exchange',
          route: 'POST /oauth2/v2.0/token',
          outcome: 'ok',
          status: 200,
          durationMs: 4,
        }),
      ]);
    });

    it.each([
      ['wrong tenant', 'https://login.microsoftonline.com/tenant-b/oauth2/v2.0/token'],
      ['dot traversal', 'https://login.microsoftonline.com/tenant-a/../oauth2/v2.0/token'],
      ['encoded slash', 'https://login.microsoftonline.com/tenant-a%2Fother/oauth2/v2.0/token'],
      ['encoded dot', 'https://login.microsoftonline.com/%2e%2e/oauth2/v2.0/token'],
      ['wrong origin', 'https://evil.example/tenant-a/oauth2/v2.0/token'],
    ])('rejects %s before network', async (_label, url) => {
      const runtime = recordingRuntime();
      const fetch = jest.spyOn(global, 'fetch');

      await expect(
        timedFetch(runtime, context, url, { method: 'POST' }, async () => ({
          ok: true,
          value: 'unreachable',
          outcome: 'ok',
        })),
      ).rejects.toThrow();

      expect(fetch).not.toHaveBeenCalled();
      expect(runtime.events).toHaveLength(0);
    });

    it.each(['.', '..', 'tenant/a', 'tenant%2Fa', 'tenant%2ea'])(
      'rejects unsafe configured tenant segment %s before network',
      async (tenantId) => {
        const unsafeContext = {
          ...inventoryRoute('microsoft', 'token_exchange'),
          tenantId,
        };
        const runtime = recordingRuntime();
        const fetch = jest.spyOn(global, 'fetch');

        await expect(
          timedFetch(
            runtime,
            unsafeContext,
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            { method: 'POST' },
            async () => ({ ok: true, value: 'unreachable', outcome: 'ok' }),
          ),
        ).rejects.toThrow();

        expect(fetch).not.toHaveBeenCalled();
        expect(runtime.events).toHaveLength(0);
      },
    );
  });
});

describe('upstreamFetchText', () => {
  it('returns body text on ok page', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(resStub({ text: 'PAGE' }));
    const out = await upstreamFetchText('https://up.test/x', {}, 'Siap');
    expect(out).toBe('PAGE');
  });

  it('maps every failure to StaleUpstreamError with default SIAP message (SIAP policy)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'));
    await expect(
      upstreamFetchText('https://up.test/x', {}, 'Siap'),
    ).rejects.toThrow('Session SIAP expired. Silakan login ulang via SSO');

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 503 }));
    await expect(
      upstreamFetchText('https://up.test/x', {}, 'Siap'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  it('supports custom messages (Kulon gangguan wording)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 500 }));
    await expect(
      upstreamFetchText('https://up.test/my/', {}, 'Kulon', {
        notOkMessage: 'Kulon mengalami gangguan. Silakan login ulang via SSO',
      }),
    ).rejects.toThrow('Kulon mengalami gangguan. Silakan login ulang via SSO');
  });

  it('reports evidence through onStale for diagnostics', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 403 }));
    const onStale = jest.fn();
    await upstreamFetchText('https://up.test/x', {}, 'Siap', {
      onStale,
    }).catch(() => undefined);
    expect(onStale).toHaveBeenCalledWith(
      'http-not-ok',
      null,
      undefined,
    );
  });

  it('keeps the stale error when an async onStale hook rejects', async () => {
    const hookError = new Error('callback failure must not leak');
    const onStale = jest.fn(async () => {
      throw hookError;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.on('unhandledRejection', onUnhandled);

    try {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(resStub({ ok: false, status: 403 }));

      await expect(
        upstreamFetchText('https://up.test/x', {}, 'Siap', { onStale }),
      ).rejects.toBeInstanceOf(StaleUpstreamError);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(onStale).toHaveBeenCalledWith('http-not-ok', null, undefined);
      expect(unhandled).toHaveLength(0);
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      errorLog.mockRestore();
    }
  });

  it('keeps the stale error when a synchronous onStale hook throws', async () => {
    const onStale = jest.fn(() => {
      throw new Error('callback failure must not leak');
    });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 403 }));

    await expect(
      upstreamFetchText('https://up.test/x', {}, 'Siap', { onStale }),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
    expect(onStale).toHaveBeenCalledWith('http-not-ok', null, undefined);
  });
});

describe('upstreamFetchJson', () => {
  it('parses JSON FIRST even behind a text/html content-type (SIAP quirk)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({
        contentType: 'text/html; charset=UTF-8',
        json: { ok: true, data: [1] },
      }),
    );
    const out = await upstreamFetchJson<{ ok: boolean }>(
      'https://up.test/ajax',
      {},
      'Siap',
    );
    expect(out.ok).toBe(true);
  });

  it('unparseable HTML body → StaleUpstreamError (login page in place)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      resStub({
        contentType: 'text/html; charset=UTF-8',
        text: '<html><head><title>Login</title></head></html>',
      }),
    );
    await expect(
      upstreamFetchJson('https://up.test/ajax', {}, 'Siap'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  it('malformed non-JSON non-HTML body → StaleUpstreamError too', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        resStub({ contentType: 'application/json', text: 'not-json{' }),
      );
    await expect(
      upstreamFetchJson('https://up.test/ajax', {}, 'Siap'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });
});

describe('probeUpstreamSession evidence reporting', () => {
  // Bounded evidence lines the Kulon probe emits today must survive consolidation.
  const authed = (_u: string, html: string) => html.includes('sesskey');

  it('reports redirect-loop evidence on network failure', async () => {
    const err = new Error('fetch failed');
    (err as Error & { cause?: unknown }).cause = {
      message: 'redirect count exceeded',
    };
    jest.spyOn(global, 'fetch').mockRejectedValue(err);
    const evidence = jest.fn();
    await probeUpstreamSession({
      url: 'https://kulon2.undip.ac.id/my/',
      cookie: 'MoodleSession=x',
      service: 'Kulon',
      isAuthenticatedPage: authed,
      onEvidence: evidence,
    });
    expect(evidence).toHaveBeenCalledWith(
      'redirect loop',
      undefined,
    );
  });

  it('reports http status evidence', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ ok: false, status: 503 }));
    const evidence = jest.fn();
    await probeUpstreamSession({
      url: 'u',
      cookie: 'c=1',
      service: 'Kulon',
      isAuthenticatedPage: authed,
      onEvidence: evidence,
    });
      expect(evidence).toHaveBeenCalledWith('http 503', undefined);
  });

  it('reports bounded login evidence without the final URL', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ url: 'https://login.microsoftonline.com/x' }));
    const evidence = jest.fn();
    await probeUpstreamSession({
      url: 'u',
      cookie: 'c=1',
      service: 'Kulon',
      isAuthenticatedPage: authed,
      onEvidence: evidence,
    });
    expect(evidence).toHaveBeenCalledWith(
      'login redirect',
      undefined,
    );
  });

  it('reports missing-marker evidence when page is not authenticated', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ text: '<html>guest</html>' }));
    const evidence = jest.fn();
    await probeUpstreamSession({
      url: 'u',
      cookie: 'c=1',
      service: 'Kulon',
      isAuthenticatedPage: authed,
      onEvidence: evidence,
    });
    expect(evidence).toHaveBeenCalledWith(
      'page missing sesskey (login redirect)',
      undefined,
    );
  });

  it('no evidence on success', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(resStub({ text: '<input name="sesskey">' }));
    const evidence = jest.fn();
    await probeUpstreamSession({
      url: 'u',
      cookie: 'c=1',
      service: 'Kulon',
      isAuthenticatedPage: authed,
      onEvidence: evidence,
    });
    expect(evidence).not.toHaveBeenCalled();
  });
});
