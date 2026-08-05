import { Injectable } from '@nestjs/common';

const SEMESTER_RE = /(20\d{2}\/\d{4})\s+(Ganjil|Genap|Pendek)/i;

export function parseSemester(fullname: string, idnumber = ''): string | null {
  const m = fullname.match(SEMESTER_RE) ?? idnumber.match(SEMESTER_RE);
  if (!m) return null;
  const term = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  return `${m[1]} ${term}`;
}

export interface KulonCourse {
  id: number;
  fullname: string;
  shortname: string;
  idnumber: string;
  semester?: string | null;
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

@Injectable()
export class KulonService {
  private readonly baseUrl = 'https://kulon2.undip.ac.id';

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
    } catch {
      return { valid: false, reason: 'stale' };
    }
    if (!res.ok) return { valid: false, reason: 'stale' };
    if (/(login\.microsoftonline\.com|\/login\/)/i.test(res.url)) {
      return { valid: false, reason: 'stale' };
    }
    const html = await res.text();
    if (!/name="sesskey"/.test(html)) return { valid: false, reason: 'stale' };
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
      // NIM = 8-16 digit number appearing in the profile title.
      return title.match(/\b\d{8,16}\b/)?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async getCourses(
    sessionCookie: string,
    sesskey: string,
  ): Promise<KulonCourse[]> {
    const data = (await this.ajax(sessionCookie, sesskey, 'core_course_get_enrolled_courses_by_timeline_classification', {
      classification: 'all',
      limit: 0,
      offset: 0,
      sort: 'fullname',
    })) as { courses: any[] };
    return (data?.courses ?? []).map((c: any) => ({
      id: c.id,
      fullname: c.fullname,
      shortname: c.shortname,
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

  async getAssignmentDetail(
    sessionCookie: string,
    sesskey: string,
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
    // Pengunjung (course-content path) hanya kirim cmid, bukan assign instance id.
    // Ekstrak assignid asli dari halaman detail; fallback ke param bila tidak ketemu
    // (dashboard path tetap aman — param dari calendar event.instance).
    const assignid = this.extractAssignId(html, assignmentId);
    const sub = await this.ajax(
      sessionCookie,
      sesskey,
      'mod_assign_get_submission_status',
      { assignid },
    );
    return {
      assignmentId,
      name: this.extractName(html),
      descriptionHtml: this.extractDescription(html),
      files: this.extractFiles(html),
      submission: this.normalizeSubmission(sub),
      kulonUrl: pageUrl,
    };
  }

  /**
   * Extract the Moodle assign instance id (assignid) from the assignment detail
   * page HTML. The course-content path only exposes the cmid in the URL, but
   * `mod_assign_get_submission_status` needs the assign instance id (which
   * differs from cmid). Moodle embeds it in the page — try several markers,
   * falling back to the caller-provided assignmentId when none match.
   */
  private extractAssignId(html: string, fallback: number): number {
    const patterns = [
      /name="assignid"\s+value="(\d+)"/i,
      /data-assignmentid="(\d+)"/i,
      /data-id-instance="(\d+)"/i,
      /"assignmentid"\s*:\s*(\d+)/i,
      /M\.mod_assign\.init\(\s*\{[^}]*?["']?assignmentid["']?\s*:\s*(\d+)/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return Number(m[1]);
    }
    // Fallback: reuse the cmid-as-assignmentId only if caller passed no real id.
    return fallback;
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

  private normalizeSubmission(data: any): KulonSubmission {
    if (
      !data ||
      !data.lastattempt?.submission ||
      data.lastattempt.submissionstatus !== 'submitted'
    ) {
      return { status: 'not_submitted', grade: null, maxGrade: null };
    }
    const base: KulonSubmission = {
      status: 'submitted',
      submittedAt: data.lastattempt.submission.timemodified ?? undefined,
      grade: null,
      maxGrade: null,
    };
    if (data.lastattempt.graded && data.feedback?.grade) {
      return {
        ...base,
        status: 'graded',
        grade: data.feedback.grade.grade != null ? Number(data.feedback.grade.grade) : null,
        maxGrade: data.feedback.grade.maxmark != null ? Number(data.feedback.grade.maxmark) : null,
      };
    }
    return base;
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
    const itemRe =
      /<div class="activity-item[^"]*" data-activityname="([^"]*)"([\s\S]*?)<\/div>\s*<\/div>/g;
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

  async getCourseContent(
    cookie: string,
    sesskey: string,
    courseId: number,
  ): Promise<KulonCourseContent> {
    // AJAX core_course_get_contents disabled di Kulon (spike) -> HTML scrape.
    return this.contentFromHTML(cookie, courseId);
  }
}