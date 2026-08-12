import { Injectable, Logger } from '@nestjs/common';

const SEMESTER_RE = /(20\d{2}\/\d{4})\s+(Ganjil|Genap|Pendek)/i;

export function parseSemester(fullname: string, idnumber = ''): string | null {
  const m = fullname.match(SEMESTER_RE) ?? idnumber.match(SEMESTER_RE);
  if (!m) return null;
  const term = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  return `${m[1]} ${term}`;
}

const COURSE_CODE_RE = /\[([A-Z]{2,3}\d{5,})\]/;

/**
 * Extract the clean course code (e.g. MIK1624105) from Kulon's verbose
 * bracketed shortname, e.g. `[SIAP] [55201] [K2024] [Reguler] [MIK1624105] S1 ...`.
 * Prefers the raw shortname; falls back to the raw fullname; if neither holds a
 * bracketed code token, returns the original shortname untouched (backward
 * compatible with plain shortnames like `CA`).
 */
export function extractCourseCode(shortname: string, fullname: string): string {
  const fromShort = shortname.match(COURSE_CODE_RE)?.[1];
  if (fromShort) return fromShort;
  const fromFull = fullname.match(COURSE_CODE_RE)?.[1];
  return fromFull ?? shortname;
}

export interface KulonCourse {
  id: number;
  fullname: string;
  shortname: string;
  idnumber: string;
  semester?: string | null;
  /** Moodle's own timeline classification — source of truth for active/past. */
  timelineStatus: 'inprogress' | 'past';
}

export interface KulonAssignment {
  id: number;
  name: string;
  module: string;
  eventType: string;
  duedate: number;
  overdue: boolean;
  course: string;
  courseId: number;
  assignmentId: number;
  courseModuleId: number;
  submissionStatus?: KulonSubmission['status'];
}

export interface KulonFile {
  name: string;
  url: string;
}

export interface KulonSubmission {
  status: 'not_submitted' | 'submitted' | 'graded' | 'unknown';
  submittedAt?: number;
  grade?: number | null;
  maxGrade?: number | null;
}

export interface KulonAssignmentDetail {
  assignmentId: number;
  name: string;
  descriptionHtml: string;
  files: KulonFile[];
  submission: KulonSubmission;
  kulonUrl: string;
}

export interface KulonSessionCheck {
  valid: boolean;
  reason: 'ok' | 'no-cookie' | 'stale';
}

export type KulonFileType = 'pdf' | 'pptx' | 'ppt' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'other';

export type KulonContentItemKind = 'file' | 'assign' | 'quiz' | 'url' | 'forum' | 'page' | 'other';

export interface KulonContentItem {
  kind: KulonContentItemKind;
  name: string;
  url: string;
  fileType?: KulonFileType;
  cmid?: number;
  assignmentId?: number;
  duedate?: number;
}

export interface KulonSection {
  id: number;
  label: string;
  dateRange?: string;
  items: KulonContentItem[];
}

export interface KulonCourseContent {
  courseId: number;
  sections: KulonSection[];
}

const DATE_RANGE_RE = /^\d{1,2}\s+[A-Za-z]+\s*-\s*\d{1,2}\s+[A-Za-z]+$/;

// Matches the END date of a Kulon date-range string, e.g. "15 February" from
// "9 February - 15 February".
const RANGE_END_RE = /^\d{1,2}\s+[A-Za-z]+\s*-\s*(\d{1,2})\s+([A-Za-z]+)$/;

// Moodle file-group codes (theme icon path `f/<type>`) -> our FileType.
const MOODLE_FILE_GROUP: Record<string, KulonFileType> = {
  pdf: 'pdf',
  pptx: 'pptx',
  ppt: 'ppt',
  powerpoint: 'pptx',
  'vnd.ms-powerpoint': 'pptx',
  'vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  doc: 'doc',
  docx: 'docx',
  'vnd.ms-word': 'doc',
  'vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  xls: 'xls',
  xlsx: 'xlsx',
  'vnd.ms-excel': 'xls',
  'vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'edit-doc': 'doc',
  'x-office-document': 'doc',
  'x-office-presentation': 'pptx',
  'x-office-spreadsheet': 'xlsx',
};

export function extractFileType(input: string): KulonFileType {
  // 1) moodle icon group: .../f/<type>?...
  const group = input.match(/\/f\/([A-Za-z0-9.\-]+)/);
  if (group) return MOODLE_FILE_GROUP[group[1].toLowerCase()] ?? 'other';
  // 2) file extension
  const m = input.match(/\.([A-Za-z0-9]+)(?:\?|$)/);
  const ext = (m?.[1] ?? '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'pptx': return 'pptx';
    case 'ppt': return 'ppt';
    case 'docx': return 'docx';
    case 'doc': return 'doc';
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    default: return 'other';
  }
}

export function deriveSectionLabel(
  ordinal: number,
  title: string,
): { label: string; dateRange?: string } {
  const t = title.trim();
  if (ordinal === 0) return { label: t || 'General' };
  if (DATE_RANGE_RE.test(t)) return { label: `Pertemuan ${ordinal}`, dateRange: t };
  return { label: t };
}

const MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Progress percentage = share of DATED course sections whose end date has already
 * passed. Only sections carrying a parseable `dateRange` count toward both the
 * numerator and denominator (General/titled-only sections are ignored). Year is
 * inferred from `now`: a section counts as ended if its end date is in the past in
 * either the current or the next calendar year (covers a semester that started last
 * year and ended this winter). Returns undefined when there is nothing to measure.
 *
 * For a PAST (completed) course, every dated section has already ended regardless of
 * month — the year-inference above only holds for the current semester, where a
 * section whose end-month is still ahead of `now` is legitimately "not ended yet".
 * Pass `{ isPast: true }` so a completed course reports 100%.
 */
export function parseSectionProgress(
  sections: KulonSection[],
  now: Date = new Date(),
  opts: { isPast?: boolean } = {},
): number | undefined {
  const ended = sections.filter(
    (s): s is KulonSection & { dateRange: string } => !!s.dateRange,
  );
  if (ended.length === 0) return undefined;
  if (opts.isPast) return 100;

  let past = 0;
  let parseable = 0;
  for (const s of ended) {
    const m = s.dateRange.match(RANGE_END_RE);
    if (!m) continue;
    const month = MONTH_INDEX[m[2].toLowerCase()];
    if (month === undefined) continue;
    parseable += 1;
    const day = Number(m[1]);
    const endOfDay = (year: number) => new Date(year, month, day, 23, 59, 59, 999);
    const isEnded =
      endOfDay(now.getFullYear()).getTime() < now.getTime() ||
      endOfDay(now.getFullYear() + 1).getTime() < now.getTime();
    if (isEnded) past += 1;
  }
  if (parseable === 0) return undefined;
  return Math.round((past / parseable) * 100);
}

@Injectable()
export class KulonService {
  private readonly baseUrl = 'https://kulon2.undip.ac.id';
  private readonly logger = new Logger(KulonService.name);

  private async ajax(
    sessionCookie: string,
    sesskey: string,
    methodname: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(
      `${this.baseUrl}/lib/ajax/service.php?sesskey=${sesskey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      },
    );
    if (!res.ok) throw new Error(`Kulon AJAX failed: ${res.status}`);
    const data = await res.json();
    const first = (data as any[])[0];
    if (first?.error) {
      throw new Error(
        `Kulon method ${methodname} error: ${first.exception?.message ?? 'unknown'}`,
      );
    }
    return first?.data;
  }

  parseSesskey(html: string): string {
    const match = html.match(/name="sesskey"\s+value="([^"]+)"/);
    if (!match) throw new Error('sesskey not found in Kulon page');
    return match[1];
  }

  /**
   * Single source of truth for Kulon session validity. A real session makes
   * GET /my/ return a page containing a `sesskey`. A stale/expired session
   * redirects to a Moodle login page or Microsoft OIDC, or loops redirects
   * (fetch throws "redirect count exceeded") — all map to `stale`.
   */
  async checkSessionValid(sessionCookie: string): Promise<KulonSessionCheck> {
    if (!sessionCookie) return { valid: false, reason: 'no-cookie' };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/my/`, {
        headers: { Cookie: sessionCookie },
        redirect: 'follow',
      });
    } catch (e) {
      // "redirect count exceeded" (redirect loop) is the classic sign of a
      // pre-auth/stale Moodle session — logged for diagnostics (no cookie value).
      if ((e as { cause?: Error })?.cause && /redirect count exceeded/i.test(String((e as { cause?: Error }).cause))) {
        this.logger.warn('Kulon session probe: redirect loop');
      }
      return { valid: false, reason: 'stale' };
    }
    if (!res.ok) {
      this.logger.warn(`Kulon session probe: http ${res.status}`);
      return { valid: false, reason: 'stale' };
    }
    if (/(login\.microsoftonline\.com|\/login\/)/i.test(res.url)) {
      this.logger.warn(`Kulon session probe: redirected to ${res.url.slice(0, 80)}`);
      return { valid: false, reason: 'stale' };
    }
    const html = await res.text();
    if (!/name="sesskey"/.test(html)) {
      this.logger.warn('Kulon session probe: page missing sesskey (login redirect)');
      return { valid: false, reason: 'stale' };
    }
    return { valid: true, reason: 'ok' };
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
      const data = (await this.ajax(
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
  private async identityFromProfilePage(sessionCookie: string): Promise<string | null> {
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
    sessionCookie: string,
    sesskey: string,
  ): Promise<KulonCourse[]> {
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
    const settled = await Promise.allSettled(
      merged.map(async (c) => ({
        id: c.id,
        progress: parseSectionProgress(
          (await this.getCourseContent(sessionCookie, sesskey, c.id)).sections,
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
    return merged.map((c) =>
      progressById.has(c.id) ? { ...c, progress: progressById.get(c.id) } : c,
    );
  }

  async fetchTimelineCourses(
    sessionCookie: string,
    sesskey: string,
    classification: string,
  ): Promise<Omit<KulonCourse, 'timelineStatus'>[]> {
    const data = (await this.ajax(sessionCookie, sesskey, 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification,
      limit: 0,
      offset: 0,
      sort: 'fullname',
    })) as { courses: any[] };
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

  async getAssignments(
    sessionCookie: string,
    sesskey: string,
  ): Promise<KulonAssignment[]> {
    const data = (await this.ajax(sessionCookie, sesskey, 'core_calendar_get_action_events_by_timesort', {
      timesortfrom: 0,
      timesortto: 0,
      limitnum: 50,
    })) as { events: any[] };
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
          courseModuleId: this.extractCourseModuleId(e.url),
        };
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
  async getAllAssignments(
    sessionCookie: string,
    sesskey: string,
  ): Promise<KulonAssignment[]> {
    const courses = await this.getCourses(sessionCookie, sesskey);
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
    return results.flat();
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
      return this.parseAssignmentIndex(await res.text(), courseId, courseName);
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
      return this.parseQuizIndex(await res.text(), courseId, courseName);
    } catch {
      return [];
    }
  }

  /**
   * Parse `/mod/quiz/index.php` HTML into quiz entries. Real Kulon (moove
   * theme) table columns: c0 Week, c1 Name (link), c2 Quiz closes, c3 Grade.
   * The quiz link href is RELATIVE ("view.php?id=105222"), not an absolute
   * /mod/quiz/view.php path. We iterate all BUT the last `<tr>` blocks and
   * keep those linking to a quiz page.
   */
  private parseQuizIndex(
    html: string,
    courseId: number,
    courseName: string,
  ): KulonAssignment[] {
    const out: KulonAssignment[] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(html)) !== null) {
      const link = tr[1].match(/href="[^"]*\/mod\/quiz\/view\.php\?id=(\d+)"|<a\s+href="view\.php\?id=(\d+)"/i);
      if (!link) continue;
      const cmid = Number(link[1] ?? link[2]);
      // Quiz closes column (c2) — may be a date, "No close date", or "-".
      const closesRaw = ((tr[1].match(/<td[^>]*class="cell c2"[^>]*>([\s\S]*?)<\/td>/i) ?? [])[1] ?? '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const name = (tr[1].match(/(?:view\.php\?id=\d+|mod\/quiz\/view\.php\?id=\d+)">([\s\S]*?)<\/a>/i) ??
        tr[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i))?.[1];
      if (!name) continue;
      const due = this.parseMoodleDate(closesRaw);
      const nowSec = Math.floor(Date.now() / 1000);
      const hasNoLimit = /no limit|no close date/i.test(closesRaw);
      const isOverdueRelative = /overdue/i.test(closesRaw);
      const noDue = closesRaw === '' || closesRaw === '-' || hasNoLimit;
      out.push({
        id: cmid,
        name: name.replace(/<[^>]*>/g, '').trim(),
        module: 'quiz',
        eventType: 'due',
        duedate: due ?? 0,
        overdue: noDue ? false : due !== null ? due < nowSec : isOverdueRelative,
        course: courseName,
        courseId,
        assignmentId: cmid,
        courseModuleId: cmid,
        submissionStatus: 'unknown',
      });
    }
    return out;
  }

  /**
   * Parse `/mod/assign/index.php` HTML into assignments. The table row cells
   * are index-ordered (c0 Section, c1 Assignments+link, c2 Due date,
   * c3 Submission, c4 Grade); the class carries "generaltable" and the rows
   * link to `/mod/assign/view.php?id=<cmid>`. We iterate all `<tr>` blocks and
   * keep those that link to an assignment + carry a due (c2) and submission
   * (c3) cell — robust to varying table class strings. Verified live: the
   * student sees a "Submission" column with values like "No submission" /
   * "Submitted for grading" / "Graded".
   */
  private parseAssignmentIndex(
    html: string,
    courseId: number,
    courseName: string,
  ): KulonAssignment[] {
    const out: KulonAssignment[] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(html)) !== null) {
      const link = tr[1].match(/href="[^"]*\/mod\/assign\/view\.php\?id=(\d+)"/i);
      if (!link) continue;
      const dueRaw = ((tr[1].match(/<td[^>]*class="cell c2"[^>]*>([\s\S]*?)<\/td>/i) ?? [])[1] ?? '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const subRaw = ((tr[1].match(/<td[^>]*class="cell c3"[^>]*>([\s\S]*?)<\/td>/i) ?? [])[1] ?? '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      // Assignment rows always expose Due (c2) and Submission (c3) cells.
      if (!dueRaw && !subRaw) continue;
      const name = (tr[1].match(/view\.php\?id=\d+">([\s\S]*?)<\/a>/i) ??
        tr[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i))?.[1];
      if (!name) continue;
      const cmid = Number(link[1]);
      const due = this.parseMoodleDate(dueRaw);
      const nowSec = Math.floor(Date.now() / 1000);
      const isOverdueRelative = /overdue/i.test(dueRaw);
      out.push({
        id: cmid,
        name: name.replace(/<[^>]*>/g, '').trim(),
        module: 'assign',
        eventType: 'due',
        duedate: due ?? 0,
        overdue: due !== null ? due < nowSec : isOverdueRelative,
        course: courseName,
        courseId,
        assignmentId: cmid,
        courseModuleId: cmid,
        submissionStatus: this.mapIndexSubmissionStatus(subRaw),
      });
    }
    return out;
  }

  /** Map the index "Submission" cell text to our status enum. */
  private mapIndexSubmissionStatus(text: string): KulonSubmission['status'] {
    if (/no submission|not submitted|no submissions|draft/i.test(text)) return 'not_submitted';
    if (/graded/i.test(text)) return 'graded';
    if (/submitted/i.test(text)) return 'submitted';
    return 'unknown';
  }

  async getAssignmentDetail(
    sessionCookie: string,
    assignmentId: number,
    cmid: number,
  ): Promise<KulonAssignmentDetail> {
    const pageUrl = `${this.baseUrl}/mod/assign/view.php?id=${cmid}`;
    const res = await fetch(pageUrl, {
      headers: { Cookie: sessionCookie },
      redirect: 'follow',
    });
    if (res.status === 404) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (!res.ok) throw new Error(`Kulon assignment page failed: ${res.status}`);
    const html = await res.text();
    return {
      assignmentId,
      name: this.extractName(html),
      descriptionHtml: this.extractDescription(html),
      files: this.extractFiles(html),
      submission: this.parseSubmissionFromHtml(html),
      kulonUrl: pageUrl,
    };
  }

  /**
   * Parse submission status/grade/timestamps from the assignment page HTML.
   * The `mod_assign_get_submission_status` AJAX webservice is DISABLED on
   * Kulon, but the page always renders the summary in
   * `<div class="submissionstatustable">`. Defensive: never throws; worst case
   * falls back to `{ status: 'unknown' }`.
   */
  private parseSubmissionFromHtml(html: string): KulonSubmission {
    const fallback: KulonSubmission = { status: 'unknown', grade: null, maxGrade: null };
    // Grab the submission summary TABLE that lives inside the
    // `submissionstatustable` div. Capturing the table (not counting enclosing
    // divs) is robust to theme nesting depth. All status rows are in it.
    const blockMatch = html.match(
      /<div class="submissionstatustable">[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i,
    );
    const block = blockMatch ? `<table>${blockMatch[1]}</table>` : '';
    if (!block) return fallback;

    const rows: { label: string; value: string }[] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(block)) !== null) {
      const labelMatch = tr[1].match(/<th[^>]*>([\s\S]*?)<\/th>/i);
      const valueMatch = tr[1].match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (!labelMatch || !valueMatch) continue;
      rows.push({
        label: labelMatch[1].replace(/<[^>]*>/g, '').trim().toLowerCase(),
        value: valueMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      });
    }
    if (rows.length === 0) return fallback;

    const get = (label: string) => rows.find((r) => r.label.includes(label))?.value ?? '';
    const submissionStatus = get('submission status');
    const gradingStatus = get('grading status');
    const lastModified = get('last modified');

    let status: KulonSubmission['status'] = 'unknown';
    const isGraded = /graded/i.test(gradingStatus) && !/not graded/i.test(gradingStatus);
    if (isGraded) status = 'graded';
    else if (/not submitted|no submissions|draft/i.test(submissionStatus)) status = 'not_submitted';
    else if (/submitted/i.test(submissionStatus)) status = 'submitted';

    const grade = this.extractGrade(block);
    const submittedAt = this.parseMoodleDate(lastModified);

    return {
      status,
      submittedAt: submittedAt ?? undefined,
      grade: grade?.grade ?? null,
      maxGrade: grade?.maxGrade ?? null,
    };
  }

  /**
   * Best-effort numeric grade: Moodle renders it as "85.00 / 100.00"
   * somewhere in the submission summary. Scan the whole block for the pair;
   * return null when absent (UI renders "Belum dinilai").
   */
  private extractGrade(block: string): { grade: number; maxGrade: number } | null {
    const m = block.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const toNum = (s: string) => Number(s.replace(',', '.'));
    return { grade: toNum(m[1]), maxGrade: toNum(m[2]) };
  }

  /**
   * Parse a Moodle "Last modified" value like
   * `Thursday, 7 May 2026, 11:50 PM` into epoch seconds. Moodle renders these
   * in WIB (UTC+7), so interpret the wall-clock as WIB via Date.UTC minus the
   * 7-hour offset — otherwise a server running in UTC (containers/cloud) shifts
   * every timestamp by +7h (B8). Best-effort; null on any unexpected shape
   * (caller maps to undefined).
   */
  private parseMoodleDate(text: string): number | null {
    if (!text) return null;
    const m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(?:(\d{1,2}):(\d{2}))?\s*(AM|PM)?/i);
    if (!m) return null;
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    const month = months[(m[2] || '').toLowerCase()];
    if (month === undefined) return null;
    let hour = m[4] ? Number(m[4]) : 12;
    const minute = m[5] ? Number(m[5]) : 0;
    const ampm = (m[6] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    // Date.UTC gives the instant UTC would show for that wall-clock; subtracting
    // 7h converts from WIB (UTC+7) to the true UTC instant. Date.UTC normalizes
    // hour < 0 / > 24 across day boundaries correctly.
    return Math.floor((Date.UTC(Number(m[3]), month, Number(m[1]), hour, minute) - 7 * 3_600_000) / 1000);
  }

  /**
   * Extract the assignment page id from a Moodle calendar event `url` such as
   * `https://kulon2.undip.ac.id/mod/assign/view.php?id=3335`. This is the id
   * the detail page needs (`view.php?id=<n>`); it is the module instance id
   * for mod_assign and equals what the frontend treats as courseModuleId.
   * Returns 0 when the url does not match (caller should skip detail).
   */
  private extractCourseModuleId(url: string | undefined): number {
    const match = (url ?? '').match(/\/mod\/assign\/view\.php\?id=(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  private extractDescription(html: string): string {
    const match = html.match(/id="intro"[\s\S]*?<div class="no-overflow">([\s\S]*?)<\/div>/);
    return match ? match[1].trim() : '';
  }

  private extractName(html: string): string {
    const match = html.match(/id="page-header"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (!match) return '';
    return match[1].replace(/<[^>]*>/g, '').trim();
  }

  private extractFiles(html: string): KulonFile[] {
    const regex = /<a[^>]+href="([^"]*\/pluginfile\.php\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const result: KulonFile[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      if (m[1].includes('/theme/')) continue;
      result.push({ name: m[2].replace(/<[^>]*>/g, '').trim(), url: m[1] });
    }
    return result;
  }

  private moduleKind(modname: string): KulonContentItemKind {
    switch (modname) {
      case 'assign': return 'assign';
      case 'quiz': return 'quiz';
      case 'url': return 'url';
      case 'forum': return 'forum';
      case 'page': return 'page';
      case 'resource': return 'file';
      default: return 'other';
    }
  }

  /**
   * Parse konten course dari HTML `/course/view.php?id=`. Dua pass independen:
   * 1) header section (`<li id="section-N" ... data-sectionname="...">`),
   * 2) wrapper item (`<div class="activity-item" data-activityname="...">`),
   * lalu bucket item ke section header terdekat sebelumnya berdasar posisi.
   * Ini robust thd nested <li> (module li di dalam section li) yang bikin
   * pendekatan block-regex gagal (verified thd fixture asli, 14 item).
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
    const html = await res.text();

    // Pass 1: header section.
    const secRe = /<li id="section-(\d+)"[^>]*?data-sectionname="([^"]*)"/g;
    const headers: {
      pos: number;
      id: number;
      ordinal: number;
      label: string;
      dateRange?: string;
    }[] = [];
    let m: RegExpExecArray | null;
    let ordinal = 0;
    while ((m = secRe.exec(html)) !== null) {
      const id = Number(m[1]);
      // ordinal = urutan section perkuliahan (id>0); section 0 = General.
      const ord = id === 0 ? 0 : ++ordinal;
      const { label, dateRange } = deriveSectionLabel(ord, m[2]);
      headers.push({ pos: m.index, id, ordinal: ord, label, dateRange });
    }

    // Pass 2: wrapper item (nama dari data-activityname; icon f/<type> utk fileType).
    // Capture from `data-activityname=` up to the NEXT activity-item or the
    // enclosing section `</ul>` — NOT a div-pairing boundary. Moodle items embed
    // nested <div>s (rich descriptions, activity-instruction, icon, etc.) that
    // make `</div></div>`-based regexes truncate before the <a> link (B12).
    const itemRe =
      /<div class="activity-item[^"]*" data-activityname="([^"]*)"([\s\S]*?)(?=<div class="activity-item|<\/ul>)/g;
    const linkRe = /<a[^>]+href="([^"]*\/mod\/([a-z]+)\/view\.php\?id=(\d+)[^"]*)"[^>]*>/;
    const iconRe = /<img[^>]+src="([^"]*\/f\/([A-Za-z0-9.\-]+))[?"]/;

    const sections = headers.map((h) => ({
      id: h.id,
      label: h.label,
      dateRange: h.dateRange,
      items: [] as KulonContentItem[],
    }));

    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(html)) !== null) {
      const name = im[1].trim();
      const wrapper = im[2];
      const link = wrapper.match(linkRe);
      if (!link) continue;
      const base = { name, url: link[1], cmid: Number(link[3]) };
      const kind = this.moduleKind(link[2]);
      const icon = wrapper.match(iconRe);
      // Bucket ke section header terakhir sebelum posisi item ini.
      let owner = sections[0];
      for (const h of headers) {
        if (h.pos < im.index) owner = sections[headers.indexOf(h)];
        else break;
      }
      if (kind === 'file') {
        owner.items.push({
          ...base,
          kind,
          fileType: icon ? extractFileType(icon[1]) : 'other',
        });
      } else {
        owner.items.push({ ...base, kind, duedate: undefined });
      }
    }

    return { courseId, sections };
  }

  /**
   * Fetch the Moodle course-format state as JSON (core_courseformat_get_state) and
   * map it into KulonCourseContent. This is the JSON alternative to the more fragile
   * HTML scrape contentFromHTML. `kind` derives from `cm.module` (lowercase), NOT
   * `cm.modname` (capitalized). JSON ids are strings -> Number() coerced for numeric
   * fields. A cm is included iff `uservisible !== false` OR `module` is assign/quiz.
   */
  private async getCourseState(
    cookie: string,
    sesskey: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    const raw = (await this.ajax(
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
    return this.mapCourseStateJson(raw, courseId);
  }

  private mapCourseStateJson(raw: any, courseId: number): KulonCourseContent {
    const sections = (raw?.section ?? []).map((s: any) => {
      // Section id = ORDINAL (s.number), matching the HTML path's 0,1,2,... ids —
      // NOT the Moodle record id (s.id like "114151"). s.number is a number already;
      // Number() guards against string forms.
      const id = Number(s.number ?? s.id);
      const { label, dateRange } = deriveSectionLabel(id, s.title ?? '');
      return { id, label, dateRange, items: [] as KulonContentItem[] };
    });
    const byId = new Map<number, KulonSection>();
    for (const sec of sections) byId.set(sec.id, sec);

    for (const cm of raw?.cm ?? []) {
      if (cm.uservisible === false && cm.module !== 'assign' && cm.module !== 'quiz') continue;
      // Bucket by cm.sectionnumber (ordinal), matching the section id above.
      const owner = byId.get(Number(cm.sectionnumber ?? cm.sectionid));
      if (!owner) continue;
      const kind = this.moduleKind(cm.module);
      const base = { name: cm.name ?? '', url: cm.url ?? '', cmid: Number(cm.id) };
      if (kind === 'file') {
        owner.items.push({ ...base, kind, fileType: extractFileType(cm.url ?? '') });
      } else {
        owner.items.push({ ...base, kind, duedate: undefined });
      }
    }
    return { courseId, sections };
  }

  async getCourseContent(
    cookie: string,
    sesskey: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    // JSON-first via core_courseformat_get_state; fall back to the HTML scrape on
    // ANY error (method disabled, session quirks, even a missing res.json() on a
    // stubbed response) so a JSON regression never breaks course content.
    try {
      return await this.getCourseState(cookie, sesskey, courseId);
    } catch {
      return this.contentFromHTML(cookie, courseId);
    }
  }
}