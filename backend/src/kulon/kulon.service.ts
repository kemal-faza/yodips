import { Injectable, Optional } from '@nestjs/common';
import { createKeyedSingleFlight } from '../common/single-flight';
import { DataCache } from '../cache/data-cache';
import { CachePolicy } from '../cache/cache-policy';
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
  private readonly assignmentsFlight = createKeyedSingleFlight<KulonAssignment[]>();
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

  async getCourses(
    sub?: string,
    opts: { withLecturers?: boolean; withProgress?: boolean } = {},
  ): Promise<KulonCourse[]> {
    const key = sub ?? '__anon__';
    return this.courseFlight.run(key, async () => {
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjax(sub);
      return this.fetchCourses(sessionCookie, sesskey, sub, opts);
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
      const hit = await this.cache.get<KulonCourse[]>(
        `${sub}:kulon:courses`,
      );
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
            (await this.fetchCourseContent(sessionCookie, sesskey, c.id)).sections,
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
      await this.cache.set(`${sub}:kulon:courses`, result, CachePolicy.KULON_COURSES);
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
    )) as { courses: any[] };
    return (data?.courses ?? []).map((c: any) => ({
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
      )) as { events: any[] };
      return (data?.events ?? [])
        .filter((e: any) => e.eventtype === 'due')
        .map((e: any): KulonAssignment => {
          const assignmentId = e.instance ?? 0;
          return {
            id: e.id,
            name: e.activityname ?? e.name,
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
      if (sub && this.cache) {
        const hit = await this.cache.get<KulonAssignment[]>(
          `${sub}:kulon:assignments:all`,
        );
        if (hit) return hit;
      }
      const { cookie: sessionCookie, sesskey } =
        await this.requireKulonAjax(sub);
      // Lecturer merge AND per-course progress scrape skipped on internal calls
      // to keep poll cycles lean — the assignments output carries neither.
      const courses = await this.fetchCourses(
        sessionCookie,
        sesskey,
        sub,
        { withLecturers: false, withProgress: false },
      );
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
        await this.cache.set(`${sub}:kulon:assignments:all`, flat, CachePolicy.KULON_ASSIGNMENTS_ALL);
      }
      return flat;
    });
  }

  /** Fetch and parse one course's assignment index page; [] on any failure. */
  private async fetchAssignmentIndex(
    sessionCookie: string,
    courseId: number,
    courseName: string,
  ): Promise<KulonAssignment[]> {
    try {
      const res = await fetch(
        `${this.baseUrl}/mod/assign/index.php?id=${courseId}`,
        { headers: { Cookie: sessionCookie }, redirect: 'follow' },
      );
      if (!res.ok) return [];
      return parseAssignmentIndex(await res.text(), courseId, courseName);
    } catch {
      return [];
    }
  }

  /** Fetch and parse one course's quiz index page; [] on any failure. */
  private async fetchQuizIndex(
    sessionCookie: string,
    courseId: number,
    courseName: string,
  ): Promise<KulonAssignment[]> {
    try {
      const res = await fetch(
        `${this.baseUrl}/mod/quiz/index.php?id=${courseId}`,
        { headers: { Cookie: sessionCookie }, redirect: 'follow' },
      );
      if (!res.ok) return [];
      return parseQuizIndex(await res.text(), courseId, courseName);
    } catch {
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
      const hit = await this.cache.get<KulonAssignmentDetail>(
        `${sub}:kulon:assignment-detail:${cmid}`,
      );
      if (hit) return hit;
    }
    const pageUrl = `${this.baseUrl}/mod/assign/view.php?id=${cmid}`;
    const res = await fetch(pageUrl, {
      headers: { Cookie: sessionCookie },
      redirect: 'follow',
    });
    if (res.status === 404) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (!res.ok) throw new Error(`Kulon assignment page failed: ${res.status}`);
    const html = await res.text();
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
    const res = await fetch(`${this.baseUrl}/course/view.php?id=${courseId}`, {
      headers: { Cookie: cookie },
      redirect: 'follow',
    });
    if (res.status === 404) throw new Error('COURSE_NOT_FOUND');
    if (!res.ok) throw new Error(`Kulon course page failed: ${res.status}`);
    return parseContentHtml(await res.text(), courseId);
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
      const hit = await this.cache.get<KulonCourseContent>(
        `${sub}:kulon:course-content:${courseId}`,
      );
      if (hit) return hit;
    }
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
