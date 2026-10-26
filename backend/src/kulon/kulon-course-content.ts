import { mapWithConcurrency } from '../common/map-with-concurrency';
import { swrWindow } from '../cache/cache-policy';
import { DataCache } from '../cache/data-cache';
import type { UpstreamRouteContext } from '../upstream/upstream-fetch';
import {
  decodeCourseState,
  mapCourseStateJson,
  parseContentHtml,
  parseSectionProgress,
  type KulonCourse,
  type KulonCourseContent,
} from './kulon-parse';
import {
  KULON_BASE_URL,
  KULON_ROUTE_CONTEXTS,
  type KulonAjaxBatchEntry,
  type KulonUpstreamSession,
} from './kulon-upstream.session';
import {
  COURSE_PROGRESS_CONCURRENCY,
  kulonCacheKey,
  normalizeKulonScope,
  type KulonScope,
} from './kulon-scope';

/**
 * Page transport owned by the service (telemetry route + not-found code
 * classification). Injected so this module never re-implements it.
 */
export type KulonPageFetcher = (
  url: string,
  cookie: string,
  notFoundCode: string,
  route: UpstreamRouteContext,
) => Promise<string>;

const COURSE_STATE_METHOD = 'core_courseformat_get_state';

/**
 * Owner of Kulon's course-content + course-progress policy.
 *
 * Both paths share `decodeCourseState`, which is the contract that used to be
 * re-derived per caller: Kulon answers `core_courseformat_get_state.data` as a
 * JSON STRING, so anything that skips the decoder throws on a valid response and
 * pays for an extra HTML request.
 *
 * Cache and fallback policy live here, not in the service: `getContent` owns the
 * SWR key, `contentFresh` owns JSON-first/HTML-fallback, and `mergeProgress` owns
 * the one-batch-then-per-course-fallback rule.
 */
export class KulonCourseContentProvider {
  constructor(
    private readonly upstream: KulonUpstreamSession,
    private readonly fetchPage: KulonPageFetcher,
    private readonly cache?: DataCache,
  ) {}

  /** Course content for one course, served from SWR when a scope is available. */
  async getContent(
    cookie: string,
    sesskey: string,
    courseId: number,
    scopeInput?: KulonScope | string,
  ): Promise<KulonCourseContent> {
    const scope = normalizeKulonScope(scopeInput);
    if (scope && this.cache) {
      const { value } = await this.cache.getStale<KulonCourseContent>(
        kulonCacheKey(scope, 'course-content', String(courseId)),
        () => this.contentFresh(cookie, sesskey, courseId),
        swrWindow('KULON_COURSE_CONTENT'),
      );
      return value;
    }
    return this.contentFresh(cookie, sesskey, courseId);
  }

  /**
   * Courses-screen progress from ONE batched `core_courseformat_get_state` POST.
   *
   * A course whose entry is missing (Moodle truncates the response at the first
   * failing entry), errored, or unparseable stays on the per-course path; a batch
   * transport failure puts EVERY course back there.
   */
  async mergeProgress(
    sessionCookie: string,
    sesskey: string,
    scope: KulonScope | undefined,
    courses: KulonCourse[],
  ): Promise<KulonCourse[]> {
    if (courses.length === 0) return courses;
    const progressById = new Map<number, number>();
    let scraped: KulonCourse[] = [];
    try {
      const { results } = await this.upstream.ajaxMany(
        sessionCookie,
        sesskey,
        courses.map((c) => ({
          methodname: COURSE_STATE_METHOD,
          args: { courseid: c.id },
        })),
      );
      courses.forEach((course, index) => {
        const progress = this.progressFromStateEntry(results[index], course);
        if (progress === undefined) scraped.push(course);
        else if (progress !== null) progressById.set(course.id, progress);
      });
    } catch {
      scraped = courses;
    }
    if (scraped.length > 0) {
      const fallback = await this.scrapeCourseProgress(sessionCookie, sesskey, scope, scraped);
      for (const [id, progress] of fallback) progressById.set(id, progress);
    }
    return courses.map((course) =>
      progressById.has(course.id) ? { ...course, progress: progressById.get(course.id) } : course,
    );
  }

  /**
   * Progress from ONE batch entry: a number is a measured value, `null` means the
   * course resolved but has no dated section to measure, and `undefined` means
   * unresolved (absent/errored/malformed) so the caller must fall back.
   */
  private progressFromStateEntry(
    entry: KulonAjaxBatchEntry | undefined,
    course: KulonCourse,
  ): number | null | undefined {
    if (!entry || entry.error) return undefined;
    try {
      const raw = decodeCourseState(entry.data);
      return (
        parseSectionProgress(mapCourseStateJson(raw, course.id).sections, new Date(), {
          isPast: course.timelineStatus === 'past',
        }) ?? null
      );
    } catch {
      // Malformed payload: fall back to the per-course path instead of failing
      // the whole Courses fetch.
      return undefined;
    }
  }

  /**
   * Per-course progress path: one content fetch (JSON-first, HTML fallback) per
   * course, bounded by COURSE_PROGRESS_CONCURRENCY. A failing course simply gets
   * no progress.
   */
  private async scrapeCourseProgress(
    sessionCookie: string,
    sesskey: string,
    scope: KulonScope | undefined,
    courses: KulonCourse[],
  ): Promise<Map<number, number>> {
    const settled = await mapWithConcurrency(
      courses,
      COURSE_PROGRESS_CONCURRENCY,
      async (c) => {
        try {
          return {
            status: 'fulfilled' as const,
            value: {
              id: c.id,
              progress: parseSectionProgress(
                (await this.getContent(sessionCookie, sesskey, c.id, scope)).sections,
                undefined,
                { isPast: c.timelineStatus === 'past' },
              ),
            },
          };
        } catch (reason) {
          return { status: 'rejected' as const, reason };
        }
      },
    );
    const progressById = new Map<number, number>();
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.progress != null) {
        progressById.set(r.value.id, r.value.progress);
      }
    }
    return progressById;
  }

  /**
   * Fresh content fetch + parse (JSON-first, HTML fallback). Caller owns the
   * session. Payload persistence belongs to DataCache.getStale's refresh owner.
   */
  private async contentFresh(
    cookie: string,
    sesskey: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    // JSON-first via core_courseformat_get_state; fall back to the HTML scrape on
    // ANY error (method disabled, session quirks, even a missing res.json() on a
    // stubbed response) so a JSON regression never breaks course content.
    try {
      const data = await this.upstream.ajax(cookie, sesskey, COURSE_STATE_METHOD, {
        courseid: courseId,
      });
      return mapCourseStateJson(decodeCourseState(data), courseId);
    } catch {
      return this.contentFromHTML(cookie, courseId);
    }
  }

  /**
   * Fetch the HTML of a course page and parse it into sections/items.
   * Transport only — the two-pass parsing lives in parseContentHtml.
   */
  private async contentFromHTML(
    cookie: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    const html = await this.fetchPage(
      `${KULON_BASE_URL}/course/view.php?id=${courseId}`,
      cookie,
      'COURSE_NOT_FOUND',
      KULON_ROUTE_CONTEXTS.courseContent,
    );
    return parseContentHtml(html, courseId);
  }
}
