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
          headers: {
            get: (k: string) =>
              k.toLowerCase() === 'content-type' ? 'application/json' : null,
          },
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
      // Biodata detail fields (Task 1)
      expect(profile.fotoUrl).toContain('disk.undip.ac.id');
      expect(profile.tempatLahir).toBe('KOTA UJI');
      expect(profile.tanggalLahir).toBe('01 Januari 2000');
      expect(profile.nik).toBe('000000 000000 0000');
      expect(profile.namaIbu).toBe('IBU UJI');
      expect(profile.kodeKewarganegaraan).toBe('ID');
      expect(profile.nomorHp).toBe('080000000000');
      expect(profile.emailSso).toBe('anonim.sso@students.undip.ac.id');
      expect(profile.emailPribadi).toBe('anonim.pribadi@contoh.test');
      expect(profile.alamatAsal).toContain('Jalan Uji');
      expect(profile.alamatSekarang).toContain('Uji');
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

    it('throws 401 when a stale session returns HTML instead of JSON (same URL)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/irs/mhs/irs/ajax_irs_diambil',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null,
        },
        text: async () => '<!DOCTYPE html><html><body>login</body></html>',
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      });
      await expect(svc.getIrs('sia_app_session=K')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('throws 401 when Content-Type is missing and the body is HTML (hard parse guard)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/irs/mhs/irs/ajax_irs_diambil',
        headers: { get: () => null },
        text: async () => '<!DOCTYPE html><html><body>login</body></html>',
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      });
      await expect(svc.getIrs('sia_app_session=K')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('accepts JSON with a non-HTML content-type (e.g. text/plain)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/irs/mhs/irs/ajax_irs_diambil',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type' ? 'text/plain; charset=utf-8' : null,
        },
        json: async () => ({ total_sks: 23, html: '' }),
      });
      const irs = await svc.getIrs('sia_app_session=K');
      expect(irs.totalSks).toBe(23);
    });

    it('parses a JSON body even when Content-Type claims text/html (real SIAP transport)', async () => {
      // Verified live: SIAP returns a VALID JSON body with a misleading
      // `Content-Type: text/html; charset=UTF-8`. The JSON must be parsed, not
      // rejected as a stale session (which surfaced as a false 401 on /api/siap/irs).
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/irs/mhs/irs/ajax_irs_diambil',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type' ? 'text/html; charset=UTF-8' : null,
        },
        text: async () => '{"total_sks":23,"html":""}',
        json: async () => ({ total_sks: 23, html: '' }),
      });
      const irs = await svc.getIrs('sia_app_session=K');
      expect(irs.totalSks).toBe(23);
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

    it('computes IPK from RAW per-semester sums, not pre-rounded semester IPs (B11)', async () => {
      const row = (kode: string, sks: number, bobot: number, huruf: string) =>
        '<tr><td>1</td><td>' + kode + '</td><td>MK</td><td>TIU</td><td>TI</td>' +
        `<td>${sks}</td><td>${huruf}</td><td>${bobot}</td></tr>`;
      // Semester 1: 200×1sks bobot4 + 100×1sks bobot3 => Σ(b·sks)=1100, Σsks=300,
      //   raw IP = 1100/300 = 3.6667 (rounds to 3.67 for display).
      let sem1Rows = '';
      for (let i = 0; i < 200; i++) sem1Rows += row('S1x' + i, 1, 4, 'A');
      for (let i = 0; i < 100; i++) sem1Rows += row('S1y' + i, 1, 3, 'B');
      const sem1 = '<table>' + sem1Rows + '</table>';
      // Semester 2: 300×1sks bobot4 => Σ=1200, Σsks=300, raw IP = 4.0.
      let sem2Rows = '';
      for (let i = 0; i < 300; i++) sem2Rows += row('S2x' + i, 1, 4, 'A');
      const sem2 = '<table>' + sem2Rows + '</table>';

      // Profile: angkatan 2024, semester berjalan "2024/2025 Genap" => 2 semesters.
      const profileHtml =
        '<html><div id="tabmhs_profile">' +
        '<b>NIM</b>:</div><div class="col-sm-9">24060121130000</div>' +
        '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2024/2025 Genap</p>' +
        '</div></html>';
      let khsCalls = 0;
      (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/pages/mhs/dashboard')) return { ok: true, url, headers: { get: () => null }, text: async () => profileHtml, json: async () => ({}), status: 200 };
        if (url.includes('/get_khs')) {
          khsCalls++;
          return { ok: true, url, headers: { get: () => null }, text: async () => (khsCalls === 1 ? sem1 : sem2), json: async () => ({}), status: 200 };
        }
        if (url.includes('/get_total_sks')) return { ok: true, url, headers: { get: (k: string) => k.toLowerCase() === 'content-type' ? 'application/json' : null }, text: async () => JSON.stringify({ total_sks: 300 }), json: async () => ({ total_sks: 300 }), status: 200 };
        throw new Error('unmocked: ' + url);
      });

      const khs = await svc.getKhs('sia_app_session=K');
      expect(khs.semesters.length).toBe(2);
      expect(khs.semesters[0].ip).toBe(3.67); // display uses rounded per-semester IP
      // IPK from RAW sums: Σ(b·sks)=1100+1200=2300, Σsks=600 => 2300/600 = 3.8333 => 3.83.
      // (Per-semester rounding: 3.67*300 + 4.0*300 = 2301 => 2301/600 = 3.835 => 3.84 — the bug.)
      expect(khs.ipk).toBe(3.83);
    });
  });
});