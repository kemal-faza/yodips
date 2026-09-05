import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { createKeyedSingleFlight } from '../common/single-flight';
import { DataCache } from '../cache/data-cache';
import { swrWindow } from '../cache/cache-policy';
import { SiapService } from '../siap/siap.service';
import { SessionRef, SessionStore, isSessionRef } from '../session/session-store';
import {
  cacheKeyForCurrent,
  cacheKeyForSession,
  flightKeyForCurrent,
  flightKeyForSession,
} from '../session/session-scope';
import {
  KulonUpstreamSession,
  KULON_ROUTE_CONTEXTS,
  parseSesskey as parseSesskeyHtml,
} from './kulon-upstream.session';
import type {
  KulonAssignment,
  KulonAssignmentDetail,
  KulonCourse,
  KulonCourseContent,
  KulonSessionCheck,
} from './kulon-parse';
import {
  extractCourseCode,
  extractCourseModuleId,
  extractDescription,
  extractFiles,
  extractName,
  mapCourseStateJson,
  parseAssignmentIndex,
  parseContentHtml,
  parseQuizIndex,
  parseSectionProgress,
  parseSemester,
  parseSubmissionFromHtml,
} from './kulon-parse';
import { htmlToMarkdown } from './html-to-markdown';
import {
  getTimedFetchTransportReason,
  isLoginRedirect,
  StaleUpstreamError,
  timedFetch,
  type UpstreamAttemptResult,
  type UpstreamRouteContext,
} from '../upstream/upstream-fetch';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type { UpstreamReason } from '../observability/telemetry-contract';

const kulonPageCompatibilityErrors = new WeakSet<object>();

type KulonScope =
  | { kind: 'session'; ref: SessionRef }
  | { kind: 'current'; sub: string };

function normalizeKulonScope(scope?: KulonScope | string): KulonScope | undefined {
  if (typeof scope === 'string') return { kind: 'current', sub: scope };
  return scope;
}

function kulonCacheKey(scope: KulonScope, ...parts: string[]): string {
  return scope.kind === 'session'
    ? cacheKeyForSession(scope.ref, 'kulon', ...parts)
    : cacheKeyForCurrent(scope.sub, 'kulon', ...parts);
}

/** Mark the exact legacy plain Error used for expected Moodle page incompatibilities. */
export function markKulonPageCompatibilityError(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    kulonPageCompatibilityErrors.add(error);
  }
}

/** Identify a marked 404/3xx page error without changing its class or message. */
export function isKulonPageCompatibilityError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    ? kulonPageCompatibilityErrors.has(error)
    : false;
}

function httpErrorResult<T>(error: unknown, status: number): UpstreamAttemptResult<T> {
  return { ok: false, error, outcome: 'http_error', reason: 'http-not-ok', status };
}

function staleResult<T>(
  error: unknown,
  reason: UpstreamReason,
  status: number,
): UpstreamAttemptResult<T> {
  return { ok: false, error, outcome: 'stale', reason, status };
}

/** Detect Moodle's login document when a proxy returns it as a successful page. */
function isKulonLoginPage(html: string): boolean {
  return (
    /<body\b[^>]*\bid=["']page-login-index["']/i.test(html) ||
    /<form\b[^>]*\bid=["']login["']/i.test(html) ||
    /<form\b[^>]*\baction=["'][^"']*\/login\/index\.php(?:["'?])/i.test(html) ||
    /<title>\s*(?:log\s+in|login)(?:\s*(?:[|:-]|<\/title>))/i.test(html)
  );
}

// Public data shapes + pure parsing helpers moved to kulon-parse.ts —
// re-exported so existing imports keep working.
export type {
  KulonAssignment,
  KulonAssignmentDetail,
  KulonContentItem,
  KulonContentItemKind,
  KulonCourse,
  KulonCourseContent,
  KulonFile,
  KulonFileType,
  KulonSection,
  KulonSessionCheck,
  KulonSubmission,
} from './kulon-parse';
export {
  deriveSectionLabel,
  extractCourseCode,
  extractFileType,
  parseSectionProgress,
  parseSemester,
} from './kulon-parse';

@Injectable()
export class KulonService {
  private readonly baseUrl = 'https://kulon2.undip.ac.id';
  /** One session seam: probe + sesskey + AJAX transport + stale classification. */
  private readonly upstream: KulonUpstreamSession;
  private readonly runtime: TelemetryRuntime;

  constructor(
    @Optional() cache?: DataCache,
    @Optional() siap?: SiapService,
    @Optional() upstream?: KulonUpstreamSession,
    @Optional() sessionStore?: SessionStore,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.cache = cache;
    this.siap = siap;
    this.runtime = runtime ?? createNoopTelemetryRuntime();
    this.upstream = upstream ?? new KulonUpstreamSession(sessionStore, cache, this.runtime);
    this.sessionStore = sessionStore;
  }

  private readonly cache?: DataCache;
  private readonly siap?: SiapService;
  private readonly sessionStore?: SessionStore;

  /**
   * Method-level single-flight, keyed per `sub`: N concurrent callers of the
   * same method+sub share ONE upstream run; the map entry is deleted on settle
   * (success OR error) so a later call starts fresh. No TTL here — TTL belongs
   * to DataCache.
   */
  private readonly courseFlight = createKeyedSingleFlight<KulonCourse[]>();
  private readonly assignmentsFlight =
    createKeyedSingleFlight<KulonAssignment[]>();
  private readonly allAssignmentsFlight =
    createKeyedSingleFlight<KulonAssignment[]>();

  /**
   * Cookie + sesskey pair every token-facing entry point starts from.
   * Generation-qualified via `getContextForSession`: a B-replacement between
   * JwtAuthGuard and this read is 401 SESSION_DEAD, never B's cookies.
   */
  private async requireKulonAjaxForSession(ref: SessionRef): Promise<{
    cookie: string;
    sesskey: string;
  }> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.upstream.getContextForSession(ref);
  }

  /**
   * CURRENT-session pair for background flows (poller) that own no JWT.
   * Never call from an authenticated controller/service path.
   */
  private async requireKulonAjaxForCurrent(sub: string): Promise<{
    cookie: string;
    sesskey: string;
  }> {
    return this.upstream.getContextForCurrent(sub);
  }

  /** Kept as the service's public parsing entry point (thin delegate). */
  parseSesskey(html: string): string {
    return parseSesskeyHtml(html);
  }

  /**
   * Single source of truth for Kulon session validity (delegates to the
   * upstream-session seam). A stale/expired session maps to `stale`.
   */
  async checkSessionValid(sessionCookie: string): Promise<KulonSessionCheck> {
    return this.upstream.checkSessionValid(sessionCookie);
  }

  /**
   * Derive the user's identity (NIM) from a valid Kulon session.
   * Primary: `core_webservice_get_site_info` (returns `username`). If that
   * service is disabled (it is on Kulon), fall back to scraping the NIM from
   * the `/user/profile.php` page title (format: "Full Name NIM: Public profile").
   * Returns null on any failure (stale session, services disabled, network).
   */
  async getSessionIdentity(sessionCookie: string): Promise<string | null> {
    if (!sessionCookie) return null;
    try {
      const page = await timedFetch(
        this.runtime,
        KULON_ROUTE_CONTEXTS.sessionIdentity,
        `${this.baseUrl}/my/`,
        { headers: { Cookie: sessionCookie }, redirect: 'follow' },
        async (res): Promise<UpstreamAttemptResult<{ sesskey: string }>> => {
          if (!res.ok) {
            return httpErrorResult(new StaleUpstreamError('Kulon', 'http-not-ok'), res.status);
          }
          if (isLoginRedirect(res.url)) {
            return staleResult(
              new StaleUpstreamError('Kulon', 'login-redirect'),
              'login-redirect',
              res.status,
            );
          }
          const html = await res.text();
          try {
            return {
              ok: true,
              value: { sesskey: this.parseSesskey(html) },
              outcome: 'ok',
              status: res.status,
            };
          } catch (error) {
            if (!/name="sesskey"/.test(html)) {
              return staleResult(
                new StaleUpstreamError('Kulon', 'login-redirect'),
                'login-redirect',
                res.status,
              );
            }
            throw error;
          }
        },
      );
      const username = await this.trySiteInfo(sessionCookie, page.sesskey);
      if (username) return username;
      return this.identityFromProfilePage(sessionCookie);
    } catch {
      return null;
    }
  }

  /** Try `core_webservice_get_site_info`; null when disabled/errored. */
  private async trySiteInfo(
    sessionCookie: string,
    sesskey: string,
  ): Promise<string | null> {
    try {
      const data = (await this.upstream.ajax(
        sessionCookie,
        sesskey,
        'core_webservice_get_site_info',
        {},
      )) as { username?: string } | null;
      return data?.username ?? null;
    } catch {
      return null;
    }
  }

  /** Scrape the NIM from the /user/profile.php page title. */
  private async identityFromProfilePage(
    sessionCookie: string,
  ): Promise<string | null> {
    try {
      return await timedFetch(
        this.runtime,
        KULON_ROUTE_CONTEXTS.profileIdentity,
        `${this.baseUrl}/user/profile.php`,
        { headers: { Cookie: sessionCookie }, redirect: 'follow' },
        async (res): Promise<UpstreamAttemptResult<string | null>> => {
          if (!res.ok) {
            return httpErrorResult(new StaleUpstreamError('Kulon', 'http-not-ok'), res.status);
          }
          if (isLoginRedirect(res.url)) {
            return staleResult(
              new StaleUpstreamError('Kulon', 'login-redirect'),
              'login-redirect',
              res.status,
            );
          }
          const page = await res.text();
          const title = page.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
          // The page title is "Full Name NIM: Public profile". Prefer the number
          // that directly precedes ": Public profile" — a phone/NIK-like number
          // elsewhere in the title (home address, NIP, etc.) can be 8-16 digits and
          // would otherwise be mistaken for the NIM (B13). Fall back to the first
          // 8-16 digit run only if the ": Public profile" anchor is absent.
          const anchored = title.match(/(\d{8,16})\s*:\s*Public profile/i);
          return {
            ok: true,
            value: anchored?.[1] ?? title.match(/\b\d{8,16}\b/)?.[0] ?? null,
            outcome: 'ok',
            status: res.status,
          };
        },
      );
    } catch {
      return null;
    }
  }

  async getCourses(ref: SessionRef): Promise<KulonCourse[]> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const scope: KulonScope = { kind: 'session', ref };
    return this.courseFlight.run(flightKeyForSession(ref, 'courses'), async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjaxForSession(ref);
      if (this.cache) {
        const { value } = await this.cache.getStale<KulonCourse[]>(
          kulonCacheKey(scope, 'courses'),
          () =>
            this.fetchCourses(sessionCookie, sesskey, scope, {
              withLecturers: true,
              withProgress: true,
              skipCacheRead: true,
            }, ref),
          swrWindow('KULON_COURSES'),
        );
        return value;
      }
      return this.fetchCourses(sessionCookie, sesskey, scope, {
        withLecturers: true,
        withProgress: true,
      }, ref);
    });
  }

  /** Course aggregation without session resolution (caller owns the session). */
  private async fetchCourses(
    sessionCookie: string,
    sesskey: string,
    scopeInput?: KulonScope | string,
    opts: {
      withLecturers?: boolean;
      withProgress?: boolean;
      skipCacheRead?: boolean;
    } = {},
    lecturerRef?: SessionRef,
  ): Promise<KulonCourse[]> {
    const scope = normalizeKulonScope(scopeInput);
    if (scope && this.cache && !opts.skipCacheRead) {
      const hit = await this.cache.get<KulonCourse[]>(kulonCacheKey(scope, 'courses'));
      if (hit) return hit;
    }
    // Moodle's own timeline classification is the source of truth for
    // "active now": a course present in the 'inprogress' bucket is the
    // current semester. Kulon course names/ID numbers carry no reliable
    // semester marker (verified live 2026-08-06), so name-parsing stays
    // display-only.
    const [visible, inprogress, hidden] = await Promise.all([
      this.fetchTimelineCourses(sessionCookie, sesskey, 'all'),
      this.fetchTimelineCourses(sessionCookie, sesskey, 'inprogress'),
      this.fetchTimelineCourses(sessionCookie, sesskey, 'hidden'),
    ]);
    const inprogressIds = new Set(inprogress.map((c) => c.id));
    // Merge visible + "removed from view" (hidden) courses, dedupe by id.
    // Visible entries take priority, so semester/fullname reflects the live course.
    const byId = new Map<number, Omit<KulonCourse, 'timelineStatus'>>();
    for (const c of [...hidden, ...visible]) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
    const merged: KulonCourse[] = Array.from(byId.values()).map((c) => ({
      ...c,
      timelineStatus: inprogressIds.has(c.id) ? 'inprogress' : 'past',
    }));
    // Batch-parallel course-progress scrape. Each course's /course/view.php feeds
    // parseSectionProgress. Failures per course are non-fatal (progress omitted).
    // Skipped when withProgress:false — the assignments aggregation output does
    // not carry progress, so per-course fetches would be pure wasted upstream work.
    let mergedWithProgress: KulonCourse[] = merged;
    if (opts.withProgress !== false) {
      const settled = await Promise.allSettled(
        merged.map(async (c) => ({
          id: c.id,
          progress: parseSectionProgress(
            (await this.fetchCourseContent(sessionCookie, sesskey, c.id, scope))
              .sections,
            undefined,
            { isPast: c.timelineStatus === 'past' },
          ),
        })),
      );
      const progressById = new Map<number, number>();
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value.progress != null) {
          progressById.set(r.value.id, r.value.progress);
        }
      }
      mergedWithProgress = merged.map((c) =>
        progressById.has(c.id) ? { ...c, progress: progressById.get(c.id) } : c,
      );
    }
    // Best-effort lecturer merge by MIK code (shortname). Missing SIAP cookie /
    // empty IRS -> lecturer simply omitted. Failures are non-fatal. Skipped on
    // internal calls (assignments aggregation) to keep poll cycles lean.
    let result: KulonCourse[] = mergedWithProgress;
    if (this.siap && opts.withLecturers !== false) {
      if (!lecturerRef || !isSessionRef(lecturerRef)) {
        throw new HttpException(
          { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      try {
        const byCode = new Map<string, string>();
        for (const l of await this.siap.getLecturers(lecturerRef)) {
          byCode.set(l.kode, l.dosen);
        }
        result = mergedWithProgress.map((c) =>
          byCode.has(c.shortname)
            ? { ...c, lecturer: byCode.get(c.shortname) }
            : c,
        );
      } catch {
        /* best-effort: omit lecturers on failure */
      }
    }
    // Payload persistence belongs exclusively to DataCache.getStale's refresh
    // owner. Internal progress-less calls still read, but never write.
    return result;
  }

  async fetchTimelineCourses(
    sessionCookie: string,
    sesskey: string,
    classification: string,
  ): Promise<Omit<KulonCourse, 'timelineStatus'>[]> {
    const data = (await this.upstream.ajax(
      sessionCookie,
      sesskey,
      'core_course_get_enrolled_courses_by_timeline_classification',
      {
        classification,
        limit: 0,
        offset: 0,
        sort: 'fullname',
      },
    )) as {
      courses?: Array<{
        id: number;
        fullname: string;
        shortname?: string;
        idnumber?: string;
      }>;
    };
    return (data?.courses ?? []).map((c) => ({
      id: c.id,
      // Some courses carry a "[SIAP] ..." prefix (SIAP integration) — keep only
      // the real course name. parseSemester still reads the UN-stripped fullname
      // because the semester marker sits inside the name, not in the prefix.
      fullname: c.fullname.replace(/^\[SIAP\]\s*/i, '').trim(),
      shortname: extractCourseCode(c.shortname ?? '', c.fullname ?? ''),
      idnumber: c.idnumber ?? '',
      semester: parseSemester(c.fullname ?? '', c.idnumber ?? ''),
    }));
  }

  async getAssignments(ref: SessionRef): Promise<KulonAssignment[]> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.assignmentsFlight.run(flightKeyForSession(ref, 'assignments'), async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjaxForSession(ref);
      const data = (await this.upstream.ajax(
        sessionCookie,
        sesskey,
        'core_calendar_get_action_events_by_timesort',
        {
          timesortfrom: 0,
          timesortto: 0,
          limitnum: 50,
        },
      )) as {
        events?: Array<{
          id: number;
          eventtype: string;
          instance?: number;
          activityname?: string;
          name?: string;
          modulename: string;
          timestart: number;
          overdue?: boolean;
          url?: string;
          course?: { id?: number; fullname?: string };
        }>;
      };
      return (data?.events ?? [])
        .filter((e) => e.eventtype === 'due')
        .map((e): KulonAssignment => {
          const assignmentId = e.instance ?? 0;
          return {
            id: e.id,
            name: e.activityname ?? e.name ?? '',
            module: e.modulename,
            eventType: e.eventtype,
            duedate: e.timestart,
            overdue: !!e.overdue,
            course: e.course?.fullname ?? '',
            courseId: e.course?.id ?? 0,
            assignmentId,
            // Moodle does NOT expose cmid on calendar events, and the
            // core_course_get_course_module_by_instance web service is disabled
            // on Kulon. The event's `url` (built by Moodle itself) carries the
            // page id used by /mod/assign/view.php?id=<n> — verified against
            // real Kulon data. Use that as the courseModuleId.
            courseModuleId: extractCourseModuleId(e.url),
          };
        });
    });
  }

  /**
   * Full assignment list across all enrolled courses, including COMPLETED
   * ones. The calendar action-events feed (`getAssignments`) only surfaces
   * outstanding items, so we aggregate each course's
   * `/mod/assign/index.php` page — one fetch per course — which lists all
   * assignments with a student "Submission" column. Bounded concurrency keeps
   * the first load reasonable.
   */
  async getAllAssignments(ref: SessionRef): Promise<KulonAssignment[]> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const scope: KulonScope = { kind: 'session', ref };
    return this.allAssignmentsFlight.run(flightKeyForSession(ref, 'assignments-all'), async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjaxForSession(ref);
      if (this.cache) {
        const { value } = await this.cache.getStale<KulonAssignment[]>(
          kulonCacheKey(scope, 'assignments', 'all'),
          () => this.fetchAllAssignments(sessionCookie, sesskey, scope),
          swrWindow('KULON_ASSIGNMENTS_ALL'),
        );
        return value;
      }
      return this.fetchAllAssignments(sessionCookie, sesskey, scope);
    });
  }

  /**
   * CURRENT-session variant for background flows (NotificationsPoller) that
   * own no JWT: the current live record, whatever its generation. Never call
   * from an authenticated controller/service path.
   */
  async getAllAssignmentsForCurrentSession(sub: string): Promise<KulonAssignment[]> {
    const scope: KulonScope = { kind: 'current', sub };
    return this.allAssignmentsFlight.run(flightKeyForCurrent(sub, 'assignments-all'), async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjaxForCurrent(sub);
      if (this.cache) {
        const { value } = await this.cache.getStale<KulonAssignment[]>(
          kulonCacheKey(scope, 'assignments', 'all'),
          () => this.fetchAllAssignments(sessionCookie, sesskey, scope),
          swrWindow('KULON_ASSIGNMENTS_ALL'),
        );
        return value;
      }
      return this.fetchAllAssignments(sessionCookie, sesskey, scope);
    });
  }

  /**
   * Aggregate every course's assignment + quiz index pages into one flat list
   * (incl. completed items). Caller owns the session. Payload persistence belongs
   * to DataCache.getStale's refresh owner.
   */
  private async fetchAllAssignments(
    sessionCookie: string,
    sesskey: string,
    scopeInput?: KulonScope | string,
  ): Promise<KulonAssignment[]> {
    const scope = normalizeKulonScope(scopeInput);
    // Lecturer merge AND per-course progress scrape skipped on internal calls
    // to keep poll cycles lean — the assignments output carries neither.
    const courses = await this.fetchCourses(sessionCookie, sesskey, scope, {
      withLecturers: false,
      withProgress: false,
    });
    const results: KulonAssignment[][] = [];
    const CONCURRENCY = 4;
    const queue = [...courses];
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i += 1) {
      workers.push(
        (async () => {
          while (queue.length) {
            const c = queue.shift()!;
            const [assignRows, quizRows] = await Promise.all([
              this.fetchAssignmentIndex(sessionCookie, c.id, c.fullname),
              this.fetchQuizIndex(sessionCookie, c.id, c.fullname),
            ]);
            results.push(assignRows, quizRows);
          }
        })(),
      );
    }
    await Promise.all(workers);
    const flat = results.flat();
    return flat;
  }

  /** Fetch an authenticated Kulon HTML page with typed session classification. */
  private async fetchKulonPage(
    url: string,
    cookie: string,
    notFoundCode?: string,
    context?: UpstreamRouteContext,
  ): Promise<string> {
    if (!context) throw new TypeError('Kulon page route context is required');
    try {
      return await timedFetch(
        this.runtime,
        context,
        url,
        { headers: { Cookie: cookie }, redirect: 'follow' },
        async (res): Promise<UpstreamAttemptResult<string>> => {
          if (!res.ok) {
            if (res.status === 404) {
              const error = new Error(notFoundCode ?? 'Kulon page not found');
              markKulonPageCompatibilityError(error);
              return httpErrorResult(error, res.status);
            }
            if (!Number.isFinite(res.status) || res.status < 400) {
              const error = new Error(
                `Kulon page failed: ${Number.isFinite(res.status) ? res.status : 'unknown'}`,
              );
              markKulonPageCompatibilityError(error);
              return httpErrorResult(error, res.status);
            }
            return httpErrorResult(
              new StaleUpstreamError('Kulon', 'http-not-ok', undefined, res),
              res.status,
            );
          }
          if (isLoginRedirect(res.url)) {
            return staleResult(
              new StaleUpstreamError('Kulon', 'login-redirect', undefined, res),
              'login-redirect',
              res.status,
            );
          }
          const html = await res.text();
          if (isKulonLoginPage(html)) {
            return staleResult(
              new StaleUpstreamError('Kulon', 'login-redirect', undefined, res),
              'login-redirect',
              res.status,
            );
          }
          return { ok: true, value: html, outcome: 'ok', status: res.status };
        },
      );
    } catch (error) {
      const transportReason = getTimedFetchTransportReason(error);
      if (transportReason) {
        throw new StaleUpstreamError('Kulon', transportReason);
      }
      throw error;
    }
  }

  /** Fetch and parse one course's assignment index page; [] on transient failure. */
  private async fetchAssignmentIndex(
    sessionCookie: string,
    courseId: number,
    courseName: string,
  ): Promise<KulonAssignment[]> {
    try {
      const html = await this.fetchKulonPage(
        `${this.baseUrl}/mod/assign/index.php?id=${courseId}`,
        sessionCookie,
        undefined,
        KULON_ROUTE_CONTEXTS.assignmentsIndex,
      );
      return parseAssignmentIndex(html, courseId, courseName);
    } catch (error) {
      // Typed upstream failures must reject aggregation so SWR preserves the
      // previous complete list instead of replacing it with a partial one.
      if (error instanceof StaleUpstreamError) throw error;
      return [];
    }
  }

  /** Fetch and parse one course's quiz index page; [] on non-upstream failure. */
  private async fetchQuizIndex(
    sessionCookie: string,
    courseId: number,
    courseName: string,
  ): Promise<KulonAssignment[]> {
    try {
      const html = await this.fetchKulonPage(
        `${this.baseUrl}/mod/quiz/index.php?id=${courseId}`,
        sessionCookie,
        undefined,
        KULON_ROUTE_CONTEXTS.quizIndex,
      );
      return parseQuizIndex(html, courseId, courseName);
    } catch (error) {
      // See fetchAssignmentIndex: do not swallow typed session or gateway
      // failures during the aggregate refresh.
      if (error instanceof StaleUpstreamError) throw error;
      return [];
    }
  }

  async getAssignmentDetail(
    ref: SessionRef,
    assignmentId: number,
    cmid: number,
  ): Promise<KulonAssignmentDetail> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Probe first: it is the stale-session gate for the raw page fetch below.
    const { cookie: sessionCookie } = await this.requireKulonAjaxForSession(ref);
    if (this.cache) {
      const { value } = await this.cache.getStale<KulonAssignmentDetail>(
        cacheKeyForSession(ref, 'kulon', 'assignment-detail', String(cmid)),
        () =>
          this.fetchAssignmentDetail(sessionCookie, cmid, assignmentId, ref.sub),
        swrWindow('KULON_ASSIGNMENT_DETAIL'),
      );
      return value;
    }
    return this.fetchAssignmentDetail(sessionCookie, cmid, assignmentId, ref.sub);
  }

  /**
   * Fetch + parse one assignment's `/mod/assign/view.php` page. Caller owns the
   * session. Payload persistence belongs to DataCache.getStale's refresh owner.
   */
  private async fetchAssignmentDetail(
    sessionCookie: string,
    cmid: number,
    assignmentId: number,
    sub?: string,
  ): Promise<KulonAssignmentDetail> {
    const pageUrl = `${this.baseUrl}/mod/assign/view.php?id=${cmid}`;
    const html = await this.fetchKulonPage(
      pageUrl,
      sessionCookie,
      'ASSIGNMENT_NOT_FOUND',
      KULON_ROUTE_CONTEXTS.assignmentDetail,
    );
    const descriptionHtml = extractDescription(html);
    const detail = {
      assignmentId,
      name: extractName(html),
      descriptionHtml,
      descriptionMarkdown: htmlToMarkdown(descriptionHtml),
      files: extractFiles(html),
      submission: parseSubmissionFromHtml(html),
      kulonUrl: pageUrl,
    };
    return detail;
  }

  /**
   * Fetch the HTML of a course page and parse it into sections/items.
   * Transport only — the two-pass parsing lives in parseContentHtml.
   */
  private async contentFromHTML(
    cookie: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    const html = await this.fetchKulonPage(
      `${this.baseUrl}/course/view.php?id=${courseId}`,
      cookie,
      'COURSE_NOT_FOUND',
      KULON_ROUTE_CONTEXTS.courseContent,
    );
    return parseContentHtml(html, courseId);
  }

  /**
   * Fetch the Moodle course-format state as JSON (core_courseformat_get_state) and
   * map it into KulonCourseContent. This is the JSON alternative to the more fragile
   * HTML scrape contentFromHTML. A cm inclusion rule lives in the parser.
   */
  private async getCourseState(
    cookie: string,
    sesskey: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    const raw = (await this.upstream.ajax(
      cookie,
      sesskey,
      'core_courseformat_get_state',
      { courseid: courseId },
    )) as { course?: any; section?: any[]; cm?: any[] };
    // A 200 that doesn't shape as course-format state (e.g. an HTML error page, a
    // malformed body, or a method that returns an empty object) must NOT be treated
    // as a valid empty course — throw so getCourseContent falls back to the HTML
    // scrape instead of silently returning no content.
    if (!Array.isArray(raw?.section)) {
      throw new Error('core_courseformat_get_state returned no section array');
    }
    return mapCourseStateJson(raw, courseId);
  }

  async getCourseContent(
    ref: SessionRef,
    courseId: number,
  ): Promise<KulonCourseContent> {
    if (!isSessionRef(ref)) {
      throw new HttpException(
        { message: 'Sesi berakhir. Silakan login ulang', code: 'SESSION_DEAD' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const { cookie, sesskey } = await this.requireKulonAjaxForSession(ref);
    return this.fetchCourseContent(cookie, sesskey, courseId, { kind: 'session', ref });
  }

  /** Content fetch without session resolution (caller owns the session). */
  private async fetchCourseContent(
    cookie: string,
    sesskey: string,
    courseId: number,
    scopeInput?: KulonScope | string,
  ): Promise<KulonCourseContent> {
    const scope = normalizeKulonScope(scopeInput);
    if (scope && this.cache) {
      const { value } = await this.cache.getStale<KulonCourseContent>(
        kulonCacheKey(scope, 'course-content', String(courseId)),
        () => this.fetchCourseContentFresh(cookie, sesskey, courseId),
        swrWindow('KULON_COURSE_CONTENT'),
      );
      return value;
    }
    return this.fetchCourseContentFresh(cookie, sesskey, courseId);
  }

  /**
   * Fresh course-content fetch + parse (JSON-first, HTML fallback). Caller owns
   * the session. Payload persistence belongs to DataCache.getStale's refresh owner.
   */
  private async fetchCourseContentFresh(
    cookie: string,
    sesskey: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    // JSON-first via core_courseformat_get_state; fall back to the HTML scrape on
    // ANY error (method disabled, session quirks, even a missing res.json() on a
    // stubbed response) so a JSON regression never breaks course content.
    let content: KulonCourseContent;
    try {
      content = await this.getCourseState(cookie, sesskey, courseId);
    } catch {
      content = await this.contentFromHTML(cookie, courseId);
    }
    return content;
  }
}
