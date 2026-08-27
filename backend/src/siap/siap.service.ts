import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataCache } from '../cache/data-cache';
import { SessionStore } from '../session/session-store';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { SiapUpstreamSession } from './siap-upstream.session';
import { SiapApiUpstream } from './siap-api';
import type {
  SiapAbsenItem,
  SiapIrs,
  SiapJadwal,
  SiapKehadiran,
  SiapKhs,
  SiapKhsSemester,
  SiapNotification,
  SiapNotifications,
  SiapProfile,
} from './siap-parse';
import {
  currentSemesterCount,
  dataRows,
  parseAbsenSummary,
  parseAbsenTable,
  parseIrsTable,
  parseKhsNilai,
  parseKumulatifIpk,
  parseNumber,
  pickProfileValue,
  pickProfileValueHtml,
  profileSection,
  round,
  rowCells,
  semesterLabel,
} from './siap-parse';

// Public data shapes + pure parsing helpers moved to siap-parse.ts —
// re-exported so existing imports keep working.
export type {
  SiapAbsenItem,
  SiapIrs,
  SiapJadwal,
  SiapKehadiran,
  SiapKehadiranRow,
  SiapKehadiranSection,
  SiapKhs,
  SiapKhsSemester,
  SiapNotification,
  SiapNotifications,
  SiapProfile,
} from './siap-parse';

export interface SiapSessionCheck {
  valid: boolean;
  reason: 'ok' | 'no-cookie' | 'stale';
}

/** Raw entry from SIAP's `get_jadwal` feed (keyed by uuid_pertemuan). */
interface SiapJadwalUpstream {
  id_trx_pertemuan?: string;
  idjadwal?: string;
  hari?: string;
  waktu_mulai?: string;
  waktu_selesai?: string;
  nama_ruang?: string;
  kode_mk?: string;
  nama_mk?: string;
  jenis_perkuliahan?: string;
  sks?: string | number;
  tanggal_pertemuan?: string;
  uuid_pertemuan?: string;
}

@Injectable()
export class SiapService {
  /** One session seam: probe + authenticated fetch + stale classification. */
  private readonly upstream: SiapUpstreamSession;
  private readonly apiUpstream: SiapApiUpstream;
  private readonly cache?: DataCache;
  private readonly sessionStore?: SessionStore;
  private readonly config?: ConfigService;
  constructor(
    @Optional() cache?: DataCache,
    @Optional() upstream?: SiapUpstreamSession,
    @Optional() sessionStore?: SessionStore,
    @Optional() apiUpstream?: SiapApiUpstream,
    @Optional() config?: ConfigService,
  ) {
    this.cache = cache;
    this.upstream = upstream ?? new SiapUpstreamSession();
    this.sessionStore = sessionStore;
    this.config = config;
    this.apiUpstream =
      apiUpstream ??
      new SiapApiUpstream(
        config?.get('SIAP_API_BASE') ?? 'https://api.siap.undip.ac.id/index.php',
        config?.get('SIAP_APP_VER') ?? '24',
      );
  }

  private readonly baseUrl = 'https://siap.undip.ac.id';

  /**
   * Resolve the stored SIAP cookie for a user. The endpoint-facing API takes
   * only `sub` — cookies never cross module boundaries; a missing session
   * maps to the uniform typed stale 401 (same shape as an expired one).
   */
  private async requireSiapCookie(sub?: string): Promise<string> {
    const session = sub ? await this.sessionStore?.get(sub) : null;
    if (!session?.siapCookie) {
      throw new StaleUpstreamError(
        'Siap',
        'no-cookie',
        'SIAP session belum ada. Silakan login ulang via SSO',
      );
    }
    return session.siapCookie;
  }

  async checkSessionValid(siapCookie: string): Promise<SiapSessionCheck> {
    return this.upstream.checkSessionValid(siapCookie);
  }

  /** Cached profile entry point (endpoint API takes only `sub`). */
  async getProfile(sub?: string): Promise<SiapProfile> {
    const siapCookie = await this.requireSiapCookie(sub);
    if (sub && this.cache) {
      const hit = await this.cache.get<SiapProfile>(`${sub}:siap:profile`);
      if (hit) return hit;
    }
    const profile = await this.fetchProfile(siapCookie);
    if (sub && this.cache)
      await this.cache.set(`${sub}:siap:profile`, profile);
    return profile;
  }

  /**
   * Profile is server-rendered on the dashboard page. `#tabmhs_profile` holds
   * NIM/Nama/Fakultas/Prodi/Angkatan; the summary near the status badge holds
   * the current semester label and status. Parsing lives in siap-parse.
   */
  private async fetchProfile(siapCookie: string): Promise<SiapProfile> {
    const html = await this.upstream.fetchText(
      `${this.baseUrl}/pages/mhs/dashboard`,
      {
        headers: { Cookie: siapCookie },
        redirect: 'follow',
      },
    );
    const tab = profileSection(html);

    // Status badge: <span class="badge badge-success">AKTIF</span>
    const status =
      tab.match(/<span class="badge[^"]*">([^<]+)<\/span>/)?.[1]?.trim() ?? '';
    // Semester label: <p class="text-muted">2026/2027 Ganjil</p>
    const semesterBerjalan =
      tab.match(/<p class="text-muted">([^<]+)<\/p>/)?.[1]?.trim() ?? undefined;

    // Optional summary fields (IPK / SKS) — parsed when present on the page.
    const ipk = parseNumber(html, /IPK[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);

    // Biodata detail (from #tabmhs_profile). <img src="..." alt="Foto"> and the
    // nama-ibu value live behind a click-to-show anchor:
    // <span id="web_span_mn" style="display:none;">SITI HAJJAH MARIA ULFAH</span>
    const fotoUrl =
      tab.match(/<img src="([^"]+)" alt="Foto"/)?.[1] ?? undefined;
    const namaIbu =
      tab.match(/id="web_span_mn"[^>]*>([^<]+)</)?.[1]?.trim() ?? undefined;

    return {
      nama: pickProfileValue(tab, 'Nama Lengkap') ?? '',
      nim: pickProfileValue(tab, 'NIM') ?? '',
      prodi: pickProfileValue(tab, 'Prodi') ?? '',
      fakultas: pickProfileValue(tab, 'Fakultas') ?? '',
      angkatan: pickProfileValue(tab, 'Angkatan') ?? '',
      jalurMasuk: pickProfileValue(tab, 'Jalur Masuk'),
      semesterBerjalan,
      status: status || 'aktif',
      ...(ipk != null ? { ipk } : {}),
      fotoUrl,
      tempatLahir: pickProfileValue(tab, 'Tempat lahir'),
      tanggalLahir: pickProfileValue(tab, 'Tanggal lahir'),
      nik: pickProfileValue(tab, 'NIK'),
      namaIbu,
      kodeKewarganegaraan: pickProfileValue(tab, 'Kode kewarganegaraan'),
      nomorHp: pickProfileValue(tab, 'Nomor HP'),
      emailSso: pickProfileValue(tab, 'Email SSO'),
      emailPribadi: pickProfileValue(tab, 'Email pribadi'),
      alamatAsal: pickProfileValueHtml(tab, 'Alamat Asal'),
      alamatSekarang: pickProfileValueHtml(tab, 'Alamat Sekarang'),
    };
  }

  /**
   * IRS: GET /irs/mhs/irs/ajax_irs_diambil returns JSON `{"total_sks":n,"html":"<tr>…"}`.
   * Each `<tr>` is NO, KODE, NAMA, SKS, kelas, status, …; the KODE/NAMA/SKS are
   * the contract fields, kelas/status are carried as optional extras.
   */
  async getIrs(sub?: string): Promise<SiapIrs> {
    const siapCookie = await this.requireSiapCookie(sub);
    if (sub && this.cache) {
      const hit = await this.cache.get<SiapIrs>(`${sub}:siap:irs`);
      if (hit) return hit;
    }
    const data = await this.upstream.fetchJson<{
      total_sks?: number | string;
      html?: string;
    }>(`${this.baseUrl}/irs/mhs/irs/ajax_irs_diambil`, {
      headers: { Cookie: siapCookie },
      redirect: 'follow',
    });

    const mataKuliah = dataRows(data.html ?? '').map((row) => {
      const c = rowCells(row);
      return {
        kode: c[1] ?? '',
        nama: c[2] ?? '',
        sks: Number(c[3]) || 0,
        kelas: c[4] || undefined,
        status: c[5] ?? '',
      };
    });

    const irs: SiapIrs = {
      // The ajax_irs_diambil payload does not carry the semester label itself.
      semester: '',
      totalSks: Number(data.total_sks) || 0,
      mataKuliah,
    };
    if (sub && this.cache) await this.cache.set(`${sub}:siap:irs`, irs);
    return irs;
  }

  /** Total SKS for a semester via POST get_total_sks; falls back to the KHS tfoot. */
  private async fetchTotalSks(
    siapCookie: string,
    body: string,
    khsHtml: string,
  ): Promise<number> {
    try {
      const data = await this.upstream.fetchJson<{ total_sks?: number | string }>(
        `${this.baseUrl}/irs/mhs/irs/get_total_sks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: siapCookie,
          },
          body,
        },
      );
      if (data.total_sks != null) return Number(data.total_sks) || 0;
    } catch {
      // fall through to the tfoot total
    }
    // KHS tfoot row: <th>Total</th><th>&nbsp;</th><th>20</th>…
    const tfoot = khsHtml.match(/<tfoot[\s\S]*?<\/tfoot>/i)?.[0] ?? '';
    const cells = dataRows(tfoot).flatMap((r) => rowCells(r));
    return Number(cells[2]) || 0;
  }

  /**
   * KHS: for each semester POST get_khs (ta/smt_ambil/smt) → HTML table of
   * nilai, and get_total_sks → total SKS. IP per semester = Σ(bobot·sks)/Σ(sks);
   * IPK = Σ(ip·sks)/Σ(sks) across all semesters. Empty ("-kosong-") semesters
   * are included with an empty nilai array and ip 0.
   */
  async getKhs(sub?: string): Promise<SiapKhs> {
    const siapCookie = await this.requireSiapCookie(sub);
    if (sub && this.cache) {
      const hit = await this.cache.get<SiapKhs>(`${sub}:siap:khs`);
      if (hit) return hit;
    }
    const profile = await this.fetchProfile(siapCookie);
    const count = currentSemesterCount(
      profile.angkatan,
      profile.semesterBerjalan,
    );

    const semesters: SiapKhsSemester[] = [];
    let totalWeighted = 0;
    let totalSks = 0;
    let lastKhsHtml = '';

    for (let smt = 1; smt <= count; smt++) {
      const ta = Number(profile.angkatan) + Math.floor((smt - 1) / 2);
      // `smt_ambil` is the cumulative semester index; `smt` is the within-year
      // index (1 = Ganjil, 2 = Genap) the KHS view keys on — NOT the cumulative
      // index. Sending the cumulative value works for semesters 1–2 (where the
      // two coincide) but makes semesters 3+ return "-kosong-"/empty (the idx
      // has no matching within-year block). Verified live 2026-08-11: sending
      // smt=3 for 2025/2026 Ganjil returns empty; within-year smt=1 grades.
      const smtWithinYear = smt % 2 === 1 ? 1 : 2;
      const body = `ta=${ta}&smt_ambil=${smt}&smt=${smtWithinYear}`;

      const khsHtml = await this.upstream.fetchText(
        `${this.baseUrl}/irs/mhs/irs/get_khs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: siapCookie,
          },
          body,
        },
      );

      const nilai = parseKhsNilai(khsHtml);
      const semesterSks = await this.fetchTotalSks(siapCookie, body, khsHtml);
      lastKhsHtml = khsHtml;

      // Compute the raw (unrounded) per-semester IP for aggregation, and a
      // rounded copy for display. Rounding the per-semester IP before summing
      // into the IPK accumulates error (B11) — e.g. 3.6667→3.67 then ×300
      // drifts the cumulative IPK by a cent.
      const rawIp = nilai.length
        ? nilai.reduce((s, n) => s + (n.bobot ?? 0) * n.sks, 0) /
          nilai.reduce((s, n) => s + n.sks, 0)
        : 0;

      semesters.push({
        semester: semesterLabel(profile.angkatan, smt),
        ip: round(rawIp),
        totalSks: semesterSks,
        nilai,
      });

      // A semester counts toward the cumulative IPK only when it has at least one
      // real letter grade. The current/ungraded term returns enrolled courses
      // (nilai.length > 0) with empty nilaiHuruf / bobot 0 (rawIp 0) — its SKS must
      // not inflate the IPK denominator (SIAP itself excludes it: 292/80 vs 292/84).
      const hasGrades = nilai.some((n) => (n.nilaiHuruf ?? '').trim() !== '');
      if (hasGrades) {
        totalWeighted += rawIp * semesterSks;
        totalSks += semesterSks;
      }
    }

    const officialIpk = lastKhsHtml
      ? parseKumulatifIpk(lastKhsHtml)
      : undefined;
    const ipk =
      officialIpk ?? (totalSks > 0 ? round(totalWeighted / totalSks) : 0);
    const khs: SiapKhs = { ipk, semesters };
    if (sub && this.cache) await this.cache.set(`${sub}:siap:khs`, khs);
    return khs;
  }

  /**
   * Lecturer per course, scraped from the SIAP IRS semester tables.
   * The `/irs/mhs/irs` page is AJAX-driven: each semester's table loads only
   * when its collapser is expanded via `POST /irs/mhs/irs/get_irs` with
   * `ta`/`smt_ambil`/`smt` params (verified live 2026-08-12). The response is an
   * 8-column table: NO, KODE, MATA KULIAH, KELAS, SKS, RUANG, STATUS, NAMA DOSEN
   * — parsed by parseIrsTable (KODE col 1 + NAMA DOSEN col 7).
   *
   * We iterate every semester (from the profile's angkatan + semester label, the
   * same count getKhs uses) so that approved past semesters contribute lecturers
   * too. Unapproved semesters return a "belum disetujui" placeholder which parses
   * to nothing. Results are deduped by kode (a course code repeats across
   * semesters; the first approved occurrence wins).
   */
  async getLecturers(
    sub?: string,
  ): Promise<{ kode: string; dosen: string }[]> {
    const siapCookie = await this.requireSiapCookie(sub);
    const profile = await this.fetchProfile(siapCookie);
    const count = currentSemesterCount(
      profile.angkatan,
      profile.semesterBerjalan,
    );

    const entries = new Map<string, string>();
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) => {
        const smt = i + 1;
        const ta = Number(profile.angkatan) + Math.floor((smt - 1) / 2);
        const smtWithinYear = smt % 2 === 1 ? 1 : 2;
        const body = `ta=${ta}&smt_ambil=${smt}&smt=${smtWithinYear}`;
        return this.upstream
          .fetchText(`${this.baseUrl}/irs/mhs/irs/get_irs`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Cookie: siapCookie,
            },
            body,
          })
          .then((html) => parseIrsTable(html));
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const { kode, dosen } of r.value) {
          if (!entries.has(kode)) entries.set(kode, dosen);
        }
      }
      // Rejected semesters (stale/upstream) are skipped so one bad semester does
      // not wipe out every lecturer.
    }
    return Array.from(entries, ([kode, dosen]) => ({ kode, dosen }));
  }

  /**
   * Proxy SIAP's own notification list. The payload shape is pinned by the live
   * spike (Task 1 Step 1).
   *
   * NOTE (live spike finding 2026-08-12): the endpoint is guarded by CI's
   * is_ajax_request() — without `X-Requested-With: XMLHttpRequest` it returns a
   * text/html "This endpoint cannot be accessed directly." body which fetchJson
   * maps to a stale 401. The header (set below) is the fix. The upstream payload is
   * `{"status":"ok","data":{"_timestamp":"...","count":"0"}}` (count as a STRING).
   */
  async getNotifications(sub?: string): Promise<SiapNotifications> {
    const siapCookie = await this.requireSiapCookie(sub);
    const data = await this.upstream.fetchJson<{
      status?: string;
      data?: {
        _timestamp?: string;
        count?: string | number;
        items?: SiapNotification[];
      };
    }>(`${this.baseUrl}/pages/mhs/dashboard/ajax/notifications`, {
      headers: {
        Cookie: siapCookie,
        // SIAP is CodeIgniter-based; this /ajax/ route is guarded by CI's
        // is_ajax_request() which requires the XMLHttpRequest header. Without
        // it the endpoint returns "This endpoint cannot be accessed directly."
        'X-Requested-With': 'XMLHttpRequest',
      },
      redirect: 'follow',
    });
    const raw = data?.data;
    const items: SiapNotification[] = Array.isArray(raw?.items)
      ? raw.items
      : [];
    return { count: Number(raw?.count) || items.length, items };
  }

  /**
   * Proxy SIAP's mark-unread action. NOTE: the upstream endpoint is literally
   * `/ajax/unread`; the spike must confirm whether it marks read or unread, and
   * the route name/action must match that semantics (see spec §1).
   */
  async markNotification(
    sub: string | undefined,
    id: string,
  ): Promise<{ message: string }> {
    const siapCookie = await this.requireSiapCookie(sub);
    const data = await this.upstream.fetchJson<{
      status?: string;
      message?: string;
    }>(`${this.baseUrl}/pages/mhs/dashboard/ajax/unread`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: siapCookie,
        // Same CI is_ajax_request() guard as getNotifications.
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: `id=${encodeURIComponent(id)}`,
      redirect: 'follow',
    });
    return { message: data?.message ?? 'ok' };
  }

  /**
   * Proxy SIAP's own class-schedule feed. Discovered live 2026-08-14 (spike):
   * `POST /jadwal_mahasiswa/mhs/jadwal/get_jadwal` returns a JSON object keyed
   * by `uuid_pertemuan`, each entry with date/time/room/code. Normalize into a
   * flat `SiapJadwal[]`.
   */
  async getJadwal(sub?: string): Promise<SiapJadwal[]> {
    const siapCookie = await this.requireSiapCookie(sub);
    if (sub && this.cache) {
      const hit = await this.cache.get<SiapJadwal[]>(`${sub}:siap:jadwal`);
      if (hit) return hit;
    }
    const data = await this.upstream.fetchJson<
      Record<string, SiapJadwalUpstream>
    >(`${this.baseUrl}/jadwal_mahasiswa/mhs/jadwal/get_jadwal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: siapCookie,
        // SIAP is CodeIgniter-based; /jadwal_mahasiswa/* AJAX routes are
        // guarded by CI's is_ajax_request() which requires this header.
        'X-Requested-With': 'XMLHttpRequest',
      },
      redirect: 'follow',
    });
    const out: SiapJadwal[] = [];
    for (const k of Object.keys(data ?? {})) {
      const e = data[k];
      if (!e) continue;
      const sks = Number(e.sks) || 0;
      out.push({
        kode: e.kode_mk || undefined,
        hari: e.hari || '',
        matakuliah: e.nama_mk || '',
        ruang: e.nama_ruang || undefined,
        waktu: `${e.waktu_mulai ?? ''} s/d ${e.waktu_selesai ?? ''}`.trim(),
        sks,
        tanggal: e.tanggal_pertemuan || undefined,
      });
    }
    if (sub && this.cache) {
      await this.cache.set(`${sub}:siap:jadwal`, out);
    }
    return out;
  }

  /**
   * Ringkasan hadir (%) per matakuliah dari halaman index jadwal
   * (`GET /jadwal_mahasiswa/mhs/jadwal/`). Murah (1 GET) untuk progres
   * ringkas; detail per pertemuan ada di [getKehadiran].
   */
  async getAbsen(sub?: string): Promise<SiapAbsenItem[]> {
    const siapCookie = await this.requireSiapCookie(sub);
    if (sub && this.cache) {
      const hit = await this.cache.get<SiapAbsenItem[]>(
        `${sub}:siap:absen`,
      );
      if (hit) return hit;
    }
    const html = await this.upstream.fetchText(
      `${this.baseUrl}/jadwal_mahasiswa/mhs/jadwal/`,
      {
        headers: { Cookie: siapCookie },
        redirect: 'follow',
      },
    );
    const items = parseAbsenSummary(html);
    await this.enrichAbsenCounts(items, siapCookie);
    if (sub && this.cache) {
      await this.cache.set(`${sub}:siap:absen`, items);
    }
    return items;
  }

  /**
   * Lengkapi ringkasan index (hanya hadirPct) dengan hitungan hadir/total per
   * matakuliah dari detil `get_absen`. Verified live 2026-08-19: SIAP `get_absen`
   * menerima `idjadwal` (data-id dari halaman index) — BUKAN `id_trx_pertemuan`
   * dari get_jadwal (yang menjawab "Specified schedule cannot be found").
   * Best-effort: matkul yang gagal di-fetch tetap di-return (hadir/total = 0).
   */
  private async enrichAbsenCounts(
    items: SiapAbsenItem[],
    siapCookie: string,
  ): Promise<void> {
    if (items.length === 0) return;
    // Per matkul: 1 GET get_absen(idjadwal) utk hitung hadir/total.
    for (const item of items) {
      const id = item.idJadwal;
      if (!id) continue;
      try {
        const det = await this.fetchKehadiran(siapCookie, id);
        item.hadir = 0;
        item.total = 0;
        for (const sec of det.sections) {
          for (const row of sec.rows) {
            item.total += 1;
            if (row.kehadiran.trim().toLowerCase() === 'hadir') item.hadir += 1;
          }
        }
      } catch {
        // Biarkan hadir/total default 0 untuk matkul ini.
      }
    }
  }

  /**
   * Proxy per-pertemuan attendance (kehadiran) untuk satu matakuliah.
   * Discovered live 2026-08-14 (spike jadwal/kehadiran/QR): `POST
   * /jadwal_mahasiswa/mhs/jadwal/get_absen` body
   * `id=<idjadwal>&tipe_mk=mata+kuliah` mengembalikan HTML table
   * dikelompokkan per section (Absensi Kuliah / Absensi Ujian). `id` =
   * **idjadwal** dari halaman index (data-id tombol "Lihat Absen") — verified
   * live 2026-08-19: `id_trx_pertemuan` dari get_jadwal mengembalikan
   * "Specified schedule cannot be found".
   */
  async getKehadiran(
    sub: string | undefined,
    pertemuanId: string,
  ): Promise<SiapKehadiran> {
    const siapCookie = await this.requireSiapCookie(sub);
    return this.fetchKehadiran(siapCookie, pertemuanId);
  }

  /** Transport + parse without session resolution (internal reuse). */
  private async fetchKehadiran(
    siapCookie: string,
    pertemuanId: string,
  ): Promise<SiapKehadiran> {
    const url = `${this.baseUrl}/jadwal_mahasiswa/mhs/jadwal/get_absen`;
    const html = await this.upstream.fetchText(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: siapCookie,
        // Same CI is_ajax_request() guard as getJadwal / getNotifications.
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: `id=${encodeURIComponent(pertemuanId)}&tipe_mk=${encodeURIComponent('mata kuliah')}`,
    });
    return { pertemuanId, sections: parseAbsenTable(html) };
  }

  /**
   * Proxy a QR-scan presence submission to SIAP. Discovered live 2026-08-14:
   * `POST /master_perkuliahan/mhs/absensi/process/` body `token=<QR content>`
   * returns JSON `{status, message}`. SIAP itself enforces QR validity + expiry
   * (dummy token → 400 "QRcode tidak valid atau sudah expired"), so we only
   * pass the token through and surface the upstream message.
   *
   * Unlike fetchJson (which maps every !ok to a 401 stale), a genuine
   * invalid-token 400/500 is NOT a stale session — it must be passed through.
   * Only a login-redirect / non-JSON response is treated as stale 401.
   */
  async markKehadiran(
    sub: string | undefined,
    token: string,
  ): Promise<{ status: string; message?: string }> {
    const siapCookie = await this.requireSiapCookie(sub);
    const url = `${this.baseUrl}/master_perkuliahan/mhs/absensi/process/`;
    const { httpOk, body } =
      await this.upstream.fetchJsonAllowingHttpErrors<{
        status?: string;
        message?: string;
      }>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: siapCookie,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: `token=${encodeURIComponent(token)}`,
        redirect: 'follow',
      });
    // Pass through the upstream status + message (success or invalid-token error).
    return {
      status: body?.status ?? (httpOk ? 'success' : 'error'),
      message: body?.message,
    };
  }
}
