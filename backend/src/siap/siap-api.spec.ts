import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { encryptNim, SiapApiUpstream } from './siap-api';
import {
  getTimedFetchTransportReason,
  StaleUpstreamError,
} from '../upstream/upstream-fetch';
import type { TelemetryRuntime } from '../observability/telemetry';

function recordingRuntime(): { runtime: TelemetryRuntime; events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    runtime: {
      sink: { record: (event) => events.push(event) },
      wallNowMs: () => 1_000,
      monotonicNowNs: () => 1_000_000n,
    },
  };
}

describe('encryptNim', () => {
  it('produces base64(cipher):base64(iv) format', () => {
    const out = encryptNim('24060124120013');
    expect(out).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  // Known-answer vector captured from the live SIAP flow (2026-08-27):
  // NIM 24060124120013 encrypted with key/iv "Und1pUnd1p123456" (AES/CBC/PKCS5)
  // → the exact string below produced a successful mahasiswa_sso response.
  it('matches the known-answer vector from the live SIAP flow', () => {
    const nim = '24060124120013';
    const liveVector = 'yyG1tr19iBR6L20okkiFVA==:VW5kMXBVbmQxcDEyMzQ1Ng==';
    expect(encryptNim(nim)).toBe(liveVector);
  });
});

describe('SiapApiUpstream', () => {
  let upstream: SiapApiUpstream;

  beforeEach(() => {
    upstream = new SiapApiUpstream('https://api.siap.undip.ac.id/index.php', '24');
    (global.fetch as jest.Mock) = jest.fn();
  });

  it('mintToken posts app_ver/mail/nim and parses token', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { token: 'JWT.X.Y', nim: '24060124120013' } }),
      text: async () => '{}',
    });
    const out = await upstream.mintToken('kemalfaza26@students.undip.ac.id', '24060124120013');
    expect(out.token).toBe('JWT.X.Y');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('mahasiswa_sso');
    expect(init.body).toContain('app_ver=24');
    expect(init.body).toContain('mail=kemalfaza26%40students.undip.ac.id');
    expect(init.body).toContain('nim=');
  });

  it('mintToken sends the exact known-answer encrypted nim in the body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { token: 'T', nim: '24060124120013' } }),
      text: async () => '{}',
    });
    await upstream.mintToken('kemalfaza26@students.undip.ac.id', '24060124120013');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toContain(
      'nim=yyG1tr19iBR6L20okkiFVA%3D%3D%3AVW5kMXBVbmQxcDEyMzQ1Ng%3D%3D',
    );
  });

  it('fetch sets Basic auth header + app_ver form', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: 'success', data: [] }),
      text: async () => '{}',
    });
    await upstream.fetch('semester_aktif', 'JWT.X.Y', {}, '24060124120013');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('semester_aktif');
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('24060124120013:JWT.X.Y').toString('base64'));
    expect(init.body).toContain('app_ver=24');
  });

  // RED: live-verified 2026-08-27 — the SIAP API returns 401 "Unauthorized data
  // access" when the POST body carries app_ver only. The PLAIN nim must be
  // present as a form field (`nim=<plain>`) on every data-access fetch. This
  // test pins that contract so the body cannot regress to app_ver-only.
  it('fetch sends the plain nim as a form field in the POST body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: 'success', data: [] }),
      text: async () => '{}',
    });
    await upstream.fetch('data_mahasiswa', 'JWT.X.Y', {}, '24060124120013');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toContain('nim=' + encodeURIComponent('24060124120013'));
  });

  it('mintToken throws StaleUpstreamError on Email salah / Unauthorized', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: 'fail', message: 'Email salah' }),
      text: async () => '{}',
    });
    await expect(
      upstream.mintToken('x@y', '24060124120013'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  it('fetch throws StaleUpstreamError on non-2xx Invalid credentials', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ status: 'error', message: 'Invalid credentials' }),
      text: async () => '{"status":"error","message":"Invalid credentials"}',
    });
    await expect(
      upstream.fetch('semester_aktif', 'X', {}, '24060124120013'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  // RED (fix relogin-loop): kegagalan non-credential dari API SIAP (5xx/429/
  // fail generik/gate versi) adalah masalah upstream — status ke klien harus
  // 502 (bukan 401) supaya klien tidak memicu paksa re-login.
  it('fetch maps generic upstream fail to 502', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({ status: 'error', message: 'Server error' }),
      text: async () => '{"status":"error","message":"Server error"}',
    });
    const err = await upstream
      .fetch('absen', 'X', {}, '24060124120013')
      .catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err.getStatus()).toBe(502);
  });

  it('fetch maps the app-version gate to 502 (server-side fix, not re-login)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: 'fail', message: 'Silakan update aplikasi' }),
      text: async () => '{}',
    });
    const err = await upstream
      .fetch('absen', 'X', {}, '24060124120013')
      .catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err.getStatus()).toBe(502);
  });

  it('fetch keeps credential-class failures at 401', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ status: 'error', message: 'Invalid credentials' }),
      text: async () => '{"status":"error","message":"Invalid credentials"}',
    });
    const err = await upstream
      .fetch('absen', 'X', {}, '24060124120013')
      .catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err.getStatus()).toBe(401);
  });

  it.each([
    'semester_aktif',
    'data_mahasiswa',
    'v2/lihat_irs',
    'v2/daftar_khs',
    'v2/lihat_khs',
    'jadwal',
    'absen',
    'pengumuman',
  ])('accepts a successful %s payload even on a non-2xx response', async (endpoint) => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 302,
      url: `https://api.siap.undip.ac.id/index.php/${endpoint}`,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => ({ status: 'success', data: { endpoint } }),
    });

    await expect(api.fetch(endpoint, 'T', {}, '24060124120013')).resolves.toEqual({ endpoint });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap-api',
        operation: endpoint,
        route: `POST /index.php/${endpoint}`,
        outcome: 'ok',
        status: 302,
      }),
    ]);
  });

  it('accepts a successful mint payload on a 3xx response and records one attempt', async () => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 302,
      url: 'https://api.siap.undip.ac.id/index.php/mahasiswa_sso',
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => ({ status: 'success', data: { token: 'T3' } }),
    });

    await expect(api.mintToken('x@y', '24060124120013')).resolves.toMatchObject({ token: 'T3' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      service: 'siap-api',
      operation: 'mintToken',
      route: 'POST /index.php/mahasiswa_sso',
      outcome: 'ok',
      status: 302,
    });
  });

  it('maps a generic mint 5xx failure to api-endpoint 502', async () => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      url: 'https://api.siap.undip.ac.id/index.php/mahasiswa_sso',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'fail', message: 'Server error' }),
    });

    const err = await api.mintToken('x@y', '24060124120013').catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err).toMatchObject({ reason: 'api-endpoint' });
    expect(err.getStatus()).toBe(502);
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap-api',
        operation: 'mintToken',
        outcome: 'stale',
        reason: 'api-endpoint',
        status: 500,
      }),
    ]);
  });

  it('maps malformed mint JSON to api-endpoint 502', async () => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://api.siap.undip.ac.id/index.php/mahasiswa_sso',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new Error('malformed SECRET');
      },
    });

    const err = await api.mintToken('x@y', '24060124120013').catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err).toMatchObject({ reason: 'api-endpoint' });
    expect(err.getStatus()).toBe(502);
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap-api',
        operation: 'mintToken',
        outcome: 'parse_error',
        reason: 'malformed-json',
        status: 200,
      }),
    ]);
  });

  it.each([
    ['missing token', {}],
    ['empty token', { token: '' }],
    ['non-string token', { token: { value: 'JWT.X.Y' } }],
  ])('maps a %s mint token shape to api-endpoint 502', async (_label, token) => {
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://api.siap.undip.ac.id/index.php/mahasiswa_sso',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'success', data: token }),
    });

    const err = await api.mintToken('x@y', '24060124120013').catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err).toMatchObject({ reason: 'api-endpoint' });
    expect(err.getStatus()).toBe(502);
  });

  it.each([
    [401, 'upstream auth failure'],
    [403, 'upstream auth failure'],
    [500, 'Invalid credentials'],
  ])('keeps mint credential failures at 401 (%s / %s)', async (status, message) => {
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status,
      url: 'https://api.siap.undip.ac.id/index.php/mahasiswa_sso',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'fail', message }),
    });

    const err = await api.mintToken('x@y', '24060124120013').catch((e) => e);
    expect(err).toBeInstanceOf(StaleUpstreamError);
    expect(err).toMatchObject({ reason: 'api-credential' });
    expect(err.getStatus()).toBe(401);
  });

  it('maps message-based credential failures without logging payload details', async () => {
    const { runtime } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://api.siap.undip.ac.id/index.php/jadwal',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'fail', message: 'Invalid credentials SECRET-NIM' }),
    });

    try {
      await expect(api.fetch('jadwal', 'SECRET-TOKEN', {}, 'SECRET-NIM')).rejects.toMatchObject({
        reason: 'api-credential',
        status: 401,
      });
      const rendered = warn.mock.calls.flat().join(' ');
      expect(rendered).not.toContain('SECRET');
      expect(rendered).not.toContain('jadwal');
    } finally {
      warn.mockRestore();
    }
  });

  it('records malformed JSON as a parse error while preserving the API error mapping', async () => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://api.siap.undip.ac.id/index.php/absen',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new Error('malformed SECRET');
      },
    });

    await expect(api.fetch('absen', 'T', {}, 'NIM')).rejects.toMatchObject({
      reason: 'api-endpoint',
      status: 502,
    });
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap-api',
        operation: 'absen',
        outcome: 'parse_error',
        reason: 'malformed-json',
        status: 200,
      }),
    ]);
  });

  it('rejects an endpoint outside the fixed API base prefix before fetching', async () => {
    const { runtime } = recordingRuntime();
    const api = new SiapApiUpstream('https://api.siap.undip.ac.id/not-index.php', '24', runtime as any);
    await expect(api.fetch('jadwal', 'T', {}, 'NIM')).rejects.toThrow(TypeError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('preserves a transport error object and its timed transport marker', async () => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    const transport = new Error('socket reset SECRET');
    (global.fetch as jest.Mock).mockRejectedValueOnce(transport);

    await expect(api.fetch('jadwal', 'token', {}, '123')).rejects.toBe(transport);
    expect(getTimedFetchTransportReason(transport)).toBe('fetch-threw');
    expect(events).toEqual([
      expect.objectContaining({
        service: 'siap-api',
        operation: 'jadwal',
        route: 'POST /index.php/jadwal',
        outcome: 'network_error',
        reason: 'fetch-threw',
      }),
    ]);
  });

  it('records retry attempts as separate terminal events', async () => {
    const { runtime, events } = recordingRuntime();
    const api = new SiapApiUpstream(
      'https://api.siap.undip.ac.id/index.php',
      '24',
      runtime as any,
    );
    const firstTransport = new Error('temporary failure');
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(firstTransport)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://api.siap.undip.ac.id/index.php/jadwal',
        headers: new Headers(),
        json: async () => ({ status: 'success', data: [] }),
      });

    await expect(api.fetch('jadwal', 'T', {}, 'N')).rejects.toBe(firstTransport);
    await expect(api.fetch('jadwal', 'T', {}, 'N')).resolves.toEqual([]);
    expect(events).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({ outcome: 'network_error', reason: 'fetch-threw' }),
      expect.objectContaining({ outcome: 'ok', operation: 'jadwal' }),
    ]);
  });
});
