import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { DataCache } from '../cache/data-cache';

export interface SiapSessionCheck {
  valid: boolean;
  reason: 'ok' | 'no-cookie' | 'stale';
}

export interface SiapProfile {
  nama: string;
  nim: string;
  prodi: string;
  fakultas: string;
  angkatan: string;
  jalurMasuk?: string;
  semesterBerjalan?: string;
  status: string; // aktif | cuti | dll
  sksTempuh?: number;
  sksLulus?: number;
  ipk?: number;
  // Biodata detail (from #tabmhs_profile tab)
  fotoUrl?: string;
  tempatLahir?: string;
  tanggalLahir?: string;
  nik?: string;
  namaIbu?: string;
  kodeKewarganegaraan?: string;
  nomorHp?: string;
  emailSso?: string;
  emailPribadi?: string;
  alamatAsal?: string;
  alamatSekarang?: string;
}

export interface SiapIrs {
  semester: string;
  totalSks: number;
  mataKuliah: Array<{
    kode: string;
    nama: string;
    sks: number;
    kelas?: string;
    ruang?: string;
    jadwal?: string;
    dosen?: string;
    status: string; // rencana | disetujui
  }>;
}

export interface SiapKhsSemester {
  semester: string;
  ip: number;
  totalSks: number;
  nilai: Array<{ mataKuliah: string; sks: number; nilaiHuruf: string; bobot?: number }>;
}

export interface SiapKhs {
  ipk: number;
  semesters: SiapKhsSemester[];
}

export interface SiapNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'warning' | 'urgent' | 'success' | 'info';
}

export interface SiapNotifications {
  count: number;
  items: SiapNotification[];
}

/** Flat schedule item consumed by the dashboard/mobile (mirrors web `SiapJadwal`). */
export interface SiapJadwal {
  kode?: string;
  hari: string;
  matakuliah: string;
  ruang?: string;
  waktu: string;
  sks: number;
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


/** Satu baris catatan kehadiran per pertemuan (di-parse dari `get_absen.html`). */
export interface SiapKehadiranRow {
  pertemuanKe: string; // kolom "Pertemuan ke-"
  tanggal: string; // "Senin, 17 Agustus 2026"
  waktu: string; // "09:40 - 12:10"
  kelas: string; // "C (17-08-2026 09:40-12:10)"
  kehadiran: string; // status kehadiran (bisa kosong jika belum terisi)
  waktuAbsen: string; // "-"
  aktor: string; // pencatat absen
}

/** Satu section dalam tabel absensi (`Absensi Kuliah` / `Absensi Ujian`). */
export interface SiapKehadiranSection {
  label: string; // "Absensi Kuliah" | "Absensi Ujian"
  rows: SiapKehadiranRow[];
  message?: string; // "Belum ada data" bila tanpa baris nyata
}

/** Kehadiran satu matakuliah per pertemuan (`id` = `id_trx_pertemuan`). */
export interface SiapKehadiran {
  pertemuanId: string;
  sections: SiapKehadiranSection[];
}

@Injectable()

export class SiapService {
  private readonly logger = new Logger(SiapService.name);
  constructor(@Optional() private readonly cache?: DataCache) {}
  private readonly baseUrl = 'https://siap.undip.ac.id';
  // Probe + authenticated-page fingerprint from docs/2026-08-04-siap-spike.md §2.
  // The dashboard page is the validity probe; `id="tabmhs_profile"` is present
  // on the authenticated dashboard but absent on a login page.
  private readonly probeUrl = 'https://siap.undip.ac.id/pages/mhs/dashboard';
  private readonly authMarker = 'tabmhs_profile';

  async checkSessionValid(siapCookie: string): Promise<SiapSessionCheck> {
    if (!siapCookie) return { valid: false, reason: 'no-cookie' };
    let res: Response;
    try {
      res = await fetch(this.probeUrl, {
        headers: { Cookie: siapCookie },
        redirect: 'follow',
      });
    } catch {
      return { valid: false, reason: 'stale' };
    }
    if (!res.ok) return { valid: false, reason: 'stale' };
    if (/\/login\//i.test(res.url)) return { valid: false, reason: 'stale' };
    const html = await res.text();
    if (!html.includes(this.authMarker)) return { valid: false, reason: 'stale' };
    return { valid: true, reason: 'ok' };
  }

  /**
   * Uniform stale-session error. Any fetch that is not OK, ends on a `/login`
   * URL, or throws (e.g. redirect loop) maps to this 401 so the controller
   * surfaces a friendly "login ulang" prompt instead of a raw error.
   */
  private stale(message = 'Session SIAP expired — silakan login ulang via SSO'): HttpException {
    return new HttpException({ message }, HttpStatus.UNAUTHORIZED);
  }

  /**
   * Fetch a SIAP endpoint and detect a stale session. Returns the response body
   * text. Throws 401 (via `stale()`) when the fetch fails, `!ok`, or the final
   * URL is a login page.
   */
  private async siapFetch(url: string, init?: RequestInit): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      this.logStale(url, null, 'fetch-threw', (e as Error)?.message);
      throw this.stale();
    }
    if (!res.ok) {
      this.logStale(url, res, 'http-not-ok');
      throw this.stale();
    }
    if (/\/login(?:\/|$)/i.test(res.url ?? '')) {
      this.logStale(url, res, 'login-redirect');
      throw this.stale();
    }
    return res.text();
  }

  /**
   * Canonical entry point for SIAP AJAX/JSON endpoints. Like siapFetch, but
   * asserts the response is a JSON body. A stale (or only partially valid)
   * SIAP session commonly makes an AJAX URL return HTTP 200 with `text/html`
   * — the login page rendered in place — which would crash callers calling
   * JSON.parse and surface as a raw 500. Any such HTML (via Content-Type or a
   * bad parse) maps to the uniform `stale()` 401 so the SPA shows a clean
   * "silakan login ulang" prompt instead.
   */
  private async siapFetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      this.logStale(url, null, 'fetch-threw', (e as Error)?.message);
      throw this.stale();
    }
    if (!res.ok) {
      this.logStale(url, res, 'http-not-ok');
      throw this.stale();
    }
    if (/\/login(?:\/|$)/i.test(res.url ?? '')) {
      this.logStale(url, res, 'login-redirect');
      throw this.stale();
    }
    // Tee the body so we can preview it if parsing fails (res.json would consume
    // the original stream first).
    let previewTee: Response | null = null;
    try {
      previewTee = res.clone();
    } catch {
      previewTee = null;
    }
    // Try to parse the body as JSON FIRST. Real SIAP hides a valid JSON body
    // behind a misleading `Content-Type: text/html; charset=UTF-8` (verified
    // live), so rejecting purely on content-type would mislabel a working
    // session as expired. Only when the JSON parse fails do we use the body
    // shape (Content-Type + preview) to decide stale vs upstream error.
    try {
      return (await res.json()) as T;
    } catch {
      const contentType = res.headers.get('content-type') ?? '';
      const preview = await this.readHtmlPreview(previewTee);
      // A `text/html` body that is not parseable JSON is the classic stale-session
      // shape (the login page rendered in place) → uniform stale 401.
      if (/text\/html/i.test(contentType)) {
        this.logStale(url, res, 'html-content-type', `${contentType} body=${preview}`);
        throw this.stale();
      }
      this.logStale(url, res, 'malformed-json', `${contentType} body=${preview}`);
      throw this.stale();
    }
  }

  /**
   * Read the first ~160 chars of an HTML response body (stripped of tags/whitespace)
   * so the log shows whether it is a login page or a real page that needs extra
   * request context. Only safe to call right before throwing, when the body has
   * not already been consumed.
   */
  private async readHtmlPreview(res: Response | null): Promise<string> {
    try {
      if (!res || typeof (res as Response).clone !== 'function') return 'no-preview';
      const body = await res.clone().text();
      return this.truncate(
        body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        160,
      );
    } catch {
      return 'unreadable';
    }
  }

  /**
   * Log the evidence for a `stale()` decision so we can distinguish a genuinely
   * expired session (final URL on /login, or a login-page HTML body) from a
   * valid session whose AJAX endpoint returned something unexpected (e.g. an
   * HTML error page / framework page that needs extra request context).
   */
  private logStale(
    url: string,
    res: Response | null,
    reason: string,
    extra?: string,
  ): void {
    const status = res?.status ?? 'n/a';
    const finalUrl = res?.url ? this.truncate(res.url, 120) : 'n/a';
    const contentType = res?.headers?.get('content-type') ?? 'n/a';
    this.logger.warn(
      `SIAP stale(${reason}) status=${status} finalUrl=${finalUrl} contentType=${contentType} extra=${extra ?? 'n/a'}`,
    );
  }

  private truncate(s: string, n: number): string {
    return s.length <= n ? s : `${s.slice(0, n)}…`;
  }

  /** Extract a `<b>LABEL</b>:</div><div class="col-sm-9">VALUE</div>` row. */
  private pickProfileValue(html: string, label: string): string | undefined {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(
      new RegExp(`<b>${escaped}<\\/b>:<\\/div>\\s*<div class="col-sm-9">([^<]*)<\\/div>`),
    );
    return match ? match[1].trim() : undefined;
  }

  /**
   * Like pickProfileValue, but keeps line breaks (the SIAP address rows use
   * <br> between lines). <br> becomes '\n'-equivalent, remaining tags strip,
   * and whitespace collapses so a multiline address becomes readable single
   * spaces.
   */
  private pickProfileValueHtml(html: string, label: string): string | undefined {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(
      new RegExp(`<b>${escaped}<\\/b>:<\\/div>\\s*<div class="col-sm-9">([\\s\\S]*?)<\\/div>`),
    );
    if (!match) return undefined;
    return match[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** The `#tabmhs_profile` section of the dashboard (server-rendered). */
  private profileSection(html: string): string {
    return html.match(/id="tabmhs_profile"([\s\S]*)/)?.[1] ?? html;
  }

  /** Split an HTML table row into its `<td>` cells (tags stripped, trimmed). */
  private rowCells(row: string): string[] {
    const cells: string[] = [];
    const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(row)) !== null) {
      cells.push(m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    }
    return cells;
  }

  /** Extract data `<tr>` rows (those containing at least one `<td>`). */
  private dataRows(html: string): string[] {
    const rows: string[] = [];
    const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (/<td[^>]*>/i.test(m[1])) rows.push(m[1]);
    }
    return rows;
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Profile is server-rendered on the dashboard page. `#tabmhs_profile` holds
   * NIM/Nama/Fakultas/Prodi/Angkatan; the summary near the status badge holds
   * the current semester label and status. Optional IPK/SKS fields are parsed
   * when present on the page (the tab fixture does not include them) and left
   * undefined otherwise.
   */
  async getProfile(siapCookie: string, userSub?: string): Promise<SiapProfile> {
    if (userSub && this.cache) {
      const hit = await this.cache.get<SiapProfile>(`${userSub}:siap:profile`);
      if (hit) return hit;
    }
    const html = await this.siapFetch(`${this.baseUrl}/pages/mhs/dashboard`, {
      headers: { Cookie: siapCookie },
      redirect: 'follow',
    });
    const tab = this.profileSection(html);

    // Status badge: <span class="badge badge-success">AKTIF</span>
    const status = tab.match(/<span class="badge[^"]*">([^<]+)<\/span>/)?.[1]?.trim() ?? '';
    // Semester label: <p class="text-muted">2026/2027 Ganjil</p>
    const semesterBerjalan =
      tab.match(/<p class="text-muted">([^<]+)<\/p>/)?.[1]?.trim() ?? undefined;

    // Optional summary fields (IPK / SKS) — parsed when present on the page.
    const ipk = this.parseNumber(html, /IPK[^0-9]*([0-9]+(?:[.,][0-9]+)?)/i);

    // Biodata detail (from #tabmhs_profile). <img src="..." alt="Foto"> and the
    // nama-ibu value live behind a click-to-show anchor:
    // <span id="web_span_mn" style="display:none;">IBU UJI</span>
    const fotoUrl = tab.match(/<img src="([^"]+)" alt="Foto"/)?.[1] ?? undefined;
    const namaIbu = tab.match(/id="web_span_mn"[^>]*>([^<]+)</)?.[1]?.trim() ?? undefined;

    const profile: SiapProfile = {
      nama: this.pickProfileValue(tab, 'Nama Lengkap') ?? '',
      nim: this.pickProfileValue(tab, 'NIM') ?? '',
      prodi: this.pickProfileValue(tab, 'Prodi') ?? '',
      fakultas: this.pickProfileValue(tab, 'Fakultas') ?? '',
      angkatan: this.pickProfileValue(tab, 'Angkatan') ?? '',
      jalurMasuk: this.pickProfileValue(tab, 'Jalur Masuk'),
      semesterBerjalan,
      status: status || 'aktif',
      ...(ipk != null ? { ipk } : {}),
      fotoUrl,
      tempatLahir: this.pickProfileValue(tab, 'Tempat lahir'),
      tanggalLahir: this.pickProfileValue(tab, 'Tanggal lahir'),
      nik: this.pickProfileValue(tab, 'NIK'),
      namaIbu,
      kodeKewarganegaraan: this.pickProfileValue(tab, 'Kode kewarganegaraan'),
      nomorHp: this.pickProfileValue(tab, 'Nomor HP'),
      emailSso: this.pickProfileValue(tab, 'Email SSO'),
      emailPribadi: this.pickProfileValue(tab, 'Email pribadi'),
      alamatAsal: this.pickProfileValueHtml(tab, 'Alamat Asal'),
      alamatSekarang: this.pickProfileValueHtml(tab, 'Alamat Sekarang'),
    };
    if (userSub && this.cache) await this.cache.set(`${userSub}:siap:profile`, profile);
    return profile;
  }

  /**
   * IRS: GET /irs/mhs/irs/ajax_irs_diambil returns JSON `{"total_sks":n,"html":"<tr>…"}`.
   * Each `<tr>` is NO, KODE, NAMA, SKS, kelas, status, …; the KODE/NAMA/SKS are
   * the contract fields, kelas/status are carried as optional extras.
   */
  async getIrs(siapCookie: string, userSub?: string): Promise<SiapIrs> {
    if (userSub && this.cache) {
      const hit = await this.cache.get<SiapIrs>(`${userSub}:siap:irs`);
      if (hit) return hit;
    }
    const data = await this.siapFetchJson<{ total_sks?: number | string; html?: string }>(
      `${this.baseUrl}/irs/mhs/irs/ajax_irs_diambil`,
      { headers: { Cookie: siapCookie }, redirect: 'follow' },
    );

    const mataKuliah = this.dataRows(data.html ?? '').map((row) => {
      const c = this.rowCells(row);
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
    if (userSub && this.cache) await this.cache.set(`${userSub}:siap:irs`, irs);
    return irs;
  }

  /** Parse a number from a labelled metric, tolerating comma decimal separators. */
  private parseNumber(html: string, re: RegExp): number | undefined {
    const m = html.match(re);
    if (!m) return undefined;
    const v = Number(m[1].replace(',', '.'));
    return Number.isFinite(v) ? v : undefined;
  }

  /** SIAP prints the official cumulative IPK in every get_khs footer:
   * `IP. Kumulatif … : <value>` (e.g. 3,65 = 292/80). Prefer this over manual emulation. */
  private parseKumulatifIpk(html: string): number | undefined {
    const m = html.match(
      /IP\.\s*Kumulatif[\s\S]*?<\/th>\s*<th\s+class="align-top">:\s*<\/th>\s*<th[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*<\/th>/i,
    );
    if (!m) return undefined;
    const v = Number(m[1].replace(',', '.'));
    return Number.isFinite(v) ? v : undefined;
  }

  private parseKhsNilai(html: string): SiapKhsSemester['nilai'] {
    // An empty semester is rendered as a "-kosong-" placeholder row.
    if (/kosong/i.test(html)) return [];
    const nilai: SiapKhsSemester['nilai'] = [];
    for (const row of this.dataRows(html)) {
      const c = this.rowCells(row);
      // Require at least kode + sks; skip header/footer `th`-only rows.
      if (!c[1] || c.length < 6) continue;
      nilai.push({
        mataKuliah: c[2] ?? '',
        sks: Number(c[5]) || 0,
        nilaiHuruf: c[6] ?? '',
        bobot: Number(c[7]) || 0,
      });
    }
    return nilai;
  }

  /** Total SKS for a semester via POST get_total_sks; falls back to the KHS tfoot. */
  private async fetchTotalSks(
    siapCookie: string,
    body: string,
    khsHtml: string,
  ): Promise<number> {
    try {
      const data = await this.siapFetchJson<{ total_sks?: number | string }>(
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
    const cells = this.dataRows(tfoot).flatMap((r) => this.rowCells(r));
    return Number(cells[2]) || 0;
  }

  /**
   * Semester label for a given semester number, e.g. angkatan 2024, smt 1 →
   * "2024/2025 Ganjil". ta = angkatan + floor((smt-1)/2); odd = Ganjil.
   */
  private semesterLabel(angkatan: string, smt: number): string {
    const ta = Number(angkatan) + Math.floor((smt - 1) / 2);
    return `${ta}/${ta + 1} ${smt % 2 === 1 ? 'Ganjil' : 'Genap'}`;
  }

  /**
   * Number of completed semesters. Preferred: derive from the profile's
   * semester label (e.g. "2026/2027 Ganjil" with angkatan 2024 → 5). Fallback:
   * from the current calendar date (Aug+ = Ganjil of that year).
   */
  private currentSemesterCount(angkatan: string, label: string | undefined): number {
    const m = label?.match(/(\d{4})\/(\d{4})\s+(Ganjil|Genap)/i);
    if (m) {
      const count = (Number(m[2]) - Number(angkatan)) * 2 - (m[3].toLowerCase() === 'ganjil' ? 1 : 0);
      return Math.max(1, count);
    }
    const year = new Date().getFullYear();
    const isGanjil = new Date().getMonth() >= 7; // Aug–Dec
    return Math.max(1, (year - Number(angkatan)) * 2 + (isGanjil ? 1 : 0));
  }

  /**
   * KHS: for each semester POST get_khs (ta/smt_ambil/smt) → HTML table of
   * nilai, and get_total_sks → total SKS. IP per semester = Σ(bobot·sks)/Σ(sks);
   * IPK = Σ(ip·sks)/Σ(sks) across all semesters. Empty ("-kosong-") semesters
   * are included with an empty nilai array and ip 0.
   */
  async getKhs(siapCookie: string, userSub?: string): Promise<SiapKhs> {
    if (userSub && this.cache) {
      const hit = await this.cache.get<SiapKhs>(`${userSub}:siap:khs`);
      if (hit) return hit;
    }
    const profile = await this.getProfile(siapCookie);
    const count = this.currentSemesterCount(profile.angkatan, profile.semesterBerjalan);

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

      const khsHtml = await this.siapFetch(`${this.baseUrl}/irs/mhs/irs/get_khs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: siapCookie,
        },
        body,
      });

      const nilai = this.parseKhsNilai(khsHtml);
      const semesterSks = await this.fetchTotalSks(siapCookie, body, khsHtml);
      lastKhsHtml = khsHtml;

      // Compute the raw (unrounded) per-semester IP for aggregation, and a
      // rounded copy for display. Rounding the per-semester IP before summing
      // into the IPK accumulates error (B11) — e.g. 3.6667→3.67 then ×300
      // drifts the cumulative IPK by a cent.
      const rawIp = nilai.length
        ? nilai.reduce((s, n) => s + (n.bobot ?? 0) * n.sks, 0) / nilai.reduce((s, n) => s + n.sks, 0)
        : 0;

      semesters.push({
        semester: this.semesterLabel(profile.angkatan, smt),
        ip: this.round(rawIp),
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

    const officialIpk = lastKhsHtml ? this.parseKumulatifIpk(lastKhsHtml) : undefined;
    const ipk = officialIpk ?? (totalSks > 0 ? this.round(totalWeighted / totalSks) : 0);
    const khs: SiapKhs = { ipk, semesters };
    if (userSub && this.cache) await this.cache.set(`${userSub}:siap:khs`, khs);
    return khs;
  }

  /**
   * Lecturer per course, scraped from the SIAP IRS semester tables.
   * The `/irs/mhs/irs` page is AJAX-driven: each semester's table loads only
   * when its collapser is expanded via `POST /irs/mhs/irs/get_irs` with
   * `ta`/`smt_ambil`/`smt` params (verified live 2026-08-12). The response is an
   * 8-column table: NO, KODE, MATA KULIAH, KELAS, SKS, RUANG, STATUS, NAMA DOSEN
   * — we read KODE (col 1) + NAMA DOSEN (col 7).
   *
   * We iterate every semester (from the profile's angkatan + semester label, the
   * same count getKhs uses) so that approved past semesters contribute lecturers
   * too. Unapproved semesters return a "belum disetujui" placeholder which parses
   * to nothing. Results are deduped by kode (a course code repeats across
   * semesters; the first approved occurrence wins).
   */
  async getLecturers(siapCookie: string): Promise<{ kode: string; dosen: string }[]> {
    const profile = await this.getProfile(siapCookie);
    const count = this.currentSemesterCount(profile.angkatan, profile.semesterBerjalan);

    const entries = new Map<string, string>();
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) => {
        const smt = i + 1;
        const ta = Number(profile.angkatan) + Math.floor((smt - 1) / 2);
        const smtWithinYear = smt % 2 === 1 ? 1 : 2;
        const body = `ta=${ta}&smt_ambil=${smt}&smt=${smtWithinYear}`;
        return this.siapFetch(`${this.baseUrl}/irs/mhs/irs/get_irs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: siapCookie,
          },
          body,
        }).then((html) => this.parseIrsTable(html));
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
   * spike (Task 1 Step 1). Normalize the upstream response into SiapNotifications.
   *
   * NOTE (live spike finding 2026-08-12): the endpoint is guarded by CI's
   * is_ajax_request() — without `X-Requested-With: XMLHttpRequest` it returns a
   * text/html "This endpoint cannot be accessed directly." body which siapFetchJson
   * maps to a stale 401. The header (set below) is the fix. The upstream payload is
   * `{"status":"ok","data":{"_timestamp":"...","count":"0"}}` (count as a STRING).
   * Normalize defensively: `items` from `data.items` if present, else `[]`; `count`
   * from `data.count`. If a future spike reveals a different list shape, adjust this
   * mapping + the fixture + tests to match the REAL payload.
   */
  async getNotifications(siapCookie: string): Promise<SiapNotifications> {
    const data = await this.siapFetchJson<{ status?: string; data?: any }>(
      `${this.baseUrl}/pages/mhs/dashboard/ajax/notifications`,
      {
        headers: {
          Cookie: siapCookie,
          // SIAP is CodeIgniter-based; this /ajax/ route is guarded by CI's
          // is_ajax_request() which requires the XMLHttpRequest header. Without
          // it the endpoint returns "This endpoint cannot be accessed directly."
          'X-Requested-With': 'XMLHttpRequest',
        },
        redirect: 'follow',
      },
    );
    const raw = data?.data ?? {};
    const items: SiapNotification[] = Array.isArray(raw.items) ? raw.items : [];
    return { count: Number(raw.count) || items.length, items };
  }

  /**
   * Proxy SIAP's mark-unread action. NOTE: the upstream endpoint is literally
   * `/ajax/unread`; the spike must confirm whether it marks read or unread, and
   * the route name/action must match that semantics (see spec §1).
   */
  async markNotification(siapCookie: string, id: string): Promise<{ message: string }> {
    const data = await this.siapFetchJson<{ status?: string; message?: string }>(
      `${this.baseUrl}/pages/mhs/dashboard/ajax/unread`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: siapCookie,
          // Same CI is_ajax_request() guard as getNotifications.
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: `id=${encodeURIComponent(id)}`,
        redirect: 'follow',
      },
    );
    return { message: data?.message ?? 'ok' };
  }

  /**
   * Proxy SIAP's own class-schedule feed. Discovered live 2026-08-14 (spike,
   * see docs/superpowers/spikes/2026-08-14-siap-jadwal-kehadiran-qr.md):
   * `POST /jadwal_mahasiswa/mhs/jadwal/get_jadwal` returns a JSON object keyed
   * by `uuid_pertemuan`, each entry with date/time/room/code. Normalize into a
   * flat `SiapJadwal[]` (mirrors the web type used by `parseJadwal`).
   */
  async getJadwal(siapCookie: string): Promise<SiapJadwal[]> {
    const data = await this.siapFetchJson<Record<string, SiapJadwalUpstream>>(
      `${this.baseUrl}/jadwal_mahasiswa/mhs/jadwal/get_jadwal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: siapCookie,
          // SIAP is CodeIgniter-based; /jadwal_mahasiswa/* AJAX routes are
          // guarded by CI's is_ajax_request() which requires this header.
          'X-Requested-With': 'XMLHttpRequest',
        },
        redirect: 'follow',
      },
    );
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
      });
    }
    return out;
  }

  /**
   * Proxy per-pertemuan attendance (kehadiran) untuk satu matakuliah.
   * Discovered live 2026-08-14 (spike jadwal/kehadiran/QR): `POST
   * /jadwal_mahasiswa/mhs/jadwal/get_absen` body
   * `id=<id_trx_pertemuan>&tipe_mk=mata+kuliah` mengembalikan HTML table
   * dikelompokkan per section (Absensi Kuliah / Absensi Ujian). `id` =
   * `id_trx_pertemuan` dari `get_jadwal`. Di-parse ke SiapKehadiran.
   */
  async getKehadiran(siapCookie: string, pertemuanId: string): Promise<SiapKehadiran> {
    const url = `${this.baseUrl}/jadwal_mahasiswa/mhs/jadwal/get_absen`;
    const html = await this.siapFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: siapCookie,
        // Same CI is_ajax_request() guard as getJadwal / getNotifications.
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: `id=${encodeURIComponent(pertemuanId)}&tipe_mk=${encodeURIComponent('mata kuliah')}`,
    });
    return { pertemuanId, sections: this.parseAbsenTable(html) };
  }

  /**
   * Parse tabel absensi `get_absen.html`: beberapa <tbody>, tiap tbody punya
   * baris label colspan ("Absensi Kuliah"/"Absensi Ujian") lalu baris data
   * 7-kolom (No, Hari/Tanggal, Pertemuan ke-, Kelas, Kehadiran, Waktu Absen,
   * aktor), atau baris colspan pesan ("Belum ada data") bila kosong.
   */
  private parseAbsenTable(html: string): SiapKehadiranSection[] {
    const sections: SiapKehadiranSection[] = [];
    const bodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
    let bm: RegExpExecArray | null;
    while ((bm = bodyRe.exec(html)) !== null) {
      const inner = bm[1];
      let label = '';
      let message: string | undefined;
      const rows: SiapKehadiranRow[] = [];
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(inner)) !== null) {
        const tr = rm[1];
        if (!/<td/i.test(tr)) continue;
        // Baris dengan sel colspan = label section (pertama) atau pesan kosong (berikutnya).
        if (/<td[^>]*\bcolspan\b/i.test(tr)) {
          const cellText = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!label) label = cellText;
          else message = cellText;
          continue;
        }
        // Baris data: 7 sel tunggal. Kolom: 0 No, 1 Hari/Tanggal, 2 Pertemuan ke-,
        // 3 Kelas, 4 Kehadiran, 5 Waktu Absen, 6 aktor.
        const tds: string[] = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let td: RegExpExecArray | null;
        while ((td = tdRe.exec(tr)) !== null) tds.push(td[1]);
        if (tds.length < 7) continue;
        const clean = (c: string) => c.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const dtParts = tds[1].split(/<br\s*\/?>/i);
        rows.push({
          pertemuanKe: clean(tds[2]),
          tanggal: clean(dtParts[0] ?? ''),
          waktu: clean(dtParts.slice(1).join(' ')),
          kelas: clean(tds[3]),
          kehadiran: clean(tds[4]),
          waktuAbsen: clean(tds[5]),
          aktor: clean(tds[6]),
        });
      }
      sections.push({
        label: label || 'kehadiran',
        rows,
        ...(message !== undefined ? { message } : {}),
      });
    }
    return sections;
  }

  /**
   * Proxy a QR-scan presence submission to SIAP. Discovered live 2026-08-14:
   * `POST /master_perkuliahan/mhs/absensi/process/` body `token=<QR content>`
   * returns JSON `{status, message}`. SIAP itself enforces QR validity + expiry
   * (dummy token → 400 "QRcode tidak valid atau sudah expired"), so we only
   * pass the token through and surface the upstream message.
   *
   * Unlike siapFetchJson (which maps every !ok to a 401 stale), a genuine
   * invalid-token 400/500 is NOT a stale session — it must be passed through.
   * Only a login-redirect / non-JSON response is treated as stale 401.
   */
  async markKehadiran(siapCookie: string, token: string): Promise<{ status: string; message?: string }> {
    const url = `${this.baseUrl}/master_perkuliahan/mhs/absensi/process/`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: siapCookie,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: `token=${encodeURIComponent(token)}`,
        redirect: 'follow',
      });
    } catch (e) {
      this.logStale(url, null, 'fetch-threw', (e as Error)?.message);
      throw this.stale();
    }
    // Genuine stale session: landed on a login page.
    if (res.ok && /\/login(?:\/|$)/i.test(res.url ?? '')) {
      this.logStale(url, res, 'login-redirect');
      throw this.stale();
    }
    // Try to parse JSON body (both success 200 and upstream error 400/500 carry it).
    let json: { status?: string; message?: string } | null = null;
    try {
      json = (await res.json()) as { status?: string; message?: string };
    } catch {
      // Non-JSON body: not the QR process API. Treat as stale (upstream changed).
      this.logStale(url, res, 'non-json-process', `status=${res.status}`);
      throw this.stale();
    }
    // Pass through the upstream status + message (success or invalid-token error).
    return { status: json?.status ?? (res.ok ? 'success' : 'error'), message: json?.message };
  }

  /** Parse the 8-column IRS table: KODE = col 1, NAMA DOSEN = col 7. */
  private parseIrsTable(html: string): { kode: string; dosen: string }[] {
    const out: { kode: string; dosen: string }[] = [];
    const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (!/<td/i.test(m[1])) continue;
      // Keep the raw <td> contents (not rowCells) so <br>-separated dosen names
      // survive — they become pipe (|) separated for a cleaner card line.
      const tds: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(m[1])) !== null) tds.push(td[1]);
      // Column 1 = KODE (e.g. MIK1624105); column 7 = NAMA DOSEN (may be empty,
      // multiple names, or whitespace). Only keep rows with a real kode + dosen.
      const kode = (tds[1] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const dosen = (tds[7] ?? '')
        .replace(/<br\s*\/?>/gi, '|') // collapse <br> into a pipe separator
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*\|\s*/g, ' | ') // normalize pipe spacing
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '') // drop leading/trailing pipe
        .trim();
      if (/^[A-Z]{2,3}\d{5,}$/.test(kode) && dosen) {
        out.push({ kode, dosen });
      }
    }
    return out;
  }
}