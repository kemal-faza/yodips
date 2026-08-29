/**
 * Pure SIAP HTML/JSON → typed-data parsers. Fixture-in, result-out: no DI,
 * no fetch, no session plumbing — transport lives in siap-upstream.session,
 * orchestration in SiapService. Upstream-HTML quirks concentrate here
 * (Laravel server-render + CodeIgniter AJAX table shapes).
 */

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
  /** Kurikulum/strata (dari data_mahasiswa API; opsional). */
  kurikulum?: string;
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
  nilai: Array<{
    mataKuliah: string;
    sks: number;
    nilaiHuruf: string;
    bobot?: number;
  }>;
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
  /** Per-pertemuan date `yyyy-MM-dd` from `tanggal_pertemuan` (calendar source; also covers rescheduled meetings). */
  tanggal?: string;
}

/** Ringkasan kehadiran per matakuliah dari halaman index jadwal SIAP. */
export interface SiapAbsenItem {
  idJadwal: string;
  /** Kode MIK matkul — kunci join yang lebih stabil daripada nama. */
  kode: string;
  nama: string;
  hadirPct: number;
  /** Jumlah pertemuan yang tercatat hadir (dari detil get_absen per matkul). */
  hadir: number;
  /** Total pertemuan yang tercatat (dari detil get_absen per matkul). */
  total: number;
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

/** Extract a `<b>LABEL</b>:</div><div class="col-sm-9">VALUE</div>` row. */
export function pickProfileValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(
    new RegExp(
      `<b>${escaped}<\\/b>:<\\/div>\\s*<div class="col-sm-9">([^<]*)<\\/div>`,
    ),
  );
  return match ? match[1].trim() : undefined;
}

/**
 * Like pickProfileValue, but keeps line breaks (the SIAP address rows use
 * <br> between lines). <br> becomes '\n'-equivalent, remaining tags strip,
 * and whitespace collapses so a multiline address becomes readable single
 * spaces.
 */
export function pickProfileValueHtml(
  html: string,
  label: string,
): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(
    new RegExp(
      `<b>${escaped}<\\/b>:<\\/div>\\s*<div class="col-sm-9">([\\s\\S]*?)<\\/div>`,
    ),
  );
  if (!match) return undefined;
  return match[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The `#tabmhs_profile` section of the dashboard (server-rendered). */
export function profileSection(html: string): string {
  return html.match(/id="tabmhs_profile"([\s\S]*)/)?.[1] ?? html;
}

/** Split an HTML table row into its `<td>` cells (tags stripped, trimmed). */
export function rowCells(row: string): string[] {
  const cells: string[] = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row)) !== null) {
    cells.push(
      m[1]
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return cells;
}

/** Extract data `<tr>` rows (those containing at least one `<td>`). */
export function dataRows(html: string): string[] {
  const rows: string[] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (/<td[^>]*>/i.test(m[1])) rows.push(m[1]);
  }
  return rows;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a number from a labelled metric, tolerating comma decimal separators. */
export function parseNumber(html: string, re: RegExp): number | undefined {
  const m = html.match(re);
  if (!m) return undefined;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

/** SIAP prints the official cumulative IPK in every get_khs footer:
 * `IP. Kumulatif … : <value>` (e.g. 3,65 = 292/80). Prefer this over manual emulation. */
export function parseKumulatifIpk(html: string): number | undefined {
  const m = html.match(
    /IP\.\s*Kumulatif[\s\S]*?<\/th>\s*<th\s+class="align-top">:\s*<\/th>\s*<th[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*<\/th>/i,
  );
  if (!m) return undefined;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

export function parseKhsNilai(
  html: string,
): SiapKhsSemester['nilai'] {
  // An empty semester is rendered as a "-kosong-" placeholder row.
  if (/kosong/i.test(html)) return [];
  const nilai: SiapKhsSemester['nilai'] = [];
  for (const row of dataRows(html)) {
    const c = rowCells(row);
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

/**
 * Semester label for a given semester number, e.g. angkatan 2024, smt 1 →
 * "2024/2025 Ganjil". ta = angkatan + floor((smt-1)/2); odd = Ganjil.
 */
export function semesterLabel(angkatan: string, smt: number): string {
  const ta = Number(angkatan) + Math.floor((smt - 1) / 2);
  return `${ta}/${ta + 1} ${smt % 2 === 1 ? 'Ganjil' : 'Genap'}`;
}

/**
 * Number of completed semesters. Preferred: derive from the profile's
 * semester label (e.g. "2026/2027 Ganjil" with angkatan 2024 → 5). Fallback:
 * from the current calendar date (Aug+ = Ganjil of that year).
 */
export function currentSemesterCount(
  angkatan: string,
  label: string | undefined,
): number {
  const m = label?.match(/(\d{4})\/(\d{4})\s+(Ganjil|Genap)/i);
  if (m) {
    const count =
      (Number(m[2]) - Number(angkatan)) * 2 -
      (m[3].toLowerCase() === 'ganjil' ? 1 : 0);
    return Math.max(1, count);
  }
  const year = new Date().getFullYear();
  const isGanjil = new Date().getMonth() >= 7; // Aug–Dec
  return Math.max(1, (year - Number(angkatan)) * 2 + (isGanjil ? 1 : 0));
}

/** Parse ringkasan hadir dari tabel index jadwal (baris dengan progress-bar). */
export function parseAbsenSummary(html: string): SiapAbsenItem[] {
  const out: SiapAbsenItem[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html)) !== null) {
    const tr = rm[1];
    if (
      !/<div\b[^>]*progress-bar/i.test(tr) &&
      !/progress-bar[^"]*"/i.test(tr)
    )
      continue;
    const tds: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr)) !== null) tds.push(td[1]);
    if (tds.length < 7) continue;
    const clean = (c: string) =>
      c
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const nama = clean(tds[2]);
    const pctRaw = tr.match(/aria-valuenow="([0-9.]+)"/i)?.[1];
    const idJadwal = tr.match(/data-id="([0-9]+)"/i)?.[1] ?? '';
    if (!nama || pctRaw === undefined) continue;
    const pct = Number(pctRaw.replace(',', '.'));
    out.push({
      idJadwal,
      nama,
      hadirPct: Number.isFinite(pct) ? pct : 0,
      hadir: 0,
      total: 0,
    });
  }
  return out;
}

/**
 * Parse tabel absensi `get_absen.html`: beberapa <tbody>, tiap tbody punya
 * baris label colspan ("Absensi Kuliah"/"Absensi Ujian") lalu baris data
 * 7-kolom (No, Hari/Tanggal, Pertemuan ke-, Kelas, Kehadiran, Waktu Absen,
 * aktor), atau baris colspan pesan ("Belum ada data") bila kosong.
 */
export function parseAbsenTable(html: string): SiapKehadiranSection[] {
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
      const clean = (c: string) =>
        c
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
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

/** Parse the 8-column IRS table: KODE = col 1, NAMA DOSEN = col 7. */
export function parseIrsTable(html: string): { kode: string; dosen: string }[] {
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
    const kode = (tds[1] ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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

// ---------------------------------------------------------------------------
// Official SIAP API parsers (api.siap.undip.ac.id/index.php/*) — JSON → typed.
// Kept in the same pure module so the mapping is unit-testable without transport.
// ---------------------------------------------------------------------------

/** Map API `data_mahasiswa` + `semester_aktif` into SiapProfile */
export function parseApiProfile(
  data: Record<string, unknown>,
  semester?: { nm_smt?: string },
): SiapProfile {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const p: SiapProfile = {
    nama: str(data.nama) ?? '',
    nim: str(data.nim) ?? '',
    prodi: str(data.nama_ps) ?? '',
    fakultas: str(data.namafak) ?? '',
    angkatan: str(data.tahun_masuk) ?? '',
    emailSso: str(data.sso_email) ?? str(data.sso_email_alt),
    status: str(data.status_terakhir) ?? 'aktif',
    fotoUrl: str(data.foto),
    tempatLahir: str(data.tempat_lahir),
    tanggalLahir: str(data.tanggal_lahir),
    nik: str(data.no_id),
    namaIbu: str(data.nama_ibu),
    kurikulum: str(data.kurikulum),
    kodeKewarganegaraan: str(data.kode_negara),
    nomorHp: str(data.hp),
    jalurMasuk: str(data.jalur_masuk),
    emailPribadi: str(data.email_pribadi),
    // Web consumes these (profile Kontak/Alamat groups + IPK summary) — keep
    // them present even when the API omits them (best-effort; they may be
    // filled from a scrape in getProfile when absent).
    ipk: data.ipk != null ? Number(String(data.ipk).replace(',', '.')) : undefined,
    sksTempuh: data.sks_tempuh != null ? Number(data.sks_tempuh) : undefined,
    sksLulus: data.sks_lulus != null ? Number(data.sks_lulus) : undefined,
    alamatAsal: str(data.alamat),
    alamatSekarang: str(data.alamat_sekarang),
    semesterBerjalan: semester?.nm_smt,
  };
  return p;
}

/** Map API `jadwal` rows (array) into SiapJadwal[] */
export function parseApiJadwal(
  rows: Array<Record<string, unknown>>,
): SiapJadwal[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return rows.map((r) => {
    const start = str(r.waktu_mulai) ?? '';
    const end = str(r.waktu_selesai) ?? '';
    return {
      kode: str(r.kode_mk),
      hari: str(r.hari) ?? '',
      matakuliah: str(r.nama_mk) ?? '',
      ruang: str(r.nama_ruang),
      // Keep the legacy "s/d" separator the mobile ScheduleScreen regex expects.
      waktu: [start, end].filter(Boolean).join(' s/d '),
      sks: num(r.sks),
      tanggal: str(r.tanggal_pertemuan),
    };
  });
}

/** Map API `v2/lihat_khs` rows into SiapKhsSemester['nilai'] */
export function parseApiKhs(
  rows: Array<Record<string, unknown>>,
): SiapKhsSemester['nilai'] {
  return rows.map((r) => ({
    mataKuliah: String(r.nama_mk ?? ''),
    sks: Number(r.sks_mk) || 0,
    nilaiHuruf: String(r.nilai_akhir_huruf ?? ''),
    bobot: Number(r.nilai_bobot) || 0,
  }));
}

/** Map API `v2/daftar_khs` rows into ipk + semester metadata list. */
export function parseApiDaftarKhs(
  rows: Array<Record<string, unknown>>,
): { ipk?: number; semesters: { ta: string; smt: string; smtAmbil: string }[] } {
  const semesters = rows.map((r) => ({
    ta: String(r.ta ?? ''),
    smt: String(r.smt ?? ''),
    smtAmbil: String(r.smt_ambil ?? ''),
  }));
  const rawIpk = rows[0]?.ipk;
  const ipk = rawIpk != null ? Number(String(rawIpk).replace(',', '.')) : undefined;
  return { ...(ipk != null && Number.isFinite(ipk) ? { ipk } : {}), semesters };
}

/** Map API `v2/lihat_irs` rows into SiapIrs['mataKuliah'] */
export function parseApiIrs(
  rows: Array<Record<string, unknown>>,
): SiapIrs['mataKuliah'] {
  return rows.map((r) => ({
    kode: String(r.kode_mk ?? ''),
    nama: String(r.nama_mk ?? ''),
    sks: Number(r.sks_mk) || 0,
    kelas: (r.nama_kelas as string) || undefined,
    jadwal: (r.jadwal as string) || undefined,
    dosen: (r.nama_dosen as string) || undefined,
    status: 'rencana',
  }));
}

const KODE_MK_RE = /^[A-Z]{2,3}\d{5,}$/;

/** Extract lecturer list from `v2/lihat_irs` rows (kode + joined dosen via |). */
export function lecturersFromIrs(
  rows: Array<Record<string, unknown>>,
): { kode: string; dosen: string }[] {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const kode = String(r.kode_mk ?? '');
    if (!KODE_MK_RE.test(kode)) continue;
    const dosen = String(r.nama_dosen ?? '').trim();
    if (!dosen) continue;
    if (!map.has(kode)) map.set(kode, new Set());
    map.get(kode)!.add(dosen);
  }
  return Array.from(map, ([kode, set]) => ({ kode, dosen: Array.from(set).join(' | ') }));
}

/** Map API `absen` rows into SiapAbsenItem[], grouped by kode_mk/idjadwal. */
export function parseApiAbsen(
  rows: Array<Record<string, unknown>>,
): SiapAbsenItem[] {
  const map = new Map<string, SiapAbsenItem>();
  for (const r of rows) {
    const kode = String(r.kode_mk ?? '');
    const idJadwal = String(r.idjadwal ?? '');
    const nama = String(r.nama_mk ?? '');
    const key = idJadwal || kode;
    if (!map.has(key)) {
      map.set(key, { idJadwal, kode, nama, hadir: 0, total: 0, hadirPct: 0 });
    }
    const item = map.get(key)!;
    item.total += 1;
    if (String(r.kehadiran ?? '').trim().toLowerCase() === 'hadir') item.hadir += 1;
  }
  for (const item of map.values()) {
    item.hadirPct = item.total > 0 ? Math.round((item.hadir / item.total) * 100) : 0;
  }
  return Array.from(map.values());
}

/** Map API `pengumuman` rows into SiapNotifications */
export function parseApiNotifications(
  rows: Array<Record<string, unknown>>,
): SiapNotifications {
  const items: SiapNotification[] = rows.map((r) => ({
    id: String(r.id ?? ''),
    title: String(r.judul ?? r.title ?? ''),
    message: String(r.isi ?? r.message ?? ''),
    timestamp: String(r.created_at ?? r.timestamp ?? ''),
    read: Boolean(r.read),
    type: (r.jenis ?? r.type ?? 'info') as SiapNotification['type'],
  }));
  return { count: items.length, items };
}
