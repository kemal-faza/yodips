import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { SiapService } from './siap.service';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import type { SiapApiUpstream } from './siap-api';

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
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
    });

    function svcWith(cookie: string | undefined): SiapService {
      return new SiapService(
        undefined,
        undefined,
        {
          get: jest.fn().mockResolvedValue(
            cookie ? { siapCookie: cookie, identity: '24060124120013', emailSso: 'x@students.undip.ac.id' } : null,
          ),
          set: jest.fn(),
        } as any,
        apiMock as any,
      );
    }

    it('resolves the SIAP identity from SessionStore by sub and drives the API', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch
        .mockResolvedValueOnce({ nama: 'Budi', nim: '24060124120013', nama_ps: 'TI', namafak: 'FSM', tahun_masuk: '2024', sso_email: 'x@students.undip.ac.id', status_terakhir: 'Aktif' })
        .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' });
      const out = await svcWith('ci_session_x=K').getProfile('u1');
      expect(out.nama).toBe('Budi');
      // The identity passed to the API is the session's, not a cookie.
      expect(apiMock.mintToken).toHaveBeenCalledWith('x@students.undip.ac.id', '24060124120013');
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
  });

  describe('getIrs', () => {
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };
    const sessionStore = {
      get: async () => ({
        siapCookie: 's',
        identity: '2024',
        emailSso: 'x@students.undip.ac.id',
      }),
      set: jest.fn(),
    };
    // getIrs resolves angkatan via this.getProfile(sub); short-circuit it through
    // the cache so the batch-token assertions are deterministic. The cache
    // returns the profile for `:siap:profile` and null for `:siap:irs` (so getIrs
    // doesn't short-circuit on its own cache hit).
    const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    function irsSvc(): SiapService {
      cache.get.mockImplementation((key: string) =>
        key.endsWith(':siap:profile') ? Promise.resolve({ angkatan: '2024' }) : Promise.resolve(null),
      );
      return new SiapService(cache, undefined, sessionStore as any, apiMock as any);
    }

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
      cache.get.mockReset();
    });

    it('maps v2/lihat_irs rows into mataKuliah + computes totalSks (one token batch)', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      // getIrs mints once for semester_aktif then reuses the token for N×lihat_irs.
      const rows = [
        { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', sks_mk: '5', nama_kelas: 'C', jadwal: 'Senin 07:00', nama_dosen: 'Dosen X' },
        { kode_mk: 'MIK1624103', nama_mk: 'Struktur Diskret', sks_mk: '4', nama_kelas: 'D' },
      ];
      apiMock.fetch
        .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' }) // semester_aktif
        .mockResolvedValue(rows); // v2/lihat_irs per semester (5x)
      const irs = await irsSvc().getIrs('u1');
      // 5 semesters × (5 + 4 = 9 SKS per semester) = 45 total.
      expect(irs.totalSks).toBe(45);
      expect(irs.mataKuliah.length).toBe(10); // 2 rows × 5 semesters
      expect(irs.mataKuliah[0].kode).toBe('MIK1624503');
      expect(irs.mataKuliah[0].nama).toBe('Sistem Informasi');
      expect(irs.mataKuliah[0].sks).toBe(5);
      expect(irs.mataKuliah[0].kelas).toBe('C');
      // mint once for the whole batch (spec §2.2).
      expect(apiMock.mintToken).toHaveBeenCalledTimes(1);
    });

    it('propagates a stale api-credential as 401', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch
        .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' })
        .mockRejectedValue(new StaleUpstreamError('Siap', 'api-credential'));
      await expect(irsSvc().getIrs('u1')).rejects.toBeInstanceOf(StaleUpstreamError);
    });
  });

  describe('getLecturers', () => {
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };
    const sessionStore = {
      get: async () => ({ siapCookie: 's', identity: '2024', emailSso: 'x@students.undip.ac.id' }),
      set: jest.fn(),
    };
    const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    function lecturersSvc(): SiapService {
      cache.get.mockImplementation((key: string) =>
        key.endsWith(':siap:profile') ? Promise.resolve({ angkatan: '2024' }) : Promise.resolve(null),
      );
      return new SiapService(cache, undefined, sessionStore as any, apiMock as any);
    }

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
      cache.get.mockReset();
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    });

    it('returns [] when every semester IRS has no lecturer', async () => {
      // semester_aktif drives angkatan/count; getProfile is cache-backed (returns empty angkatan here).
      apiMock.fetch
        .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' }) // semester_aktif
        .mockResolvedValue([]); // v2/lihat_irs empty for all 5 semesters
      expect(await lecturersSvc().getLecturers('u1')).toEqual([]);
    });

    it('maps v2/lihat_irs rows to kode/dosen (deduped, joined by |)', async () => {
      const rows = [
        { kode_mk: 'MIK1624105', nama_dosen: 'Dosen Uji Satu' },
        { kode_mk: 'MIK1624105', nama_dosen: 'Dosen Uji Dua' },
        { kode_mk: 'UUW1624002', nama_dosen: 'Dosen Uji Empat' },
      ];
      apiMock.fetch
        .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' }) // semester_aktif
        .mockResolvedValue(rows); // v2/lihat_irs per semester
      const result = await lecturersSvc().getLecturers('u1');
      const byCode = new Map(result.map((r) => [r.kode, r.dosen]));
      expect(byCode.get('MIK1624105')).toBe('Dosen Uji Satu | Dosen Uji Dua');
      expect(byCode.get('UUW1624002')).toBe('Dosen Uji Empat');
      // mint token once for the whole batch.
      expect(apiMock.mintToken).toHaveBeenCalledTimes(1);
    });

    it('sends the correct per-semester ta/smt_ambil/smt params', async () => {
      const seen: Array<Record<string, string>> = [];
      apiMock.fetch
        .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' })
        .mockImplementation(async (_e: string, token: string, form: Record<string, string>) => {
          seen.push(form);
          return [{ kode_mk: 'MIK1624105', nama_dosen: 'D' }];
        });
      await lecturersSvc().getLecturers('u1');
      expect(seen).toEqual([
        { ta: '2024', smt_ambil: '1', smt: '1' },
        { ta: '2024', smt_ambil: '2', smt: '2' },
        { ta: '2025', smt_ambil: '3', smt: '1' },
        { ta: '2025', smt_ambil: '4', smt: '2' },
        { ta: '2026', smt_ambil: '5', smt: '1' },
      ]);
    });
  });

  describe('getNotifications', () => {
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };
    const sessionStore = {
      get: async () => ({ siapCookie: 's', identity: '24060124120013', emailSso: 'x@students.undip.ac.id' }),
      set: jest.fn(),
    };

    function notifSvc(): SiapService {
      return new SiapService(undefined, undefined, sessionStore as any, apiMock as any);
    }

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
    });

    it('normalizes the list payload from pengumuman', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch.mockResolvedValue([
        { id: '1', judul: 'Pengumuman', isi: 'Isi', created_at: '2026-08-01', read: false, jenis: 'info' },
      ]);
      const res = await notifSvc().getNotifications('u1');
      expect(Array.isArray(res.items)).toBe(true);
      expect(res.count).toBe(1);
      expect(res.items[0].title).toBe('Pengumuman');
    });

    it('throws 401 on a stale api-credential', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch.mockRejectedValue(new StaleUpstreamError('Siap', 'api-credential'));
      await expect(notifSvc().getNotifications('u1')).rejects.toMatchObject({
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
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };
    const sessionStore = {
      get: async () => ({ siapCookie: 's', identity: '24060124120013', emailSso: 'x@students.undip.ac.id' }),
      set: jest.fn(),
    };

    function jadwalSvc(): SiapService {
      return new SiapService(undefined, undefined, sessionStore as any, apiMock as any);
    }

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
    });

    it('maps the API jadwal rows to SiapJadwal[]', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch.mockResolvedValue([
        { hari: 'senin', nama_mk: 'Sistem Informasi', nama_ruang: 'A301', waktu_mulai: '09:40:00', waktu_selesai: '12:10:00', sks: '3', tanggal_pertemuan: '2026-08-31' },
      ]);
      const res = await jadwalSvc().getJadwal('u1');
      expect(Array.isArray(res)).toBe(true);
      expect(res.length).toBeGreaterThan(0);
      const first = res[0];
      expect(first.matakuliah).toBe('Sistem Informasi');
      expect(first.hari).toMatch(/senin|selasa/i);
      expect(first.ruang).toBe('A301');
      expect(first.waktu).toContain('09:40:00');
      expect(first.sks).toBe(3);
      expect(first.tanggal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const j of res) {
        expect(j.hari).toBeTruthy();
        expect(j.matakuliah).toBeTruthy();
        expect(j.waktu).toBeTruthy();
        expect(j.sks).toBeGreaterThan(0);
      }
    });

    it('throws 401 on a stale api-credential', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch.mockRejectedValue(new StaleUpstreamError('Siap', 'api-credential'));
      await expect(jadwalSvc().getJadwal('u1')).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('getAbsen', () => {
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };
    const sessionStore = {
      get: async () => ({ siapCookie: 's', identity: '24060124120013', emailSso: 'x@students.undip.ac.id' }),
      set: jest.fn(),
    };

    function absenSvc(): SiapService {
      return new SiapService(undefined, undefined, sessionStore as any, apiMock as any);
    }

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
    });

    it('parses hadir + total per matkul from the API absen rows (grouped)', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch.mockResolvedValue([
        { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'hadir' },
        { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'Hadir' },
        { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'alpa' },
        { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'hadir' },
        { kode_mk: 'MIK1624103', nama_mk: 'Komputasi Tersebar dan Pararel', idjadwal: '216387', kehadiran: 'hadir' },
      ]);
      const res = await absenSvc().getAbsen('u1');
      expect(res.length).toBe(2);
      const si = res.find((r) => r.idJadwal === '216328')!;
      expect(si.nama).toBe('Sistem Informasi');
      expect(si.hadir).toBe(3);
      expect(si.total).toBe(4);
      expect(si.hadirPct).toBe(Math.round((3 / 4) * 100));
    });

    it('throws 401 on a stale api-credential', async () => {
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
      apiMock.fetch.mockRejectedValue(new StaleUpstreamError('Siap', 'api-credential'));
      await expect(absenSvc().getAbsen('u1')).rejects.toMatchObject({ status: 401 });
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
    const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };
    const sessionStore = {
      get: async () => ({ siapCookie: 's', identity: '24060124120013', emailSso: 'x@students.undip.ac.id' }),
      set: jest.fn(),
    };

    function khsSvc(): SiapService {
      return new SiapService(undefined, undefined, sessionStore as any, apiMock as any);
    }

    beforeEach(() => {
      apiMock.mintToken.mockReset();
      apiMock.fetch.mockReset();
      apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    });

    it('parses v2/daftar_khs (ipk) + v2/lihat_khs per semester into SiapKhs', async () => {
      const daftar = [
        { ta: '2024', smt: '1', smt_ambil: '1', ipk: '3.65' },
        { ta: '2024', smt: '2', smt_ambil: '2', ipk: '3.70' },
      ];
      apiMock.fetch
        .mockResolvedValueOnce(daftar) // v2/daftar_khs
        .mockResolvedValue([
          // v2/lihat_khs rows (reused for both semesters in the mock)
          { nama_mk: 'MATKUL UJI 1', sks_mk: '3', nilai_akhir_huruf: 'A', nilai_bobot: '4' },
          { nama_mk: 'MATKUL UJI 2', sks_mk: '3', nilai_akhir_huruf: 'A', nilai_bobot: '4' },
        ]);
      const khs = await khsSvc().getKhs('u1');
      expect(khs.semesters.length).toBe(2);
      expect(khs.ipk).toBe(3.65); // official IPK from daftar_khs
      expect(khs.semesters[0].semester).toBe('2024/2025 Ganjil');
      expect(khs.semesters[1].semester).toBe('2024/2025 Genap');
      expect(khs.semesters[0].totalSks).toBe(6);
      expect(khs.semesters[0].ip).toBe(4.0);
      expect(khs.semesters[0].nilai[0].mataKuliah).toBe('MATKUL UJI 1');
      expect(khs.semesters[0].nilai[0].nilaiHuruf).toBe('A');
      expect(khs.semesters[0].nilai[0].sks).toBe(3);
      // mint ONCE for the whole batch.
      expect(apiMock.mintToken).toHaveBeenCalledTimes(1);
    });

    it('sends the within-year `smt` param per semester (NOT cumulative)', async () => {
      const seen: Array<Record<string, string>> = [];
      apiMock.fetch
        .mockResolvedValueOnce([
          { ta: '2024', smt: '1', smt_ambil: '1', ipk: '3.5' },
          { ta: '2024', smt: '2', smt_ambil: '2', ipk: '3.5' },
          { ta: '2025', smt: '1', smt_ambil: '3', ipk: '3.5' },
        ])
        .mockImplementation(async (_e: string, _t: string, form: Record<string, string>) => {
          seen.push(form);
          return [];
        });
      await khsSvc().getKhs('u1');
      // 3 semesters: within-year smt toggles 1/2 (2025/2026 Ganjil → within-year 1).
      expect(seen).toEqual([
        { ta: '2024', smt_ambil: '1', smt: '1' },
        { ta: '2024', smt_ambil: '2', smt: '2' },
        { ta: '2025', smt_ambil: '3', smt: '1' },
      ]);
    });

    it('retries the whole batch once on an invalid-credential', async () => {
      apiMock.mintToken
        .mockResolvedValueOnce({ token: 'T1', data: {} })
        .mockResolvedValueOnce({ token: 'T2', data: {} });
      const stale = new StaleUpstreamError('Siap', 'api-credential');
      apiMock.fetch
        .mockRejectedValueOnce(stale) // v2/daftar_khs fails
        .mockResolvedValueOnce([
          { ta: '2024', smt: '1', smt_ambil: '1', ipk: '4.0' },
        ]) // retry daftar_khs succeeds
        .mockResolvedValue([]); // v2/lihat_khs returns empty
      const khs = await khsSvc().getKhs('u1');
      expect(khs.ipk).toBe(4.0);
      expect(khs.semesters).toHaveLength(1);
      expect(apiMock.mintToken).toHaveBeenCalledTimes(2); // initial + retry
    });

    it('propagates a non-stale error', async () => {
      apiMock.fetch.mockRejectedValue(new Error('network'));
      await expect(khsSvc().getKhs('u1')).rejects.toThrow('network');
      expect(apiMock.mintToken).toHaveBeenCalledTimes(1);
    });
  });
});

// Session resolver whose store carries emailSso (the API path needs it directly
// without a scrape fallback). cookie value is irrelevant to the apiMock below.
function makeApiSvc(
  apiMock: Partial<SiapApiUpstream>,
  cache?: any,
): SiapService {
  return new SiapService(
    cache,
    undefined,
    {
      get: async () => ({
        siapCookie: 'sia_app_session=TEST',
        identity: '24060124120013',
        emailSso: 'kemalfaza26@students.undip.ac.id',
      }),
    } as any,
    apiMock as SiapApiUpstream,
  );
}

describe('API-backed methods', () => {
  const apiMock = { mintToken: jest.fn(), fetch: jest.fn() };

  beforeEach(() => {
    apiMock.mintToken.mockReset();
    apiMock.fetch.mockReset();
  });

  it('getProfile mints token + fetches data_mahasiswa + semester_aktif', async () => {
    apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    apiMock.fetch
      .mockResolvedValueOnce({
        nama: 'Budi',
        nim: '24060124120013',
        nama_ps: 'Informatika',
        namafak: 'FSM',
        tahun_masuk: '2024',
        sso_email: 'b@students.undip.ac.id',
        status_terakhir: 'Aktif',
      })
      .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' });
    const svc = makeApiSvc(apiMock);
    const p = await svc.getProfile('u1');
    expect(apiMock.mintToken).toHaveBeenCalled();
    expect(p.nama).toBe('Budi');
    expect(p.prodi).toBe('Informatika');
  });

  it('getJadwal maps API rows', async () => {
    apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    apiMock.fetch.mockResolvedValue([
      { hari: 'senin', nama_mk: 'X', sks: '3', tanggal_pertemuan: '2026-08-30' },
    ]);
    const svc = makeApiSvc(apiMock);
    const j = await svc.getJadwal('u1');
    expect(j).toHaveLength(1);
    expect(j[0].matakuliah).toBe('X');
    expect(j[0].sks).toBe(3);
  });

  it('retries mintToken once on Invalid credentials (spec §5.1)', async () => {
    apiMock.mintToken
      .mockResolvedValueOnce({ token: 'T1', data: {} })
      .mockResolvedValueOnce({ token: 'T2', data: {} });
    const stale = new StaleUpstreamError('Siap', 'api-credential');
    apiMock.fetch
      .mockRejectedValueOnce(stale) // first attempt fails (token invalidated)
      .mockResolvedValueOnce([{ hari: 'senin', nama_mk: 'Y', sks: '3' }]); // retry succeeds
    const svc = makeApiSvc(apiMock);
    const j = await svc.getJadwal('u1');
    expect(j).toHaveLength(1);
    expect(apiMock.mintToken).toHaveBeenCalledTimes(2); // initial + retry
    expect(apiMock.fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a non-stale error', async () => {
    apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    apiMock.fetch.mockRejectedValue(new Error('network'));
    const svc = makeApiSvc(apiMock);
    await expect(svc.getJadwal('u1')).rejects.toThrow('network');
    expect(apiMock.mintToken).toHaveBeenCalledTimes(1); // no retry
  });

  it('getNotifications uses the API (pengumuman) and caches', async () => {
    const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    cache.get.mockResolvedValue({ count: 1, items: [{ id: '1' }] });
    const svc = makeApiSvc(apiMock, cache);
    const n = await svc.getNotifications('u1');
    expect(n.count).toBe(1);
    expect(cache.get).toHaveBeenCalledWith('u1:siap:notifications');
  });

  it('getAbsen parses API rows (group-by) into SiapAbsenItem[]', async () => {
    apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    apiMock.fetch.mockResolvedValue([
      { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'hadir' },
      { kode_mk: 'MIK1624503', nama_mk: 'Sistem Informasi', idjadwal: '216328', kehadiran: 'alpa' },
    ]);
    const svc = makeApiSvc(apiMock);
    const a = await svc.getAbsen('u1');
    expect(a).toHaveLength(1);
    expect(a[0].idJadwal).toBe('216328');
    expect(a[0].hadir).toBe(1);
    expect(a[0].total).toBe(2);
  });

  it('fallback-scrapes emailSso from fetchProfile when session lacks it', async () => {
    // No emailSso in the session → resolveSiapIdentity calls fetchProfile (scrape)
    // via this.upstream.fetchText, then mints the token.
    const svc = new SiapService(
      undefined,
      {
        fetchText: jest.fn().mockResolvedValue(
          '<html><div id="tabmhs_profile">' +
            '<b>Email SSO</b>:</div><div class="col-sm-9">x@students.undip.ac.id</div>' +
            '</div></html>',
        ),
      } as any,
      {
        get: async () => ({ siapCookie: 's', identity: '24060124120013' }),
        set: jest.fn(),
      } as any,
      apiMock as SiapApiUpstream,
    );
    apiMock.mintToken.mockResolvedValue({ token: 'T', data: {} });
    apiMock.fetch
      .mockResolvedValueOnce({ nama: 'Budi', nim: '24060124120013', sso_email: 'x@students.undip.ac.id' })
      .mockResolvedValueOnce({ nm_smt: '2026/2027 Ganjil' });
    const p = await svc.getProfile('u1');
    expect(apiMock.mintToken).toHaveBeenCalledWith('x@students.undip.ac.id', '24060124120013');
    expect(p.nama).toBe('Budi');
  });
});
