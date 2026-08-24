import { sanitizeDescriptionHtml } from './sanitize-description';

/**
 * Pure Kulon HTML/JSON → typed-data parsers. Fixture-in, result-out: no DI,
 * no fetch, no session plumbing — transport lives in kulon-upstream.session,
 * orchestration in KulonService. Upstream-HTML quirks concentrate here.
 */

export interface KulonCourse {
  id: number;
  fullname: string;
  shortname: string;
  idnumber: string;
  semester?: string | null;
  /** Moodle's own timeline classification — source of truth for active/past. */
  timelineStatus: 'inprogress' | 'past';
  /** Best-effort lecturer name merged from SIAP by MIK code; absent when unavailable. */
  lecturer?: string;
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

export type KulonFileType =
  'pdf' | 'pptx' | 'ppt' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'other';

export type KulonContentItemKind =
  'file' | 'assign' | 'quiz' | 'url' | 'forum' | 'page' | 'other';

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
    case 'pdf':
      return 'pdf';
    case 'pptx':
      return 'pptx';
    case 'ppt':
      return 'ppt';
    case 'docx':
      return 'docx';
    case 'doc':
      return 'doc';
    case 'xlsx':
      return 'xlsx';
    case 'xls':
      return 'xls';
    default:
      return 'other';
  }
}

export function deriveSectionLabel(
  ordinal: number,
  title: string,
): { label: string; dateRange?: string } {
  const t = title.trim();
  if (ordinal === 0) return { label: t || 'General' };
  if (DATE_RANGE_RE.test(t))
    return { label: `Pertemuan ${ordinal}`, dateRange: t };
  return { label: t };
}

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
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
    const endOfDay = (year: number) =>
      new Date(year, month, day, 23, 59, 59, 999);
    const isEnded =
      endOfDay(now.getFullYear()).getTime() < now.getTime() ||
      endOfDay(now.getFullYear() + 1).getTime() < now.getTime();
    if (isEnded) past += 1;
  }
  if (parseable === 0) return undefined;
  return Math.round((past / parseable) * 100);
}

/**
 * Parse `/mod/quiz/index.php` HTML into quiz entries. Real Kulon (moove
 * theme) table columns: c0 Week, c1 Name (link), c2 Quiz closes, c3 Grade.
 * The quiz link href is RELATIVE ("view.php?id=105222"), not an absolute
 * /mod/quiz/view.php path. We iterate all BUT the last `<tr>` blocks and
 * keep those linking to a quiz page.
 */
export function parseQuizIndex(
  html: string,
  courseId: number,
  courseName: string,
): KulonAssignment[] {
  const out: KulonAssignment[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const link = tr[1].match(
      /href="[^"]*\/mod\/quiz\/view\.php\?id=(\d+)"|<a\s+href="view\.php\?id=(\d+)"/i,
    );
    if (!link) continue;
    const cmid = Number(link[1] ?? link[2]);
    // Quiz closes column (c2) — may be a date, "No close date", or "-".
    const closesRaw = (
      (tr[1].match(/<td[^>]*class="cell c2"[^>]*>([\s\S]*?)<\/td>/i) ??
        [])[1] ?? ''
    )
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const name = (tr[1].match(
      /(?:view\.php\?id=\d+|mod\/quiz\/view\.php\?id=\d+)">([\s\S]*?)<\/a>/i,
    ) ?? tr[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i))?.[1];
    if (!name) continue;
    const due = parseMoodleDate(closesRaw);
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
      overdue: noDue
        ? false
        : due !== null
          ? due < nowSec
          : isOverdueRelative,
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
export function parseAssignmentIndex(
  html: string,
  courseId: number,
  courseName: string,
): KulonAssignment[] {
  const out: KulonAssignment[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const link = tr[1].match(
      /href="[^"]*\/mod\/assign\/view\.php\?id=(\d+)"/i,
    );
    if (!link) continue;
    const dueRaw = (
      (tr[1].match(/<td[^>]*class="cell c2"[^>]*>([\s\S]*?)<\/td>/i) ??
        [])[1] ?? ''
    )
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const subRaw = (
      (tr[1].match(/<td[^>]*class="cell c3"[^>]*>([\s\S]*?)<\/td>/i) ??
        [])[1] ?? ''
    )
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Assignment rows always expose Due (c2) and Submission (c3) cells.
    if (!dueRaw && !subRaw) continue;
    const name = (tr[1].match(/view\.php\?id=\d+">([\s\S]*?)<\/a>/i) ??
      tr[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i))?.[1];
    if (!name) continue;
    const cmid = Number(link[1]);
    const due = parseMoodleDate(dueRaw);
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
      submissionStatus: mapIndexSubmissionStatus(subRaw),
    });
  }
  return out;
}

/** Map the index "Submission" cell text to our status enum. */
function mapIndexSubmissionStatus(text: string): KulonSubmission['status'] {
  if (/no submission|not submitted|no submissions|draft/i.test(text))
    return 'not_submitted';
  if (/graded/i.test(text)) return 'graded';
  if (/submitted/i.test(text)) return 'submitted';
  return 'unknown';
}

/**
 * Parse submission status/grade/timestamps from the assignment page HTML.
 * The `mod_assign_get_submission_status` AJAX webservice is DISABLED on
 * Kulon, but the page always renders the summary in
 * `<div class="submissionstatustable">`. Defensive: never throws; worst case
 * falls back to `{ status: 'unknown' }`.
 */
export function parseSubmissionFromHtml(html: string): KulonSubmission {
  const fallback: KulonSubmission = {
    status: 'unknown',
    grade: null,
    maxGrade: null,
  };
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
      label: labelMatch[1]
        .replace(/<[^>]*>/g, '')
        .trim()
        .toLowerCase(),
      value: valueMatch[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  if (rows.length === 0) return fallback;

  const get = (label: string) =>
    rows.find((r) => r.label.includes(label))?.value ?? '';
  const submissionStatus = get('submission status');
  const gradingStatus = get('grading status');
  const lastModified = get('last modified');

  let status: KulonSubmission['status'] = 'unknown';
  const isGraded =
    /graded/i.test(gradingStatus) && !/not graded/i.test(gradingStatus);
  if (isGraded) status = 'graded';
  else if (/not submitted|no submissions|draft/i.test(submissionStatus))
    status = 'not_submitted';
  else if (/submitted/i.test(submissionStatus)) status = 'submitted';

  const grade = extractGrade(block);
  const submittedAt = parseMoodleDate(lastModified);

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
function extractGrade(
  block: string,
): { grade: number; maxGrade: number } | null {
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
export function parseMoodleDate(text: string): number | null {
  if (!text) return null;
  const m = text.match(
    /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(?:(\d{1,2}):(\d{2}))?\s*(AM|PM)?/i,
  );
  if (!m) return null;
  const months: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
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
  return Math.floor(
    (Date.UTC(Number(m[3]), month, Number(m[1]), hour, minute) -
      7 * 3_600_000) /
      1000,
  );
}

/**
 * Extract the assignment page id from a Moodle calendar event `url` such as
 * `https://kulon2.undip.ac.id/mod/assign/view.php?id=3335`. This is the id
 * the detail page needs (`view.php?id=<n>`); it is the module instance id
 * for mod_assign and equals what the frontend treats as courseModuleId.
 * Returns 0 when the url does not match (caller should skip detail).
 */
export function extractCourseModuleId(url: string | undefined): number {
  const match = (url ?? '').match(/\/mod\/assign\/view\.php\?id=(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function extractDescription(html: string): string {
  const match = html.match(
    /id="intro"[\s\S]*?<div class="no-overflow">([\s\S]*?)<\/div>/,
  );
  if (!match) return '';
  // Sanitize the extracted HTML server-side with a strict allowlist:
  // instructor-authored assignment content is untrusted, and it flows into
  // v-html on the client. See sanitize-description.ts for the allowlist.
  return sanitizeDescriptionHtml(match[1].trim());
}

export function extractName(html: string): string {
  const match = html.match(
    /id="page-header"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/,
  );
  if (!match) return '';
  return match[1].replace(/<[^>]*>/g, '').trim();
}

export function extractFiles(html: string): KulonFile[] {
  const regex =
    /<a[^>]+href="([^"]*\/pluginfile\.php\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const result: KulonFile[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    if (m[1].includes('/theme/')) continue;
    result.push({ name: m[2].replace(/<[^>]*>/g, '').trim(), url: m[1] });
  }
  return result;
}

export function moduleKind(modname: string): KulonContentItemKind {
  switch (modname) {
    case 'assign':
      return 'assign';
    case 'quiz':
      return 'quiz';
    case 'url':
      return 'url';
    case 'forum':
      return 'forum';
    case 'page':
      return 'page';
    case 'resource':
      return 'file';
    default:
      return 'other';
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
export function parseContentHtml(
  html: string,
  courseId: number,
): KulonCourseContent {
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
  const linkRe =
    /<a[^>]+href="([^"]*\/mod\/([a-z]+)\/view\.php\?id=(\d+)[^"]*)"[^>]*>/;
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
    const kind = moduleKind(link[2]);
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
 * Map the Moodle course-format state JSON (core_courseformat_get_state) into
 * KulonCourseContent. `kind` derives from `cm.module` (lowercase), NOT
 * `cm.modname` (capitalized). JSON ids are strings -> Number() coerced for
 * numeric fields. A cm is included iff `uservisible !== false` OR `module`
 * is assign/quiz.
 */
export function mapCourseStateJson(raw: any, courseId: number): KulonCourseContent {
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
    if (
      cm.uservisible === false &&
      cm.module !== 'assign' &&
      cm.module !== 'quiz'
    )
      continue;
    // Bucket by cm.sectionnumber (ordinal), matching the section id above.
    const owner = byId.get(Number(cm.sectionnumber ?? cm.sectionid));
    if (!owner) continue;
    const kind = moduleKind(cm.module);
    const base = {
      name: cm.name ?? '',
      url: cm.url ?? '',
      cmid: Number(cm.id),
    };
    if (kind === 'file') {
      owner.items.push({
        ...base,
        kind,
        fileType: extractFileType(cm.url ?? ''),
      });
    } else {
      owner.items.push({ ...base, kind, duedate: undefined });
    }
  }
  return { courseId, sections };
}
