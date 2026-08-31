import { Injectable, Optional } from '@nestjs/common';
import { createKeyedSingleFlight } from '../common/single-flight';
import { DataCache } from '../cache/data-cache';
import { CachePolicy, swrWindow } from '../cache/cache-policy';
import { SiapService } from '../siap/siap.service';
import { SessionStore } from '../session/session-store';
import {
  KulonUpstreamSession,
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
  classifyUpstreamFetch,
  StaleUpstreamError,
} from '../upstream/upstream-fetch';

/** Detect Moodle's login document when a proxy returns it as a successful page. */
function isKulonLoginPage(html: string): boolean {
  return (
    /<body\b[^>]*\bid=["']page-login-index["']/i.test(html) ||
    /<form\b[^>]*\bid=["']login["']/i.test(html) ||
    /<form\b[^>]*\baction=["'][^"']*\/login\/index\.php(?:["'?])/i.test(html) ||
    /<title>\s*(?:log\s+in|login)\b[^<]*<\/title>/i.test(html)
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

  constructor(
    @Optional() cache?: DataCache,
    @Optional() siap?: SiapService,
    @Optional() upstream?: KulonUpstreamSession,
    @Optional() sessionStore?: SessionStore,
  ) {
    this.cache = cache;
    this.siap = siap;
    this.upstream = upstream ?? new KulonUpstreamSession();
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
   * Cookie + sesskey pair every AJAX-backed entry point starts from.
   * Delegates to the upstream-session seam: the seam resolves the stored
   * session cookie (and a cached single-flight sesskey) for `sub`, and throws
   * the same typed no-cookie stale 401 the old requireKulonCookie threw.
   */
  private async requireKulonAjax(sub?: string): Promise<{
    cookie: string;
    sesskey: string;
  }> {
    return this.upstream.getContext(sub);
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
      const res = await fetch(`${this.baseUrl}/my/`, {
        headers: { Cookie: sessionCookie },
        redirect: 'follow',
      });
      if (!res.ok) return null;
      const html = await res.text();
      const sesskey = this.parseSesskey(html);
      const username = await this.trySiteInfo(sessionCookie, sesskey);
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
      const res = await fetch(`${this.baseUrl}/user/profile.php`, {
        headers: { Cookie: sessionCookie },
        redirect: 'follow',
      });
      if (!res.ok) return null;
      const page = await res.text();
      const title = page.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
      // The page title is "Full Name NIM: Public profile". Prefer the number
      // that directly precedes ": Public profile" — a phone/NIK-like number
      // elsewhere in the title (home address, NIP, etc.) can be 8-16 digits and
      // would otherwise be mistaken for the NIM (B13). Fall back to the first
      // 8-16 digit run only if the ": Public profile" anchor is absent.
      const anchored = title.match(/(\d{8,16})\s*:\s*Public profile/i);
      if (anchored) return anchored[1];
      return title.match(/\b\d{8,16}\b/)?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async getCourses(sub?: string): Promise<KulonCourse[]> {
    return this.courseFlight.run(sub ?? '__anon__', async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjax(sub);
      if (sub && this.cache) {
        const { value } = await this.cache.getStale<KulonCourse[]>(
          `${sub}:kulon:courses`,
          () =>
            this.fetchCourses(sessionCookie, sesskey, sub, {
              withLecturers: true,
              withProgress: true,
            }),
          swrWindow('KULON_COURSES'),
        );
        return value;
      }
      return this.fetchCourses(sessionCookie, sesskey, sub, {
        withLecturers: true,
        withProgress: true,
      });
    });
  }

  /** Course aggregation without session resolution (caller owns the session). */
  private async fetchCourses(
    sessionCookie: string,
    sesskey: string,
    sub?: string,
    opts: { withLecturers?: boolean; withProgress?: boolean } = {},
  ): Promise<KulonCourse[]> {
    if (sub && this.cache) {
      const hit = await this.cache.get<KulonCourse[]>(`${sub}:kulon:courses`);
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
            (await this.fetchCourseContent(sessionCookie, sesskey, c.id))
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
      try {
        const byCode = new Map<string, string>();
        for (const l of await this.siap.getLecturers(sub)) {
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
    // Cache write skipped on withProgress:false runs — they read but never
    // write, so a progress-less run can never poison the public progress-ful
    // cache (the shared `:kulon:courses` key stays progress-complete).
    if (sub && this.cache && opts.withProgress !== false) {
      await this.cache.set(
        `${sub}:kulon:courses`,
        result,
        CachePolicy.KULON_COURSES,
      );
    }
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

  async getAssignments(sub?: string): Promise<KulonAssignment[]> {
    const key = sub ?? '__anon__';
    return this.assignmentsFlight.run(key, async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjax(sub);
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
  async getAllAssignments(sub?: string): Promise<KulonAssignment[]> {
    const key = sub ?? '__anon__';
    return this.allAssignmentsFlight.run(key, async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjax(sub);
      if (sub && this.cache) {
        const { value } = await this.cache.getStale<KulonAssignment[]>(
          `${sub}:kulon:assignments:all`,
          () => this.fetchAllAssignments(sessionCookie, sesskey, sub),
          swrWindow('KULON_ASSIGNMENTS_ALL'),
        );
        return value;
      }
      return this.fetchAllAssignments(sessionCookie, sesskey, sub);
    });
  }

  /**
   * Aggregate every course's assignment + quiz index pages into one flat list
   * (incl. completed items). Caller owns the session. Keeps its own cache set
   * so background refresh writes via it (getStale's post-fetch set is a benign
   * duplicate — same key, same TTL).
   */
  private async fetchAllAssignments(
    sessionCookie: string,
    sesskey: string,
    sub?: string,
  ): Promise<KulonAssignment[]> {
    // Lecturer merge AND per-course progress scrape skipped on internal calls
    // to keep poll cycles lean — the assignments output carries neither.
    const courses = await this.fetchCourses(sessionCookie, sesskey, sub, {
      withLecturers: false,
      withProgress: false,
    });
    const results: KulonAssignment[][] = [];
    const CONCURRENCY = 4;
    const queue = [...courses];
    const workers = Array(Math.min(CONCURRENCY, queue.length))
      .fill(0)
      .map(async () => {
        while (queue.length) {
          const c = queue.shift()!;
          const [assignRows, quizRows] = await Promise.all([
            this.fetchAssignmentIndex(sessionCookie, c.id, c.fullname),
            this.fetchQuizIndex(sessionCookie, c.id, c.fullname),
          ]);
          results.push(assignRows, quizRows);
        }
      });
    await Promise.all(workers);
    const flat = results.flat();
    if (sub && this.cache) {
      await this.cache.set(
        `${sub}:kulon:assignments:all`,
        flat,
        CachePolicy.KULON_ASSIGNMENTS_ALL,
      );
    }
    return flat;
  }

  /** Fetch an authenticated Kulon HTML page with typed session classification. */
  private async fetchKulonPage(
    url: string,
    cookie: string,
    notFoundCode?: string,
  ): Promise<string> {
    const outcome = await classifyUpstreamFetch(url, {
      headers: { Cookie: cookie },
      redirect: 'follow',
    });
    if (outcome.kind === 'gateway') {
      throw new StaleUpstreamError('Kulon', outcome.reason);
    }
    if (outcome.kind === 'stale') {
      if (outcome.reason === 'http-not-ok' && outcome.res?.status === 404) {
        if (notFoundCode) throw new Error(notFoundCode);
        throw new Error('Kulon page not found');
      }
      if (
        outcome.reason === 'http-not-ok' &&
        (!outcome.res?.status || outcome.res.status < 400)
      ) {
        throw new Error(
          `Kulon page failed: ${outcome.res?.status ?? 'unknown'}`,
        );
      }
      throw new StaleUpstreamError(
        'Kulon',
        outcome.reason,
        undefined,
        outcome.res,
      );
    }
    const html = await outcome.res.text();
    if (isKulonLoginPage(html)) {
      throw new StaleUpstreamError('Kulon', 'login-redirect');
    }
    return html;
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
      );
      return parseAssignmentIndex(html, courseId, courseName);
    } catch (error) {
      if (this.isDeadKulonPageError(error)) {
        throw error;
      }
      return [];
    }
  }

  /** Classify page failures while preserving dead-session evidence for SWR. */
  private isDeadKulonPageError(error: unknown): error is StaleUpstreamError {
    if (!(error instanceof StaleUpstreamError)) return false;
    if (error.reason === 'http-not-ok') return error.getStatus() === 401;
    return (
      error.reason === 'login-redirect' ||
      error.reason === 'redirect-loop' ||
      error.reason === 'html-content-type' ||
      error.reason === 'malformed-json'
    );
  }

  /** Fetch and parse one course's quiz index page; [] on transient failure. */
  private async fetchQuizIndex(
    sessionCookie: string,
    courseId: number,
    courseName: string,
  ): Promise<KulonAssignment[]> {
    try {
      const html = await this.fetchKulonPage(
        `${this.baseUrl}/mod/quiz/index.php?id=${courseId}`,
        sessionCookie,
      );
      return parseQuizIndex(html, courseId, courseName);
    } catch (error) {
      if (this.isDeadKulonPageError(error)) {
        throw error;
      }
      return [];
    }
  }

  async getAssignmentDetail(
    sub: string | undefined,
    assignmentId: number,
    cmid: number,
  ): Promise<KulonAssignmentDetail> {
    // Probe first: it is the stale-session gate for the raw page fetch below.
    const { cookie: sessionCookie } = await this.requireKulonAjax(sub);
    if (sub && this.cache) {
      const { value } = await this.cache.getStale<KulonAssignmentDetail>(
        `${sub}:kulon:assignment-detail:${cmid}`,
        () =>
          this.fetchAssignmentDetail(sessionCookie, cmid, assignmentId, sub),
        swrWindow('KULON_ASSIGNMENT_DETAIL'),
      );
      return value;
    }
    return this.fetchAssignmentDetail(sessionCookie, cmid, assignmentId, sub);
  }

  /**
   * Fetch + parse one assignment's `/mod/assign/view.php` page. Caller owns the
   * session. Keeps its own cache set so background refresh writes via it
   * (getStale's post-fetch set is a benign duplicate — same key, same TTL).
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
    if (sub && this.cache) {
      await this.cache.set(
        `${sub}:kulon:assignment-detail:${cmid}`,
        detail,
        CachePolicy.KULON_ASSIGNMENT_DETAIL,
      );
    }
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
    sub: string | undefined,
    courseId: number,
  ): Promise<KulonCourseContent> {
    const { cookie, sesskey } = await this.requireKulonAjax(sub);
    return this.fetchCourseContent(cookie, sesskey, courseId, sub);
  }

  /** Content fetch without session resolution (caller owns the session). */
  private async fetchCourseContent(
    cookie: string,
    sesskey: string,
    courseId: number,
    sub?: string,
  ): Promise<KulonCourseContent> {
    if (sub && this.cache) {
      const { value } = await this.cache.getStale<KulonCourseContent>(
        `${sub}:kulon:course-content:${courseId}`,
        () => this.fetchCourseContentFresh(cookie, sesskey, courseId, sub),
        swrWindow('KULON_COURSE_CONTENT'),
      );
      return value;
    }
    return this.fetchCourseContentFresh(cookie, sesskey, courseId, sub);
  }

  /**
   * Fresh course-content fetch + parse (JSON-first, HTML fallback). Caller owns
   * the session. Keeps its own cache set so background refresh writes via it
   * (getStale's post-fetch set is a benign duplicate — same key, same TTL).
   */
  private async fetchCourseContentFresh(
    cookie: string,
    sesskey: string,
    courseId: number,
    sub?: string,
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
    if (sub && this.cache) {
      await this.cache.set(
        `${sub}:kulon:course-content:${courseId}`,
        content,
        CachePolicy.KULON_COURSE_CONTENT,
      );
    }
    return content;
  }
}
