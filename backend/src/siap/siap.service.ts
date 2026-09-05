import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataCache } from '../cache/data-cache';
import { swrWindow } from '../cache/cache-policy';
import { SessionRef, isSessionRef, getRegisteredSessionStore } from '../session/session-store';
import {
  cacheKeyForCurrent,
  cacheKeyForSession,
  flightKeyForCurrent,
  flightKeyForSession,
} from '../session/session-scope';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import { createKeyedSingleFlight } from '../common/single-flight';
import { mapWithConcurrency } from '../common/map-with-concurrency';
import { SiapUpstreamSession } from './siap-upstream.session';
import { SiapApiUpstream } from './siap-api';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type {
  SiapAbsenItem,
  SiapIrs,
  SiapJadwal,
  SiapKehadiran,
  SiapKhs,
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
  /** Keyed single-flight per user: N concurrent getKhs/getProfile/getIrs (and
   *  the shared-list methods) share ONE upstream+parse run. D2 done-criteria. */
  private readonly methodFlight = createKeyedSingleFlight<unknown>();
  constructor(
    @Optional() cache?: DataCache,
    @Optional() upstream?: SiapUpstreamSession,
    @Optional() apiUpstream?: SiapApiUpstream,
    @Optional() config?: ConfigService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    const telemetryRuntime = runtime ?? createNoopTelemetryRuntime();
    this.cache = cache;
    this.upstream = upstream ?? new SiapUpstreamSession(undefined, undefined, undefined, undefined, telemetryRuntime);
    this.apiUpstream =
      apiUpstream ??
      new SiapApiUpstream(
        config?.get('SIAP_API_BASE') ??
          'https://api.siap.undip.ac.id/index.php',
        config?.get('SIAP_APP_VER') ?? '24',
        telemetryRuntime,
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
   *  api-endpoint (upstream trouble) must NOT re-mint.
   *  Token-facing: resolves via the exact-generation snapshot; a B-replacement
   *  is SESSION_DEAD, never B's token. */
  private async fetchWithSessionContext<T>(
    ref: SessionRef,
    endpoint: string,
    form: Record<string, string> = {},
  ): Promise<T> {
    this.requireRef(ref);
    return this.fetchWithResolver<T>(
      () => this.upstream.getContextForSession(ref),
      () => cacheKeyForSession(ref, 'siap', 'token'),
      endpoint,
      form,
    );
  }

  /** CURRENT-session variant for background flows (poller) that own no JWT. */
  private async fetchWithCurrentContext<T>(
    sub: string,
    endpoint: string,
    form: Record<string, string> = {},
  ): Promise<T> {
    let tokenCacheKey: string | undefined;
    return this.fetchWithResolver<T>(
      async () => {
        const ref = await this.upstream.getCurrentSessionRef(sub);
        tokenCacheKey = cacheKeyForSession(ref, 'siap', 'token');
        return this.upstream.getContextForSession(ref);
      },
      () => tokenCacheKey,
      endpoint,
      form,
    );
  }

  /** Shared fetch+once-retry core: the resolver owns the generation policy. */
  private async fetchWithResolver<T>(
    resolve: () => Promise<{ token: string; nim: string }>,
    tokenCacheKey: () => string | undefined,
    endpoint: string,
    form: Record<string, string> = {},
  ): Promise<T> {
    try {
      const ctx = await resolve();
      return await this.apiUpstream.fetch<T>(
        endpoint,
        ctx.token,
        form,
        ctx.nim,
      );
    } catch (e) {
      if (e instanceof StaleUpstreamError && e.reason === 'api-credential') {
        if (this.cache) {
          const key = tokenCacheKey();
          if (key) await this.cache.del(key);
        }
        const fresh = await resolve();
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

  private requireRef(ref: SessionRef): void {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  /** "YYYY/YYYY Ganjil|Genap" from {ta, smt-within-year} label. */
  private semesterLabelFromTa(ta: string, smt: string): string {
    const t = Number(ta);
    const s = Number(smt);
    return `${t}/${t + 1} ${s === 2 ? 'Genap' : 'Ganjil'}`;
  }

  /** Best-effort merge of web-visible profile fields the API may omit (ipk /
   *  emailPribadi / alamatSekarang) from the scrape fallback. Swallow errors.
   *  Token-facing: the fallback scrape uses the exact-generation cookie. */
  private async mergeProfileFallbackForSession(
    profile: SiapProfile,
    ref: SessionRef,
  ): Promise<SiapProfile> {
    if (profile.ipk != null && profile.emailPribadi && profile.alamatSekarang)
      return profile;
    try {
      const cookie = await this.upstream.getCookieForSession(ref);
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
   * Single seam for the stored SIAP page cookie on token-facing paths.
   * Delegates to the upstream adapter's exact-generation read — no duplicate
   * `sessionStore.get` lives here, so cookies are retrieved in exactly one
   * place and a B-replacement is SESSION_DEAD, never B's cookie.
   */
  private async requireSiapCookieForSession(ref: SessionRef): Promise<string> {
    this.requireRef(ref);
    return this.upstream.getCookieForSession(ref);
  }

  async checkSessionValid(siapCookie: string): Promise<SiapSessionCheck> {
    return this.upstream.checkSessionValid(siapCookie);
  }

  private async fetchProfileData(ref: SessionRef): Promise<SiapProfile> {
    this.requireRef(ref);
    const ctx = await this.upstream.getContextForSession(ref);
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
    const profile = await this.mergeProfileFallbackForSession(base, ref);
    return profile;
  }

  /** Cached profile entry point (endpoint API takes the exact SessionRef).
   *  ONE getContext token is reused for data_mahasiswa + semester_aktif (folds
   *  the old double-mint). Whole body runs inside the per-user single-flight
   *  so 5 concurrent callers share one mint + one pair of fetches. */
  async getProfile(ref: SessionRef): Promise<SiapProfile> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'profile'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapProfile>(
            cacheKeyForSession(ref, 'siap', 'profile'),
            () => this.fetchProfileData(ref),
            swrWindow('SIAP_PROFILE'),
          );
          return value;
        }
        return this.fetchProfileData(ref);
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
  private async fetchIrs(ref: SessionRef): Promise<SiapIrs> {
    this.requireRef(ref);
    let ctx = await this.upstream.getContextForSession(ref);
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
      return irs;
    } catch (e) {
      if (e instanceof StaleUpstreamError && e.reason === 'api-credential') {
        if (this.cache) await this.cache.del(cacheKeyForSession(ref, 'siap', 'token'));
        ctx = await this.upstream.getContextForSession(ref); // re-mint
        const irs = await build();
        return irs;
      }
      throw e; // original error on second failure
    }
  }

  async getIrs(ref: SessionRef): Promise<SiapIrs> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'irs'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapIrs>(
            cacheKeyForSession(ref, 'siap', 'irs'),
            () => this.fetchIrs(ref),
            swrWindow('SIAP_IRS'),
          );
          return value;
        }
        return this.fetchIrs(ref);
      },
    )) as SiapIrs;
  }

  /**
   * KHS: getContext ONCE, fetch `v2/daftar_khs` (ipk + semester metadata) then
   * `v2/lihat_khs` per semester. `smt_ambil` = cumulative index; `smt` =
   * within-year index the API keys on. Retry the whole batch once on
   * api-credential (cache token invalidated + fresh getContext re-mint).
   */
  private async fetchKhs(ref: SessionRef): Promise<SiapKhs> {
    this.requireRef(ref);
    let ctx = await this.upstream.getContextForSession(ref);
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
      // Bounded 4-way concurrency: upstream SIAP is the bottleneck, not CPU;
      // order preserved so `semesters` stays in `list` order.
      const semesters = await mapWithConcurrency(list, 4, async (d) => {
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
        return {
          semester: label,
          ip: round(rawIp),
          totalSks,
          nilai,
        };
      });
      return { ipk: ipk ?? 0, semesters }; // ipk REQUIRED on SiapKhs
    };
    try {
      const khs = await build();
      return khs;
    } catch (e) {
      // Retry once on api-credential: invalidate the cached token + re-mint.
      if (e instanceof StaleUpstreamError && e.reason === 'api-credential') {
        if (this.cache) await this.cache.del(cacheKeyForSession(ref, 'siap', 'token'));
        ctx = await this.upstream.getContextForSession(ref);
        const khs = await build();
        return khs;
      }
      throw e; // original error on second failure
    }
  }

  async getKhs(ref: SessionRef): Promise<SiapKhs> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'khs'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapKhs>(
            cacheKeyForSession(ref, 'siap', 'khs'),
            () => this.fetchKhs(ref),
            swrWindow('SIAP_KHS'),
          );
          return value;
        }
        return this.fetchKhs(ref);
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
  private async fetchLecturers(
    ref: SessionRef,
  ): Promise<{ kode: string; dosen: string }[]> {
    this.requireRef(ref);
    let ctx = await this.upstream.getContextForSession(ref);
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
      // Bounded 4-way concurrency: upstream SIAP is the bottleneck, not CPU;
      // order preserved so ascending-smt dedup order is unchanged.
      const rowsBySmt = await mapWithConcurrency(
        Array.from({ length: count }, (_, i) => i + 1),
        4,
        async (smt) => {
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
          return Array.isArray(rows) ? rows : [];
        },
      );
      for (const rows of rowsBySmt) {
        for (const { kode, dosen } of lecturersFromIrs(rows)) {
          if (!entries.has(kode)) entries.set(kode, { kode, dosen });
        }
      }
      const result = Array.from(entries.values());
      return result;
    };
    try {
      return await build();
    } catch (e) {
      if (e instanceof StaleUpstreamError && e.reason === 'api-credential') {
        if (this.cache) await this.cache.del(cacheKeyForSession(ref, 'siap', 'token'));
        ctx = await this.upstream.getContextForSession(ref);
        return await build();
      }
      throw e; // original error on second failure
    }
  }

  async getLecturers(ref: SessionRef): Promise<{ kode: string; dosen: string }[]> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'lecturers'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<
            {
              kode: string;
              dosen: string;
            }[]
          >(
            cacheKeyForSession(ref, 'siap', 'lecturers'),
            () => this.fetchLecturers(ref),
            swrWindow('SIAP_LECTURERS'),
          );
          return value;
        }
        return this.fetchLecturers(ref);
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
  private async fetchNotifications(ref: SessionRef): Promise<SiapNotifications> {
    this.requireRef(ref);
    const raw = await this.fetchWithSessionContext<Array<Record<string, unknown>>>(
      ref,
      'pengumuman',
    );
    const items = parseApiNotifications(Array.isArray(raw) ? raw : []);
    return items;
  }

  async getNotifications(ref: SessionRef): Promise<SiapNotifications> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'notifications'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapNotifications>(
            cacheKeyForSession(ref, 'siap', 'notifications'),
            () => this.fetchNotifications(ref),
            swrWindow('SIAP_NOTIFICATIONS'),
          );
          return value;
        }
        return this.fetchNotifications(ref);
      },
    )) as SiapNotifications;
  }

  /**
   * Proxy SIAP's mark-unread action. NOTE: the upstream endpoint is literally
   * `/ajax/unread`; the spike must confirm whether it marks read or unread, and
   * the route name/action must match that semantics (see spec §1).
   */
  async markNotification(
    ref: SessionRef,
    id: string,
  ): Promise<{ message: string }> {
    this.requireRef(ref);
    const siapCookie = await this.requireSiapCookieForSession(ref);
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
  private async fetchJadwal(ref: SessionRef): Promise<SiapJadwal[]> {
    this.requireRef(ref);
    const rows = await this.fetchWithSessionContext<Array<Record<string, unknown>>>(
      ref,
      'jadwal',
    );
    const out = parseApiJadwal(Array.isArray(rows) ? rows : []);
    return out;
  }

  async getJadwal(ref: SessionRef): Promise<SiapJadwal[]> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'jadwal'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapJadwal[]>(
            cacheKeyForSession(ref, 'siap', 'jadwal'),
            () => this.fetchJadwal(ref),
            swrWindow('SIAP_JADWAL'),
          );
          return value;
        }
        return this.fetchJadwal(ref);
      },
    )) as SiapJadwal[];
  }

  /**
   * CURRENT-session variant for background flows (NotificationsPoller) that
   * own no JWT: the current live record, whatever its generation. Never call
   * from an authenticated controller/service path.
   */
  async getJadwalForCurrentSession(sub: string): Promise<SiapJadwal[]> {
    return (await this.methodFlight.run(
      flightKeyForCurrent(sub, 'jadwal'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapJadwal[]>(
            cacheKeyForCurrent(sub, 'siap', 'jadwal'),
            async () => {
              const rows = await this.fetchWithCurrentContext<Array<Record<string, unknown>>>(
                sub,
                'jadwal',
              );
              return parseApiJadwal(Array.isArray(rows) ? rows : []);
            },
            swrWindow('SIAP_JADWAL'),
          );
          return value;
        }
        const rows = await this.fetchWithCurrentContext<Array<Record<string, unknown>>>(
          sub,
          'jadwal',
        );
        return parseApiJadwal(Array.isArray(rows) ? rows : []);
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
  private async fetchAbsen(ref: SessionRef): Promise<SiapAbsenItem[]> {
    this.requireRef(ref);
    const absenRows = await this.fetchWithSessionContext<Array<Record<string, unknown>>>(
      ref,
      'absen',
    );
    const items = parseApiAbsen(Array.isArray(absenRows) ? absenRows : []);
    // Override `total`/`hadirPct` with the scheduled-meeting count per course.
    // `getJadwal` reuses its own cache + token handling for the per-meeting feed.
    // A jadwal failure must not wipe out absen entirely — fall back to the
    // absen-derived total (best-effort, mirrors mergeProfileFallback).
    try {
      const meetingsByKode = new Map<string, number>();
      for (const j of await this.getJadwal(ref)) {
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
    return items;
  }

  async getAbsen(ref: SessionRef): Promise<SiapAbsenItem[]> {
    this.requireRef(ref);
    return (await this.methodFlight.run(
      flightKeyForSession(ref, 'absen'),
      async () => {
        if (this.cache) {
          const { value } = await this.cache.getStale<SiapAbsenItem[]>(
            cacheKeyForSession(ref, 'siap', 'absen'),
            () => this.fetchAbsen(ref),
            swrWindow('SIAP_ABSEN'),
          );
          return value;
        }
        return this.fetchAbsen(ref);
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
    ref: SessionRef,
    pertemuanId: string,
  ): Promise<SiapKehadiran> {
    this.requireRef(ref);
    const siapCookie = await this.requireSiapCookieForSession(ref);
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
    ref: SessionRef,
    token: string,
  ): Promise<{ status: string; message?: string }> {
    this.requireRef(ref);
    const siapCookie = await this.requireSiapCookieForSession(ref);
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
