import 'reflect-metadata';
import {
  classifyUpstreamFetch,
  isLoginRedirect,
  isRedirectLoopCause,
  isStaleUpstreamError,
  StaleUpstreamError,
  upstreamFetchJson,
  upstreamFetchText,
  probeUpstreamSession,
} from './upstream-fetch';
import { HttpException, HttpStatus } from '@nestjs/common';

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
  it('network throw → gateway (caller picks stale vs 502 policy)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const out = await classifyUpstreamFetch('https://up.test/x', {});
    expect(out.kind).toBe('gateway');
    expect(out.reason).toBe('fetch-threw');
    expect(out.networkMessage).toBe('ECONNRESET');
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
      expect.anything(),
      undefined,
    );
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
  // Exact log lines the Kulon probe emits today must survive consolidation.
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
      expect.anything(),
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
    expect(evidence).toHaveBeenCalledWith('http 503', expect.anything());
  });

  it('reports redirected-to-url evidence on login redirect', async () => {
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
      'redirected to https://login.microsoftonline.com/x',
      expect.anything(),
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
      expect.anything(),
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
