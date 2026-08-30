import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataCache } from '../cache/data-cache';
import { SessionStore } from '../session/session-store';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { createKeyedSingleFlight } from '../common/single-flight';
import { SiapUpstreamSession } from './siap-upstream.session';
import { SiapApiUpstream } from './siap-api';
import type {
  SiapAbsenItem,
  SiapIrs,
  SiapJadwal,
  SiapKehadiran,
  SiapKhs,
  SiapKhsSemester,
  SiapNotifications,
  SiapProfile,
} from './siap-parse';
import {
  currentSemesterCount,
  lecturersFromIrs,
  parseAbsenTable,
  parseApiAbsen,
  parseApiDaftarKhs,
  parseApiIrs,
  parseApiJadwal,
  parseApiKhs,
  parseApiNotifications,
  parseApiProfile,
  parseNumber,
  pickProfileValue,
  pickProfileValueHtml,
  profileSection,
  round,
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

@Injectable()
export class SiapService {
  /** One session seam: probe + authenticated fetch + stale classification. */
  private readonly upstream: SiapUpstreamSession;
  private readonly apiUpstream: SiapApiUpstream;
  private readonly cache?: DataCache;
  private readonly sessionStore?: SessionStore;
  private readonly config?: ConfigService;
  /** Keyed single-flight per user: N concurrent getKhs/getProfile/getIrs (and
   *  the shared-list methods) share ONE upstream+parse run. D2 done-criteria. */
  private readonly methodFlight = createKeyedSingleFlight<unknown>();
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
        config?.get('SIAP_API_BASE') ??
          'https://api.siap.undip.ac.id/index.php',
        config?.get('SIAP_APP_VER') ?? '24',
      );
    // Wire the seam's identity-scrape fallback to THIS service's fetchProfile
    // (public, preserved). Circular-free: setScrapeIdentity stores a closure.
    this.upstream.setScrapeIdentity(async (siapCookie) => {
      const prof = await this.fetchProfile(siapCookie);
      return { nim: prof.nim, emailSso: prof.emailSso ?? '' };
    });
  }

  private readonly baseUrl = 'https://siap.undip.ac.id';

  /** Get context once; fetch; on api-credential invalidate the cached token,
   *  re-mint via a fresh getContext and retry ONCE. Propagates the ORIGINAL
   *  error on second failure. Guard: reason must be 'api-credential' — a 502
   *  api-endpoint (upstream trouble) must NOT re-mint. */
  private async fetchWithContext<T>(
    sub: string | undefined,
    endpoint: string,
    form: Record<string, string> = {},
  ): Promise<T> {
    try {
      const ctx = await this.upstream.getContext(sub);
      return await this.apiUpstream.fetch<T>(
        endpoint,
        ctx.token,
        form,
        ctx.nim,
      );
    } catch (e) {
      if (e instanceof StaleUpstreamError && e.reason === 'api-credential') {
        if (sub && this.cache) {
          await this.cache.del(`${sub}:siap:token`);
        }
        const fresh = await this.upstream.getContext(sub);
        return await this.apiUpstream.fetch<T>(
          endpoint,
          fresh.token,
          form,
          fresh.nim,
        );
      }
      throw e;
    }
  }

  /** "YYYY/YYYY Ganjil|Genap" from {ta, smt-within-year} label. */
  private semesterLabelFromTa(ta: string, smt: string): string {
    const t = Number(ta);
    const s = Number(smt);
    return `${t}/${t + 1} ${s === 2 ? 'Genap' : 'Ganjil'}`;
  }

  /** Best-effort merge of web-visible profile fields the API may omit (ipk /
   *  emailPribadi / alamatSekarang) from the scrape fallback. Swallow errors. */
  private async mergeProfileFallback(
    profile: SiapProfile,
    sub?: string,
  ): Promise<SiapProfile> {
    if (profile.ipk != null && profile.emailPribadi && profile.alamatSekarang)
      return profile;
    try {
      const cookie = await this.requireSiapCookie(sub);
      const scraped = await this.fetchProfile(cookie);
      return {
        ...profile,
        ipk: profile.ipk ?? scraped.ipk,
        emailPribadi: profile.emailPribadi ?? scraped.emailPribadi,
        alamatSekarang: profile.alamatSekarang ?? scraped.alamatSekarang,
      };
    } catch {
      return profile; // API shape is authoritative; don't fail profile on scrape
    }
  }

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

  /** Cached profile entry point (endpoint API takes only `sub`). ONE getContext
   *  token is reused for data_mahasiswa + semester_aktif (folds the old
   *  double-mint). Whole body runs inside the per-user single-flight so 5
   *  concurrent callers share one mint + one pair of fetches. */
  async getProfile(sub?: string): Promise<SiapProfile> {
    return (await this.methodFlight.run(
      `profile:${sub ?? '__anon__'}`,
      async () => {
        if (sub && this.cache) {
          const hit = await this.cache.get<SiapProfile>(`${sub}:siap:profile`);
          if (hit) return hit;
        }
        const ctx = await this.upstream.getContext(sub);
        const data = await this.apiUpstream.fetch<Record<string, unknown>>(
          'data_mahasiswa',
          ctx.token,
          {},
          ctx.nim,
        );
        const sem = await this.apiUpstream.fetch<{ nm_smt?: string }>(
          'semester_aktif',
          ctx.token,
          {},
          ctx.nim,
        );
        const base = parseApiProfile(data ?? {}, sem);
        // Merge web-visible fields the API may omit, from a scrape fallback.
        const profile = await this.mergeProfileFallback(base, sub);
        if (sub && this.cache)
          await this.cache.set(`${sub}:siap:profile`, profile);
        return profile;
      },
    )) as SiapProfile;
  }

  /**
   * Profile is server-rendered on the dashboard page. `#tabmhs_profile` holds
   * NIM/Nama/Fakultas/Prodi/Angkatan; the summary near the status badge holds
   * the current semester label and status. Parsing lives in siap-parse.
   * Public so AuthService can call it at handoff to capture `emailSso`.
   */
  async fetchProfile(siapCookie: string): Promise<SiapProfile> {
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
   * IRS: getContext ONCE, fetch `v2/lihat_irs` for the CURRENT semester only
   * (semester_aktif label + angkatan drive the count). Returning every past
   * semester made the mobile IRS page list courses from all terms — the IRS
   * contract is the study plan for the on-going term. Retry the whole batch
   * once on api-credential (cache token invalidated + fresh getContext re-mint).
   * Angkatan is resolved from `data_mahasiswa` via the SAME batch token (never
   * a nested getProfile — that would mint a fresh token and invalidate this one).
   * Batch-shaped: ONE token reused across sub-fetches, NOT fetchWithContext per
   * endpoint (M1 — that would mint per endpoint and INCREASE upstream calls).
   */
  async getIrs(sub?: string): Promise<SiapIrs> {
    return (await this.methodFlight.run(
      `irs:${sub ?? '__anon__'}`,
      async () => {
        if (sub && this.cache) {
          const hit = await this.cache.get<SiapIrs>(`${sub}:siap:irs`);
          if (hit) return hit;
        }
        let ctx = await this.upstream.getContext(sub);
        const fetchBatch = async <T>(
          endpoint: string,
          form?: Record<string, string>,
        ) => this.apiUpstream.fetch<T>(endpoint, ctx.token, form, ctx.nim);
        const build = async (): Promise<SiapIrs> => {
          const [sem, data] = await Promise.all([
            fetchBatch<{ nm_smt?: string }>('semester_aktif'),
            fetchBatch<Record<string, unknown>>('data_mahasiswa'),
          ]);
          const semester = sem?.nm_smt ?? '';
          const angkatan = parseApiProfile(data ?? {}, sem).angkatan;
          const count = currentSemesterCount(angkatan, semester);
          const smt = count; // current semester (1-based)
          const ta = Number(angkatan) + Math.floor((smt - 1) / 2);
          const smtWithinYear = smt % 2 === 1 ? 1 : 2;
          const rows = await fetchBatch<Array<Record<string, unknown>>>(
            'v2/lihat_irs',
            {
              ta: String(ta),
              smt_ambil: String(smt),
              smt: String(smtWithinYear),
            },
          );
          const mataKuliah = parseApiIrs(Array.isArray(rows) ? rows : []);
          const totalSks = mataKuliah.reduce((s, m) => s + m.sks, 0);
          return { semester, totalSks, mataKuliah };
        };
        try {
          const irs = await build();
          if (sub && this.cache)
            await this.cache.set(`${sub}:siap:irs`, irs, 15 * 60_000); // M3: 15-min TTL
          return irs;
        } catch (e) {
          if (
            e instanceof StaleUpstreamError &&
            e.reason === 'api-credential'
          ) {
            if (sub && this.cache) await this.cache.del(`${sub}:siap:token`);
            ctx = await this.upstream.getContext(sub); // re-mint
            const irs = await build();
            if (sub && this.cache)
              await this.cache.set(`${sub}:siap:irs`, irs, 15 * 60_000);
            return irs;
          }
          throw e; // original error on second failure
        }
      },
    )) as SiapIrs;
  }

  /**
   * KHS: getContext ONCE, fetch `v2/daftar_khs` (ipk + semester metadata) then
   * `v2/lihat_khs` per semester. `smt_ambil` = cumulative index; `smt` =
   * within-year index the API keys on. Retry the whole batch once on
   * api-credential (cache token invalidated + fresh getContext re-mint).
   */
  async getKhs(sub?: string): Promise<SiapKhs> {
    return (await this.methodFlight.run(
      `khs:${sub ?? '__anon__'}`,
      async () => {
        if (sub && this.cache) {
          const hit = await this.cache.get<SiapKhs>(`${sub}:siap:khs`);
          if (hit) return hit;
        }
        let ctx = await this.upstream.getContext(sub);
        // Batch: ONE token for the whole method (spec §2.2). Retry the whole
        // batch once on an api-credential (fresh token invalidates the old).
        const fetchBatch = async <T>(
          endpoint: string,
          form?: Record<string, string>,
        ) => this.apiUpstream.fetch<T>(endpoint, ctx.token, form, ctx.nim);
        const build = async (): Promise<SiapKhs> => {
          const daftar =
            await fetchBatch<Array<Record<string, unknown>>>('v2/daftar_khs');
          const list = Array.isArray(daftar) ? daftar : [];
          const ipk = parseApiDaftarKhs(list).ipk;
          const semesters: SiapKhsSemester[] = [];
          for (const d of list) {
            const ta = String(d.ta ?? '');
            // smt_ambil = cumulative index; smt = within-year index that v2/lihat_khss keys on.
            const smtAmbil = String(d.smt_ambil ?? '');
            const smt = String(d.smt ?? '');
            const rows = await fetchBatch<Array<Record<string, unknown>>>(
              'v2/lihat_khs',
              { ta, smt_ambil: smtAmbil, smt },
            );
            const nilai = parseApiKhs(Array.isArray(rows) ? rows : []);
            const totalSks = nilai.reduce((s, n) => s + n.sks, 0);
            const rawIp = nilai.length
              ? nilai.reduce((s, n) => s + (n.bobot ?? 0) * n.sks, 0) /
                nilai.reduce((s, n) => s + n.sks, 0)
              : 0;
            // Label always from the TA + within-year smt (NOT semesterLabel('',…)).
            const label = this.semesterLabelFromTa(ta, smt);
            semesters.push({
              semester: label,
              ip: round(rawIp),
              totalSks,
              nilai,
            });
          }
          return { ipk: ipk ?? 0, semesters }; // ipk REQUIRED on SiapKhs
        };
        try {
          const khs = await build();
          if (sub && this.cache)
            await this.cache.set(`${sub}:siap:khs`, khs, 30 * 60_000); // M3: 30-min TTL
          return khs;
        } catch (e) {
          // Retry once on api-credential: invalidate the cached token + re-mint.
          if (
            e instanceof StaleUpstreamError &&
            e.reason === 'api-credential'
          ) {
            if (sub && this.cache) await this.cache.del(`${sub}:siap:token`);
            ctx = await this.upstream.getContext(sub);
            const khs = await build();
            if (sub && this.cache)
              await this.cache.set(`${sub}:siap:khs`, khs, 30 * 60_000);
            return khs;
          }
          throw e; // original error on second failure
        }
      },
    )) as SiapKhs;
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
  async getLecturers(sub?: string): Promise<{ kode: string; dosen: string }[]> {
    return (await this.methodFlight.run(
      `lecturers:${sub ?? '__anon__'}`,
      async () => {
        let ctx = await this.upstream.getContext(sub);
        const fetchBatch = async <T>(
          endpoint: string,
          form?: Record<string, string>,
        ) => this.apiUpstream.fetch<T>(endpoint, ctx.token, form, ctx.nim);
        const build = async (): Promise<{ kode: string; dosen: string }[]> => {
          const [sem, data] = await Promise.all([
            fetchBatch<{ nm_smt?: string }>('semester_aktif'),
            fetchBatch<Record<string, unknown>>('data_mahasiswa'),
          ]);
          const angkatan = parseApiProfile(data ?? {}, sem).angkatan;
          const count = currentSemesterCount(angkatan, sem?.nm_smt ?? '');
          const entries = new Map<string, { kode: string; dosen: string }>();
          for (let smt = 1; smt <= count; smt++) {
            const ta = Number(angkatan) + Math.floor((smt - 1) / 2);
            const smtWithinYear = smt % 2 === 1 ? 1 : 2;
            const rows = await fetchBatch<Array<Record<string, unknown>>>(
              'v2/lihat_irs',
              {
                ta: String(ta),
                smt_ambil: String(smt),
                smt: String(smtWithinYear),
              },
            );
            for (const { kode, dosen } of lecturersFromIrs(
              Array.isArray(rows) ? rows : [],
            )) {
              if (!entries.has(kode)) entries.set(kode, { kode, dosen });
            }
          }
          return Array.from(entries.values());
        };
        try {
          return await build();
        } catch (e) {
          if (
            e instanceof StaleUpstreamError &&
            e.reason === 'api-credential'
          ) {
            if (sub && this.cache) await this.cache.del(`${sub}:siap:token`);
            ctx = await this.upstream.getContext(sub);
            return await build();
          }
          throw e; // original error on second failure
        }
      },
    )) as { kode: string; dosen: string }[];
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
    return (await this.methodFlight.run(
      `notifications:${sub ?? '__anon__'}`,
      async () => {
        if (sub && this.cache) {
          const hit = await this.cache.get<SiapNotifications>(
            `${sub}:siap:notifications`,
          );
          if (hit) return hit;
        }
        const raw = await this.fetchWithContext<Array<Record<string, unknown>>>(
          sub,
          'pengumuman',
        );
        const items = parseApiNotifications(Array.isArray(raw) ? raw : []);
        if (sub && this.cache)
          await this.cache.set(`${sub}:siap:notifications`, items);
        return items;
      },
    )) as SiapNotifications;
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
    return (await this.methodFlight.run(
      `jadwal:${sub ?? '__anon__'}`,
      async () => {
        if (sub && this.cache) {
          const hit = await this.cache.get<SiapJadwal[]>(`${sub}:siap:jadwal`);
          if (hit) return hit;
        }
        const rows = await this.fetchWithContext<
          Array<Record<string, unknown>>
        >(sub, 'jadwal');
        const out = parseApiJadwal(Array.isArray(rows) ? rows : []);
        if (sub && this.cache) {
          await this.cache.set(`${sub}:siap:jadwal`, out);
        }
        return out;
      },
    )) as SiapJadwal[];
  }

  /**
   * Ringkasan hadir (%) per matakuliah dari API `absen` (per-pertemuan rows
   * grouped by kode_mk/idjadwal). `hadir` counts the recorded kehadiran rows;
   * `total` is the number of SCHEDULED meetings for the course (from `jadwal`
   * per-pertemuan), NOT the number of recorded absen rows — the absen API only
   * returns meetings that already have a status, so counting its rows would
   * under-report the total (e.g. 2 recorded vs 14 scheduled). Joins both by
   * kode MIK; a course missing from jadwal keeps its absen-derived total.
   */
  async getAbsen(sub?: string): Promise<SiapAbsenItem[]> {
    return (await this.methodFlight.run(
      `absen:${sub ?? '__anon__'}`,
      async () => {
        if (sub && this.cache) {
          const hit = await this.cache.get<SiapAbsenItem[]>(
            `${sub}:siap:absen`,
          );
          if (hit) return hit;
        }
        const absenRows = await this.fetchWithContext<
          Array<Record<string, unknown>>
        >(sub, 'absen');
        const items = parseApiAbsen(Array.isArray(absenRows) ? absenRows : []);
        // Override `total`/`hadirPct` with the scheduled-meeting count per course.
        // `getJadwal` reuses its own cache + token handling for the per-meeting feed.
        // A jadwal failure must not wipe out absen entirely — fall back to the
        // absen-derived total (best-effort, mirrors mergeProfileFallback).
        try {
          const meetingsByKode = new Map<string, number>();
          for (const j of await this.getJadwal(sub)) {
            const kode = j.kode ?? '';
            if (!kode) continue;
            meetingsByKode.set(kode, (meetingsByKode.get(kode) ?? 0) + 1);
          }
          for (const item of items) {
            const total = meetingsByKode.get(item.kode);
            if (total != null && total > 0) {
              item.total = total;
              item.hadirPct = Math.round((item.hadir / item.total) * 100);
            }
          }
        } catch {
          // keep the absen-derived hadir/total/hadirPct
        }
        if (sub && this.cache) {
          await this.cache.set(`${sub}:siap:absen`, items);
        }
        return items;
      },
    )) as SiapAbsenItem[];
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
    const { httpOk, body } = await this.upstream.fetchJsonAllowingHttpErrors<{
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
