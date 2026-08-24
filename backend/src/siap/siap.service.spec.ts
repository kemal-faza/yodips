import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { SiapService } from './siap.service';
import { StaleUpstreamError } from '../upstream/upstream-fetch';

function fixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', 'test', 'fixtures', 'siap', name),
    'utf8',
  );
}

/**
 * Service whose endpoint API resolves `sub` via a fixed session store fake
 * (cookie value is irrelevant to the routing-based fetch mocks below).
 */
function makeAuthedSiapSvc(cache?: any): SiapService {
  return new SiapService(cache, undefined, {
    get: async () => ({ siapCookie: 'sia_app_session=TEST' }),
  } as any);
}

// Inline minimal profile used by multi-semester tests (getKhs, getLecturers)
// so the loop count is deterministic regardless of the profile fixture file.
// angkatan 2024 + semester "2026/2027 Ganjil" => 5 semesters.
const PROFILE_2024_5_SEM =
  '<html><div id="tabmhs_profile">' +
  '<b>NIM</b>:</div><div class="col-sm-9">20999999999999</div>' +
  '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
  '<p class="text-muted">2026/2027 Ganjil</p>' +
  '<p><span class="badge badge-success">AKTIF</span></p>' +
  '</div></html>';

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
      const hit =
        typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url);
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
    svc = makeAuthedSiapSvc();
    (global.fetch as jest.Mock) = jest.fn();
  });

  describe('sub-based session resolution (endpoint API)', () => {
    const sessionStore = { get: jest.fn() };
    const authedDashboard =
      '<html><div id="tabmhs_profile"><b>Nama Lengkap</b>:</div>' +
      '<div class="col-sm-9">Budi</div></html>';

    beforeEach(() => {
      sessionStore.get.mockReset();
    });

    function svcWith(cookie: string | undefined): SiapService {
      return new SiapService(
        undefined,
        undefined,
        { get: jest.fn().mockResolvedValue(cookie ? { siapCookie: cookie } : null) } as any,
      );
    }

    it('resolves the SIAP cookie from SessionStore by sub and forwards it', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: PROBE_URL,
        text: async () => authedDashboard,
      });
      const out = await svcWith('ci_session_x=K').getProfile('u1');
      expect(out.nama).toBe('Budi');
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(init.headers.Cookie).toBe('ci_session_x=K');
      expect(sessionStore.get).not.toHaveBeenCalled(); // svc owns its own store
    });

    it('throws a typed stale 401 when no SIAP session exists for sub', async () => {
      const promise = svcWith(undefined).getProfile('u1');
      await expect(promise).rejects.toBeInstanceOf(StaleUpstreamError);
      await expect(svcWith(null as any).getProfile('u1')).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        svcWith(undefined).getProfile('u1'),
      ).rejects.toThrow('SIAP session belum ada. Silakan login ulang via SSO');
    });

    it('propagates a stale upstream session as StaleUpstreamError (401)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        text: async () => '<html>login</html>',
      });
      await expect(svcWith('ci_session_x=OLD').getProfile('u1')).rejects.toBeInstanceOf(
        StaleUpstreamError,
      );
    });
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
        Object.assign(new TypeError('fetch failed'), {
          cause: new Error('redirect count exceeded'),
        }),
      );
      const res = await svc.checkSessionValid('ci_session_x=K');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns ok when the probe page is authenticated', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: PROBE_URL,
        // The authenticated dashboard contains the profile-tab marker.
        text: async () =>
          '<html><title>Homepage Mahasiswa</title><div id="tabmhs_profile"></div></html>',
      });
      const res = await svc.checkSessionValid('ci_session_x=K');
      expect(res).toEqual({ valid: true, reason: 'ok' });
    });
  });

  describe('getProfile', () => {
    it('getProfile caches and returns cached value on hit per user', async () => {
      const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
      const svc = makeAuthedSiapSvc(cache);
      cache.get.mockResolvedValue({
        nama: 'Budi',
        nim: '1',
        prodi: 'TI',
        fakultas: 'F',
        angkatan: '2024',
        status: 'aktif',
      });
      const out = await svc.getProfile('u1');
      expect(cache.get).toHaveBeenCalledWith('u1:siap:profile');
      expect(out.nama).toBe('Budi');
    });

    it('parses the server-rendered profile from the dashboard fixture', async () => {
      mockFetchRouting([
        { match: '/pages/mhs/dashboard', body: fixture('profile.html') },
      ]);
      const profile = await svc.getProfile('u1');
      expect(profile.nama).toBe('NAMA UJI ANONIM');
      expect(profile.nim).toBe('20999999999999');
      expect(profile.fakultas).toBe('FAKULTAS UJI');
      expect(profile.prodi).toBe('Informatika Uji S1');
      expect(profile.angkatan).toBe('2099');
      expect(profile.status).toBe('AKTIF');
      expect(profile.semesterBerjalan).toBe('2099/2100 Ganjil');
      // Biodata detail fields (Task 1)
      expect(profile.fotoUrl).toContain('disk.undip.ac.id');
      expect(profile.tempatLahir).toBe('KOTA UJI');
      expect(profile.tanggalLahir).toBe('1 Januari 2099');
      expect(profile.nik).toBe('999999 999999 9999');
      expect(profile.namaIbu).toBe('IBU UJI ANONIM');
      expect(profile.kodeKewarganegaraan).toBe('ID');
      expect(profile.nomorHp).toBe('089999999999');
      expect(profile.emailSso).toBe('anonim.sso@students.undip.ac.id');
      expect(profile.emailPribadi).toBe('anonim.uji@contoh.test');
      expect(profile.alamatAsal).toContain('Jalan Uji Panduan');
      expect(profile.alamatSekarang).toContain('Kota Uji');
    });
  });

  describe('getIrs', () => {
    it('parses the IRS JSON rows from the ajax_irs_diambil fixture', async () => {
      mockFetchRouting([
        { match: '/irs/mhs/irs/ajax_irs_diambil', body: fixture('irs.json') },
      ]);
      const irs = await svc.getIrs('u1');
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
      await expect(svc.getIrs('u1')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('throws 401 when a stale session returns HTML instead of JSON (same URL)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/irs/mhs/irs/ajax_irs_diambil',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type'
              ? 'text/html; charset=utf-8'
              : null,
        },
        text: async () => '<!DOCTYPE html><html><body>login</body></html>',
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      });
      await expect(svc.getIrs('u1')).rejects.toMatchObject({
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
      await expect(svc.getIrs('u1')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('accepts JSON with a non-HTML content-type (e.g. text/plain)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/irs/mhs/irs/ajax_irs_diambil',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type'
              ? 'text/plain; charset=utf-8'
              : null,
        },
        json: async () => ({ total_sks: 23, html: '' }),
      });
      const irs = await svc.getIrs('u1');
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
            k.toLowerCase() === 'content-type'
              ? 'text/html; charset=UTF-8'
              : null,
        },
        text: async () => '{"total_sks":23,"html":""}',
        json: async () => ({ total_sks: 23, html: '' }),
      });
      const irs = await svc.getIrs('u1');
      expect(irs.totalSks).toBe(23);
    });
  });

  describe('getLecturers', () => {
    const GET_IRS = '/irs/mhs/irs/get_irs';

    it('returns [] when every semester IRS is empty/not approved', async () => {
      mockFetchRouting([
        { match: '/pages/mhs/dashboard', body: PROFILE_2024_5_SEM },
        { match: GET_IRS, body: '<html>belum disetujui</html>' },
      ]);
      expect(await svc.getLecturers('u1')).toEqual([]);
    });

    it('POSTs get_irs per semester and parses kode + dosen from the 8-column table (deduped)', async () => {
      mockFetchRouting([
        { match: '/pages/mhs/dashboard', body: PROFILE_2024_5_SEM },
        { match: GET_IRS, body: fixture('irs_get.html') },
      ]);
      const result = await svc.getLecturers('u1');

      // angkatan 2024 + "2026/2027 Ganjil" => 5 semesters; the fixture table is
      // returned for each, so results must be deduped by kode.
      const kodes = result.map((r) => r.kode);
      expect(new Set(kodes).size).toBe(kodes.length);

      const byCode = new Map(result.map((r) => [r.kode, r.dosen]));
      // <br>-separated names become pipe (|)-separated for a cleaner card line.
      expect(byCode.get('MIK1624105')).toBe(
        'Dosen Uji Satu | Dosen Uji Dua | Dosen Uji Tiga',
      );
      expect(byCode.get('UUW1624002')).toBe('Dosen Uji Empat');
      expect(byCode.get('MIK1624104')).toBe('Dosen Uji Lima | Dosen Uji Enam');
    });

    it('POSTs get_irs with the correct per-semester ta/smt_ambil/smt params', async () => {
      const seen: string[] = [];
      (global.fetch as jest.Mock).mockImplementation(
        async (input: any, init?: any) => {
          const url = typeof input === 'string' ? input : input.url;
          if (url.includes('/pages/mhs/dashboard')) {
            return {
              ok: true,
              url,
              headers: { get: () => 'application/json' },
              text: async () => PROFILE_2024_5_SEM,
              json: async () => JSON.parse(PROFILE_2024_5_SEM),
            };
          }
          if (url.includes(GET_IRS)) {
            seen.push(init?.body ?? '');
            return {
              ok: true,
              url,
              headers: { get: () => 'application/json' },
              text: async () => fixture('irs_get.html'),
              json: async () => JSON.parse(fixture('irs_get.html')),
            };
          }
          throw new Error(`unmocked fetch: ${url}`);
        },
      );
      await svc.getLecturers('u1');
      // 5 semesters for angkatan 2024: smt 1..5, within-year smt toggles 1/2.
      expect(seen).toEqual([
        'ta=2024&smt_ambil=1&smt=1',
        'ta=2024&smt_ambil=2&smt=2',
        'ta=2025&smt_ambil=3&smt=1',
        'ta=2025&smt_ambil=4&smt=2',
        'ta=2026&smt_ambil=5&smt=1',
      ]);
    });
  });

  describe('getNotifications', () => {
    it('normalizes the list payload', async () => {
      mockFetchRouting([
        {
          match: '/pages/mhs/dashboard/ajax/notifications',
          body: fixture('notifications.json'),
        },
      ]);
      const res = await svc.getNotifications('u1');
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.count).toBeGreaterThanOrEqual(0);
    });

    it('sends the CI is_ajax_request() guard header', async () => {
      const fetchMock = jest.fn();
      (global.fetch as jest.Mock) = fetchMock;
      fetchMock.mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/pages/mhs/dashboard/ajax/notifications',
        headers: { get: () => 'application/json' },
        text: async () => '{"status":"ok","data":{"count":"0"}}',
        json: async () => ({ status: 'ok', data: { count: '0' } }),
      });
      await svc.getNotifications('u1');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/ajax/notifications'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Requested-With': 'XMLHttpRequest',
          }),
        }),
      );
    });

    it('throws 401 on a stale session', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        headers: { get: () => 'text/html' },
        text: async () => '<html>login page</html>',
        json: async () => {
          throw new Error('no json');
        },
      });
      await expect(svc.getNotifications('u1')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('markNotification', () => {
    it('POSTs the id to the unread endpoint', async () => {
      const fetchMock = jest.fn();
      (global.fetch as jest.Mock) = fetchMock;
      fetchMock.mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/pages/mhs/dashboard/ajax/unread',
        headers: { get: () => 'application/json' },
        text: async () => '{"status":"ok","message":"ok"}',
        json: async () => ({ status: 'ok', message: 'ok' }),
      });
      const res = await svc.markNotification('u1', '76927');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/ajax/unread'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('76927'),
          headers: expect.objectContaining({
            'X-Requested-With': 'XMLHttpRequest',
          }),
        }),
      );
      expect(res.message).toBe('ok');
    });
  });

  describe('getJadwal', () => {
    it('maps the get_jadwal JSON feed to SiapJadwal[]', async () => {
      mockFetchRouting([
        {
          match: '/jadwal_mahasiswa/mhs/jadwal/get_jadwal',
          body: fixture('get_jadwal.json'),
        },
      ]);
      const res = await svc.getJadwal('u1');
      expect(Array.isArray(res)).toBe(true);
      expect(res.length).toBeGreaterThan(0);
      // Fixture sample (real 2026-08-17 semester-1 data): Sistem Informasi, senin, A301.
      const first = res[0];
      expect(first.matakuliah).toBe('Sistem Informasi');
      expect(first.hari).toMatch(/senin|selasa/i);
      expect(first.ruang).toBeTruthy();
      expect(first.waktu).toContain('09:40:00');
      expect(first.sks).toBe(3);
      // Per-pertemuan date (yyyy-MM-dd) is carried through for the mobile calendar.
      expect(first.tanggal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Every entry has the required SiapJadwal fields.
      for (const j of res) {
        expect(j.hari).toBeTruthy();
        expect(j.matakuliah).toBeTruthy();
        expect(j.waktu).toBeTruthy();
        expect(j.sks).toBeGreaterThan(0);
      }
    });

    it('POSTs to get_jadwal with the CI guard header + session cookie', async () => {
      const fetchMock = jest.fn();
      (global.fetch as jest.Mock) = fetchMock;
      fetchMock.mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/jadwal_mahasiswa/mhs/jadwal/get_jadwal',
        headers: { get: () => 'application/json' },
        text: async () => '{}',
        json: async () => ({}),
      });
      await svc.getJadwal('u1');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/jadwal_mahasiswa/mhs/jadwal/get_jadwal'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: 'sia_app_session=TEST',
          }),
        }),
      );
    });

    it('throws 401 on a stale session', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        headers: { get: () => 'text/html' },
        text: async () => '<html>login page</html>',
        json: async () => {
          throw new Error('no json');
        },
      });
      await expect(svc.getJadwal('u1')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('getAbsen', () => {
    it('parses hadir percent + idjadwal per row from the jadwal index page', async () => {
      mockFetchRouting([
        {
          match: '/jadwal_mahasiswa/mhs/jadwal/',
          body: fixture('absen_index.html'),
        },
      ]);
      const res = await svc.getAbsen('u1');
      expect(res.length).toBe(2);
      expect(res[0]).toMatchObject({
        idJadwal: '216328',
        nama: 'Sistem Informasi',
        hadirPct: 0,
      });
      expect(res[1]).toMatchObject({
        idJadwal: '216387',
        nama: 'Komputasi Tersebar dan Pararel',
        hadirPct: 7.1,
      });
    });

    it('gets the jadwal index page with the session cookie', async () => {
      const fetched: string[] = [];
      (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
        fetched.push(typeof input === 'string' ? input : input.url);
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => fixture('absen_index.html'),
        };
      });
      await svc.getAbsen('u1');
      expect(
        fetched.some((u) => u.includes('/jadwal_mahasiswa/mhs/jadwal/')),
      ).toBe(true);
    });

    it('enriches hadir/total per matkul from the get_absen detail feed', async () => {
      mockFetchRouting([
        {
          // Exact index page (trailing slash). Must precede any /get_absen route
          // since "/jadwal_mahasiswa/mhs/jadwal" is a prefix of it too.
          match: /\/jadwal_mahasiswa\/mhs\/jadwal\/$/,
          body: fixture('absen_index.html'),
        },
        {
          match: /get_absen/,
          body: fixture('get_absen_3.html'),
        },
      ]);
      const res = await svc.getAbsen('u1');
      // idjadwal dari index (216328/216387) langsung dipakai ke get_absen;
      // fixture get_absen_3 = 2 Hadir + 1 Alpa -> hadir 2, total 3.
      expect(res.length).toBe(2);
      for (const r of res) {
        expect(r.hadir).toBe(2);
        expect(r.total).toBe(3);
      }
    });
  });

  describe('getKehadiran', () => {
    it('parses the absen table from the real get_absen fixture (non-empty, snapshot values)', async () => {
      mockFetchRouting([
        {
          match: '/jadwal_mahasiswa/mhs/jadwal/get_absen',
          body: fixture('get_absen.html'),
        },
      ]);
      const res = await svc.getKehadiran('u1', '3747941');
      expect(res.pertemuanId).toBe('3747941');
      expect(Array.isArray(res.sections)).toBe(true);
      expect(res.sections.length).toBeGreaterThan(0);
      // Fixture sample (real): "Absensi Kuliah" section with 14 pertemuan rows.
      const kuliah = res.sections.find((s) => s.label === 'Absensi Kuliah');
      expect(kuliah).toBeDefined();
      expect(kuliah!.rows.length).toBeGreaterThan(0);
      // Snapshot real values from the fixture.
      const first = kuliah!.rows[0];
      expect(first.pertemuanKe).toBe('1');
      expect(first.tanggal).toBe('Senin, 17 Agustus 2026');
      expect(first.waktu).toBe('09:40 - 12:10');
      expect(first.kelas).toMatch(/^C/);
      // "Absensi Ujian" section exists with an empty-state message.
      const ujian = res.sections.find((s) => s.label === 'Absensi Ujian');
      expect(ujian).toBeDefined();
      expect(ujian!.message).toBe('Belum ada data');
      expect(ujian!.rows).toHaveLength(0);
    });

    it('POSTs to get_absen with the CI guard header + session cookie + id/tipe_mk body', async () => {
      const fetchMock = jest.fn();
      (global.fetch as jest.Mock) = fetchMock;
      fetchMock.mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/jadwal_mahasiswa/mhs/jadwal/get_absen',
        headers: { get: () => 'text/html' },
        text: async () => fixture('get_absen.html'),
        json: async () => {
          throw new Error('no json');
        },
      });
      await svc.getKehadiran('u1', '3747941');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/jadwal_mahasiswa/mhs/jadwal/get_absen'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: 'sia_app_session=TEST',
          }),
          body: expect.stringContaining('id=3747941'),
        }),
      );
      expect(fetchMock.mock.calls[0][1].body).toContain(
        'tipe_mk=mata%20kuliah',
      );
    });

    it('throws 401 on a stale session', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        headers: { get: () => 'text/html' },
        text: async () => '<html>login page</html>',
        json: async () => {
          throw new Error('no json');
        },
      });
      await expect(svc.getKehadiran('u1', '1')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('markKehadiran', () => {
    it('POSTs the QR token to the presence process endpoint', async () => {
      const fetchMock = jest.fn();
      (global.fetch as jest.Mock) = fetchMock;
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://siap.undip.ac.id/master_perkuliahan/mhs/absensi/process/',
        headers: { get: () => 'application/json' },
        text: async () => '{"status":"success","message":"ok"}',
        json: async () => ({ status: 'success', message: 'ok' }),
      });
      const res = await svc.markKehadiran(
        'u1',
        'qrcodetoken123',
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/absensi/process/'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('qrcodetoken123'),
          headers: expect.objectContaining({
            'X-Requested-With': 'XMLHttpRequest',
          }),
        }),
      );
      expect(res.status).toBe('success');
    });

    it('passes through an upstream invalid-token error (400) with its message', async () => {
      const fetchMock = jest.fn();
      (global.fetch as jest.Mock) = fetchMock;
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        url: 'https://siap.undip.ac.id/master_perkuliahan/mhs/absensi/process/',
        headers: { get: () => 'application/json' },
        text: async () =>
          '{"status":"error","message":"Gagal: QRcode tidak valid atau sudah expired."}',
        json: async () => ({
          status: 'error',
          message: 'Gagal: QRcode tidak valid atau sudah expired.',
        }),
      });
      const res = await svc.markKehadiran('u1', 'dummy');
      expect(res.status).toBe('error');
      expect(res.message).toContain('tidak valid');
    });

    it('throws 401 on a stale session', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://siap.undip.ac.id/login',
        headers: { get: () => 'text/html' },
        text: async () => '<html>login page</html>',
        json: async () => {
          throw new Error('no json');
        },
      });
      await expect(svc.markKehadiran('u1', 'x')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('getKhs', () => {
    it('parses IPK and per-semester nilai from the khs fixtures', async () => {
      // Inline profile (angkatan 2024 + semester '2026/2027 Ganjil') drives a
      // 5-semester loop deterministically, independent of the profile fixture.
      const profileHtml =
        '<html><div id="tabmhs_profile">' +
        '<b>NIM</b>:</div><div class="col-sm-9">20999999999999</div>' +
        '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2026/2027 Ganjil</p>' +
        '<p><span class="badge badge-success">AKTIF</span></p>' +
        '</div></html>';
      mockFetchRouting([
        { match: '/pages/mhs/dashboard', body: profileHtml },
        { match: '/irs/mhs/irs/get_khs', body: fixture('khs.html') },
        {
          match: '/irs/mhs/irs/get_total_sks',
          body: fixture('khs_total_sks.json'),
        },
      ]);
      const khs = await svc.getKhs('u1');
      // angkatan 2024 + semesterBerjalan "2026/2027 Ganjil" => 5 semesters.
      expect(khs.semesters.length).toBe(5);
      expect(khs.semesters[0].semester).toBe('2024/2025 Ganjil');
      expect(khs.semesters[4].semester).toBe('2026/2027 Ganjil');
      expect(khs.semesters[0].totalSks).toBe(20);
      expect(khs.semesters[0].ip).toBe(3.95);
      expect(khs.semesters[0].nilai.length).toBe(8);
      expect(khs.semesters[0].nilai[0].mataKuliah).toBe('MATKUL UJI 1');
      expect(khs.semesters[0].nilai[0].nilaiHuruf).toBe('A');
      expect(khs.semesters[0].nilai[0].sks).toBe(3);
      expect(khs.semesters[0].nilai[0].bobot).toBe(4);
      // footer now supplies SIAP's official cumulative IPK (3.65), not the per-fixture aggregation.
      expect(khs.ipk).toBe(3.65);
    });

    it('computes IPK from RAW per-semester sums, not pre-rounded semester IPs (B11)', async () => {
      const row = (kode: string, sks: number, bobot: number, huruf: string) =>
        '<tr><td>1</td><td>' +
        kode +
        '</td><td>MK</td><td>TIU</td><td>TI</td>' +
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
        '<b>NIM</b>:</div><div class="col-sm-9">24060124120013</div>' +
        '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2024/2025 Genap</p>' +
        '</div></html>';
      let khsCalls = 0;
      (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/pages/mhs/dashboard'))
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => profileHtml,
            json: async () => ({}),
            status: 200,
          };
        if (url.includes('/get_khs')) {
          khsCalls++;
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => (khsCalls === 1 ? sem1 : sem2),
            json: async () => ({}),
            status: 200,
          };
        }
        if (url.includes('/get_total_sks'))
          return {
            ok: true,
            url,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-type' ? 'application/json' : null,
            },
            text: async () => JSON.stringify({ total_sks: 300 }),
            json: async () => ({ total_sks: 300 }),
            status: 200,
          };
        throw new Error('unmocked: ' + url);
      });

      const khs = await svc.getKhs('u1');
      expect(khs.semesters.length).toBe(2);
      expect(khs.semesters[0].ip).toBe(3.67); // display uses rounded per-semester IP
      // IPK from RAW sums: Σ(b·sks)=1100+1200=2300, Σsks=600 => 2300/600 = 3.8333 => 3.83.
      // (Per-semester rounding: 3.67*300 + 4.0*300 = 2301 => 2301/600 = 3.835 => 3.84 — the bug.)
      expect(khs.ipk).toBe(3.83);
    });

    it('sends the within-year `smt` (1 Ganjil / 2 Genap) so later semesters grade', async () => {
      // Profile: angkatan 2024, semester berjalan "2025/2026 Ganjil" => 3 semesters,
      // i.e. the third semester is 2025/2026 Ganjil (within-year smt=1), NOT smt=3.
      const profileHtml =
        '<html><div id="tabmhs_profile">' +
        '<b>NIM</b>:</div><div class="col-sm-9">24060124120013</div>' +
        '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2025/2026 Ganjil</p>' +
        '</div></html>';
      const bodies: string[] = [];
      (global.fetch as jest.Mock).mockImplementation(
        async (input: any, init?: any) => {
          const url = typeof input === 'string' ? input : input.url;
          if (url.includes('/pages/mhs/dashboard'))
            return {
              ok: true,
              url,
              headers: { get: () => null },
              text: async () => profileHtml,
              status: 200,
            };
          if (url.includes('/get_khs')) {
            bodies.push(init?.body ?? '');
            return {
              ok: true,
              url,
              headers: { get: () => null },
              text: async () => fixture('khs.html'),
              status: 200,
            };
          }
          if (url.includes('/get_total_sks'))
            return {
              ok: true,
              url,
              headers: {
                get: (k: string) =>
                  k.toLowerCase() === 'content-type'
                    ? 'application/json'
                    : null,
              },
              text: async () => JSON.stringify({ total_sks: 20 }),
              status: 200,
            };
          throw new Error('unmocked: ' + url);
        },
      );

      await svc.getKhs('u1');
      // smt_ambil stays cumulative; smt must be the within-year index (1 Ganjil / 2 Genap).
      expect(bodies).toEqual([
        'ta=2024&smt_ambil=1&smt=1',
        'ta=2024&smt_ambil=2&smt=2',
        'ta=2025&smt_ambil=3&smt=1', // 2025/2026 Ganjil → within-year 1, NOT 3
      ]);
    });

    it('excludes the current (ungraded) semester from the IPK denominator', async () => {
      // Profile: angkatan 2024, semester berjalan "2026/2027 Ganjil" => 5 semesters.
      // Semesters 1-4 return graded courses; semester 5 (current) returns enrolled
      // courses with EMPTY nilaiHuruf / bobot 0 (rawIp 0) — its SKS must NOT count.
      const profileHtml =
        '<html><div id="tabmhs_profile">' +
        '<b>NIM</b>:</div><div class="col-sm-9">24060124120013</div>' +
        '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2026/2027 Ganjil</p>' +
        '</div></html>';
      const gradedRow = (kode: string, bobot: number) =>
        '<tr><td>1</td><td>' +
        kode +
        '</td><td>MK</td><td>TIU</td><td>TI</td>' +
        `<td>3</td><td>A</td><td>${bobot}</td></tr>`;
      const gradedHtml =
        '<table>' + gradedRow('G1', 4) + gradedRow('G2', 4) + '</table>';
      // Ungraded semester: courses present but EMPTY nilaiHuruf (cell 6 blank) and bobot 0.
      const ungradedRow = (kode: string) =>
        '<tr><td>1</td><td>' +
        kode +
        '</td><td>MK</td><td>TIU</td><td>TI</td>' +
        '<td>3</td><td></td><td>0</td></tr>';
      const ungradedHtml = '<table>' + ungradedRow('U1') + '</table>';
      let khsCalls = 0;
      (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/pages/mhs/dashboard'))
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => profileHtml,
            status: 200,
          };
        if (url.includes('/get_khs')) {
          khsCalls++;
          // Semesters 1-4 graded (identical), semester 5 ungraded.
          const body = khsCalls <= 4 ? gradedHtml : ungradedHtml;
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => body,
            status: 200,
          };
        }
        if (url.includes('/get_total_sks'))
          return {
            ok: true,
            url,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-type' ? 'application/json' : null,
            },
            text: async () => JSON.stringify({ total_sks: 3 }),
            json: async () => ({ total_sks: 3 }),
            status: 200,
          };
        throw new Error('unmocked: ' + url);
      });

      const khs = await svc.getKhs('u1');
      expect(khs.semesters.length).toBe(5);
      // 4 graded semesters each: rawIp = (4·3 + 4·3)/(3+3) = 4.0, semesterSks 3.
      // IPK = Σ(4.0·3)/Σ(3) over the GRADED terms = 48/12 = 4.0. Ungraded sem 5 excluded.
      expect(khs.ipk).toBe(4.0);
      // The ungraded semester's per-semester totalSks is still reported.
      expect(khs.semesters[4].totalSks).toBe(3);
      expect(khs.semesters[4].ip).toBe(0);
    });

    it('reads the official cumulative IPK from the KHS footer (IP. Kumulatif)', async () => {
      // The real get_khs HTML prints the cumulative IPK in a summary row:
      //   IP. Kumulatif ... : 3,65  (SIAP's own 292/80, not a manual recompute).
      const footerHtml =
        '<table><tbody>' +
        '<tr><th class="align-top">IP. Semester<br><span class="grey font-small-3">79 / 20</span></th>' +
        '<th class="align-top">:</th><th class="align-top">3,95</th></tr>' +
        '<tr><th class="align-top">IP. Kumulatif<br><span class="grey font-small-3">292 / 80</span></th>' +
        '<th class="align-top">:</th><th class="align-top">3,65</th></tr>' +
        '</tbody></table>';
      const profileHtml =
        '<html><div id="tabmhs_profile">' +
        '<b>NIM</b>:</div><div class="col-sm-9">24060124120013</div>' +
        '<b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2026/2027 Ganjil</p>' +
        '</div></html>';
      (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/pages/mhs/dashboard'))
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => profileHtml,
            status: 200,
          };
        if (url.includes('/get_khs'))
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => footerHtml,
            status: 200,
          };
        if (url.includes('/get_total_sks'))
          return {
            ok: true,
            url,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-type' ? 'application/json' : null,
            },
            text: async () => JSON.stringify({ total_sks: 20 }),
            json: async () => ({ total_sks: 20 }),
            status: 200,
          };
        throw new Error('unmocked: ' + url);
      });

      const khs = await svc.getKhs('u1');
      expect(khs.ipk).toBe(3.65); // official value from the footer, comma→dot
    });

    it('falls back to manual IPK aggregation when the footer IP. Kumulatif is absent', async () => {
      // No IP. Kumulatif block — must fall back to the server-side aggregate over
      // graded semesters (so a SIAP layout change never empties the IPK card).
      const row = (bobot: number) =>
        '<tr><td>1</td><td>K</td><td>MK</td><td>TIU</td><td>TI</td><td>3</td><td>A</td><td>' +
        bobot +
        '</td></tr>';
      const gradedHtml = '<table>' + row(4) + '</table>'; // no footer summary table
      const profileHtml =
        '<html><div id="tabmhs_profile"><b>Angkatan</b>:</div><div class="col-sm-9">2024</div>' +
        '<p class="text-muted">2024/2025 Genap</p></div></html>';
      (global.fetch as jest.Mock).mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/pages/mhs/dashboard'))
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => profileHtml,
            status: 200,
          };
        if (url.includes('/get_khs'))
          return {
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => gradedHtml,
            status: 200,
          };
        if (url.includes('/get_total_sks'))
          return {
            ok: true,
            url,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'content-type' ? 'application/json' : null,
            },
            text: async () => JSON.stringify({ total_sks: 3 }),
            json: async () => ({ total_sks: 3 }),
            status: 200,
          };
        throw new Error('unmocked: ' + url);
      });

      const khs = await svc.getKhs('u1');
      expect(khs.ipk).toBe(4.0); // manual fallback: rawIp=4.0 over the (2) graded semesters
    });
  });
});
