import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

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

@Injectable()
export class SiapService {
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
    } catch {
      throw this.stale();
    }
    if (!res.ok) throw this.stale();
    if (/\/login(?:\/|$)/i.test(res.url ?? '')) throw this.stale();
    return res.text();
  }

  /** Extract a `<b>LABEL</b>:</div><div class="col-sm-9">VALUE</div>` row. */
  private pickProfileValue(html: string, label: string): string | undefined {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(
      new RegExp(`<b>${escaped}<\\/b>:<\\/div>\\s*<div class="col-sm-9">([^<]*)<\\/div>`),
    );
    return match ? match[1].trim() : undefined;
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
  async getProfile(siapCookie: string): Promise<SiapProfile> {
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

    return {
      nama: this.pickProfileValue(tab, 'Nama Lengkap') ?? '',
      nim: this.pickProfileValue(tab, 'NIM') ?? '',
      prodi: this.pickProfileValue(tab, 'Prodi') ?? '',
      fakultas: this.pickProfileValue(tab, 'Fakultas') ?? '',
      angkatan: this.pickProfileValue(tab, 'Angkatan') ?? '',
      jalurMasuk: this.pickProfileValue(tab, 'Jalur Masuk'),
      semesterBerjalan,
      status: status || 'aktif',
      ...(ipk != null ? { ipk } : {}),
    };
  }

  /**
   * IRS: GET /irs/mhs/irs/ajax_irs_diambil returns JSON `{"total_sks":n,"html":"<tr>…"}`.
   * Each `<tr>` is NO, KODE, NAMA, SKS, kelas, status, …; the KODE/NAMA/SKS are
   * the contract fields, kelas/status are carried as optional extras.
   */
  async getIrs(siapCookie: string): Promise<SiapIrs> {
    const body = await this.siapFetch(`${this.baseUrl}/irs/mhs/irs/ajax_irs_diambil`, {
      headers: { Cookie: siapCookie },
      redirect: 'follow',
    });
    const data = JSON.parse(body) as { total_sks?: number | string; html?: string };

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

    return {
      // The ajax_irs_diambil payload does not carry the semester label itself.
      semester: '',
      totalSks: Number(data.total_sks) || 0,
      mataKuliah,
    };
  }

  /** Parse a number from a labelled metric, tolerating comma decimal separators. */
  private parseNumber(html: string, re: RegExp): number | undefined {
    const m = html.match(re);
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
      const res = await this.siapFetch(
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
      const data = JSON.parse(res) as { total_sks?: number | string };
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
  async getKhs(siapCookie: string): Promise<SiapKhs> {
    const profile = await this.getProfile(siapCookie);
    const count = this.currentSemesterCount(profile.angkatan, profile.semesterBerjalan);

    const semesters: SiapKhsSemester[] = [];
    let totalWeighted = 0;
    let totalSks = 0;

    for (let smt = 1; smt <= count; smt++) {
      const ta = Number(profile.angkatan) + Math.floor((smt - 1) / 2);
      const body = `ta=${ta}&smt_ambil=${smt}&smt=${smt}`;

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

      const ip = nilai.length
        ? this.round(nilai.reduce((s, n) => s + (n.bobot ?? 0) * n.sks, 0) / nilai.reduce((s, n) => s + n.sks, 0))
        : 0;

      semesters.push({
        semester: this.semesterLabel(profile.angkatan, smt),
        ip,
        totalSks: semesterSks,
        nilai,
      });

      totalWeighted += ip * semesterSks;
      totalSks += semesterSks;
    }

    const ipk = totalSks > 0 ? this.round(totalWeighted / totalSks) : 0;
    return { ipk, semesters };
  }
}