import 'reflect-metadata';
import { encryptNim, SiapApiUpstream } from './siap-api';
import { StaleUpstreamError } from '../upstream/upstream-fetch';

describe('encryptNim', () => {
  it('produces base64(cipher):base64(iv) format', () => {
    const out = encryptNim('24060121130000');
    expect(out).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  // Known-answer vector captured from the live SIAP flow (2026-08-27):
  // NIM 24060121130000 encrypted with key/iv "Und1pUnd1p123456" (AES/CBC/PKCS5)
  // → the exact string below produced a successful mahasiswa_sso response.
  it('matches the known-answer vector from the live SIAP flow', () => {
    const nim = '24060121130000';
    const liveVector = 'EHMx0EibAVJN4FuMOcpjRA==:VW5kMXBVbmQxcDEyMzQ1Ng====';
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
      json: async () => ({ status: 'success', data: { token: 'JWT.X.Y', nim: '24060121130000' } }),
      text: async () => '{}',
    });
    const out = await upstream.mintToken('anonim.sso@students.undip.ac.id', '24060121130000');
    expect(out.token).toBe('JWT.X.Y');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('mahasiswa_sso');
    expect(init.body).toContain('app_ver=24');
    expect(init.body).toContain('mail=anonim.sso%40students.undip.ac.id');
    expect(init.body).toContain('nim=');
  });

  it('mintToken sends the exact known-answer encrypted nim in the body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { token: 'T', nim: '24060121130000' } }),
      text: async () => '{}',
    });
    await upstream.mintToken('anonim.sso@students.undip.ac.id', '24060121130000');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toContain(
      'nim=EHMx0EibAVJN4FuMOcpjRA%3D%3D%3AVW5kMXBVbmQxcDEyMzQ1Ng%3D%3D',
    );
  });

  it('fetch sets Basic auth header + app_ver form', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: 'success', data: [] }),
      text: async () => '{}',
    });
    await upstream.fetch('semester_aktif', 'JWT.X.Y', {}, '24060121130000');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('semester_aktif');
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('24060121130000:JWT.X.Y').toString('base64'));
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
    await upstream.fetch('data_mahasiswa', 'JWT.X.Y', {}, '24060121130000');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toContain('nim=' + encodeURIComponent('24060121130000'));
  });

  it('mintToken throws StaleUpstreamError on Email salah / Unauthorized', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ status: 'fail', message: 'Email salah' }),
      text: async () => '{}',
    });
    await expect(
      upstream.mintToken('x@y', '24060121130000'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  it('fetch throws StaleUpstreamError on non-2xx Invalid credentials', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ status: 'error', message: 'Invalid credentials' }),
      text: async () => '{"status":"error","message":"Invalid credentials"}',
    });
    await expect(
      upstream.fetch('semester_aktif', 'X', {}, '24060121130000'),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });
});
