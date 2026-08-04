import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SiapService } from './siap.service';

function fixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'test', 'fixtures', 'siap', name),
    'utf8',
  );
}

/**
 * Build a fetch mock that routes by URL substring (or regex) to a fixture body.
 * Mirrors the real transport: each SIAP endpoint returns a distinct payload.
 */
function mockFetchRouting(
  routes: Array<{ match: string | RegExp; body: string }>,
) {
  (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    for (const r of routes) {
      const hit = typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url);
      if (hit) {
        return {
          ok: true,
          url,
          text: async () => r.body,
          json: async () => JSON.parse(r.body),
        };
      }
    }
    throw new Error(`unmocked fetch: ${url}`);
  });
}

describe('SiapService', () => {
  let svc: SiapService;
  const PROBE_URL = 'https://siap.undip.ac.id/pages/mhs/dashboard'; // exact from spike doc §2

  beforeEach(() => {
    svc = new SiapService();
    (global.fetch as jest.Mock) = jest.fn();
  });

  describe('checkSessionValid', () => {
    it('returns no-cookie when cookie is empty', async () => {
      const res = await svc.checkSessionValid('');
      expect(res).toEqual({ valid: false, reason: 'no-cookie' });
    });

    it('returns stale when final URL is a login page', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        text: async () => '<html>login</html>',
      });
      const res = await svc.checkSessionValid('ci_session_x=K');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when fetch fails (redirect loop)', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: new Error('redirect count exceeded') }),
      );
      const res = await svc.checkSessionValid('ci_session_x=K');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns ok when the probe page is authenticated', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: PROBE_URL,
        // The authenticated dashboard contains the profile-tab marker.
        text: async () => '<html><title>Homepage Mahasiswa</title><div id="tabmhs_profile"></div></html>',
      });
      const res = await svc.checkSessionValid('ci_session_x=K');
      expect(res).toEqual({ valid: true, reason: 'ok' });
    });
  });

  describe('getProfile', () => {
    it('parses the server-rendered profile from the dashboard fixture', async () => {
      mockFetchRouting([{ match: '/pages/mhs/dashboard', body: fixture('profile.html') }]);
      const profile = await svc.getProfile('sia_app_session=K');
      expect(profile.nama).toBe('ANONIM UJI');
      expect(profile.nim).toBe('24060121130000');
      expect(profile.fakultas).toBe('SAINS DAN MATEMATIKA');
      expect(profile.prodi).toBe('Informatika S1');
      expect(profile.angkatan).toBe('2024');
      expect(profile.status).toBe('AKTIF');
      expect(profile.semesterBerjalan).toBe('2026/2027 Ganjil');
    });
  });

  describe('getIrs', () => {
    it('parses the IRS JSON rows from the ajax_irs_diambil fixture', async () => {
      mockFetchRouting([{ match: '/irs/mhs/irs/ajax_irs_diambil', body: fixture('irs.json') }]);
      const irs = await svc.getIrs('sia_app_session=K');
      expect(irs.totalSks).toBe(23);
      expect(irs.mataKuliah.length).toBe(8);
      expect(irs.mataKuliah[0].kode).toBe('MIK1624503');
      // Name has a leading space in the fixture; must be trimmed.
      expect(irs.mataKuliah[0].nama).toBe('Sistem Informasi');
      expect(irs.mataKuliah[0].sks).toBe(5);
      expect(irs.mataKuliah[0].kelas).toBe('C');
      expect(irs.mataKuliah[0].status).toBe('B');
      // Row 6 (index 5) = Basis Data, 3 SKS, "Ulang" status.
      expect(irs.mataKuliah[5].nama).toBe('Basis Data');
      expect(irs.mataKuliah[5].sks).toBe(3);
      expect(irs.mataKuliah[5].status).toBe('U');
    });

    it('throws 401 when the final URL is a login page', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        text: async () => '<html>login</html>',
      });
      await expect(svc.getIrs('sia_app_session=K')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('getKhs', () => {
    it('parses IPK and per-semester nilai from the khs fixtures', async () => {
      mockFetchRouting([
        { match: '/pages/mhs/dashboard', body: fixture('profile.html') },
        { match: '/irs/mhs/irs/get_khs', body: fixture('khs.html') },
        { match: '/irs/mhs/irs/get_total_sks', body: fixture('khs_total_sks.json') },
      ]);
      const khs = await svc.getKhs('sia_app_session=K');
      // angkatan 2024 + semesterBerjalan "2026/2027 Ganjil" => 5 semesters.
      expect(khs.semesters.length).toBe(5);
      expect(khs.semesters[0].semester).toBe('2024/2025 Ganjil');
      expect(khs.semesters[4].semester).toBe('2026/2027 Ganjil');
      expect(khs.semesters[0].totalSks).toBe(20);
      expect(khs.semesters[0].ip).toBe(3.95);
      expect(khs.semesters[0].nilai.length).toBe(8);
      expect(khs.semesters[0].nilai[0].mataKuliah).toBe('Aljabar Linier');
      expect(khs.semesters[0].nilai[0].nilaiHuruf).toBe('A');
      expect(khs.semesters[0].nilai[0].sks).toBe(3);
      expect(khs.semesters[0].nilai[0].bobot).toBe(4);
      // All fixture semesters are identical => weighted IPK equals the semester IP.
      expect(khs.ipk).toBe(3.95);
    });
  });
});