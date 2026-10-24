/**
 * Langkah probe Kulon: koleksi, pengukuran, oracle cakupan record.
 * Semua I/O lewat fetchImpl yang di-inject; tidak ada jaringan implisit.
 */
import type { FetchLike } from './kulon-ws-http';
import { ajaxBatch, fetchHtmlPage } from './kulon-ws-http';
import type { BatchEntry, DiagnosticEntry, SpotCheckRow } from './kulon-ws-shape';
import { diffSets, extractCmidSet, mapBatchResponse, readEntryError } from './kulon-ws-shape';
import type { CoverageRow } from './kulon-ws-verdict';

export const TIMELINE_METHOD = 'core_course_get_enrolled_courses_by_timeline_classification';
export const ASSIGN_METHOD = 'mod_assign_get_assignments';
export const QUIZ_METHOD = 'mod_quiz_get_quizzes_by_courses';
export const EVENTS_METHOD = 'core_calendar_get_action_events_by_timesort';
export const STATE_METHOD = 'core_courseformat_get_state';
export const COMPLETION_METHOD = 'core_completion_get_activities_completion_status';
export const SUBMISSION_METHOD = 'mod_assign_get_submission_status';
export const SITE_INFO_METHOD = 'core_webservice_get_site_info';

export interface CourseRef {
  id: number;
  fullname: string;
  shortname: string;
  idnumber: string;
}

export interface TimelineResult {
  shape: string;
  courses: CourseRef[];
  hasProgress: boolean;
  extraKeys: string[];
  raw: unknown;
}

export function timelineEntries(): BatchEntry[] {
  return ['inprogress', 'all', 'hidden'].map((classification, index) => ({
    index,
    methodname: TIMELINE_METHOD,
    args: { classification, limit: 0, offset: 0, sort: 'fullname' },
  }));
}

function readData(result: unknown): Record<string, unknown> {
  const record = result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const data = record.data;
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function readCourseList(result: unknown): Array<Record<string, unknown>> {
  const courses = readData(result).courses;
  if (!Array.isArray(courses)) return [];
  return courses.filter((course): course is Record<string, unknown> => course !== null && typeof course === 'object');
}

export async function collectTimeline(fetchImpl: FetchLike, cookie: string, sesskey: string): Promise<TimelineResult> {
  const entries = timelineEntries();
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const mapped = mapBatchResponse(response.body, entries.length);
  if (mapped.shape === 'shape-unknown') {
    return { shape: mapped.shape, courses: [], hasProgress: false, extraKeys: [], raw: response.body };
  }
  const buckets = mapped.results.map(readCourseList);
  const merged = new Map<number, Record<string, unknown>>();
  // Urutan ini meniru produksi: hidden lebih dulu, first-wins (kulon.service.ts:571-578).
  for (const course of [...buckets[2], ...buckets[1]]) {
    const id = Number(course.id);
    if (Number.isFinite(id) && !merged.has(id)) merged.set(id, course);
  }
  const values = Array.from(merged.values());
  const courses: CourseRef[] = values
    .map((course) => ({
      id: Number(course.id),
      fullname: String(course.fullname ?? ''),
      shortname: String(course.shortname ?? ''),
      idnumber: String(course.idnumber ?? ''),
    }))
    .sort((left, right) => left.id - right.id);
  const extraKeys = Array.from(new Set(values.flatMap((course) => Object.keys(course)))).sort();
  const hasProgress = values.some((course) => course.progress !== undefined && course.progress !== null);
  return { shape: mapped.shape, courses, hasProgress, extraKeys, raw: response.body };
}

export async function fetchUserid(fetchImpl: FetchLike, cookie: string, sesskey: string): Promise<number | null> {
  const entries: BatchEntry[] = [{ index: 0, methodname: SITE_INFO_METHOD, args: {} }];
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const mapped = mapBatchResponse(response.body, entries.length);
  if (mapped.shape === 'shape-unknown') return null;
  const userid = Number(readData(mapped.results[0]).userid);
  return Number.isFinite(userid) && userid > 0 ? userid : null;
}

export interface DiagnosticsResult {
  shape: string;
  entries: DiagnosticEntry[];
  raw: unknown;
}

export function diagnosticEntries(courseIds: number[], userid: number | null): BatchEntry[] {
  const specs: Array<{ methodname: string; args: Record<string, unknown> }> = [
    { methodname: ASSIGN_METHOD, args: { courseids: courseIds.slice(0, 2) } },
    { methodname: QUIZ_METHOD, args: { courseids: courseIds.slice(0, 2) } },
    { methodname: EVENTS_METHOD, args: { timesortfrom: 0, timesortto: 0, limitnum: 50 } },
    { methodname: STATE_METHOD, args: { courseid: courseIds[0] } },
  ];
  if (userid !== null) {
    specs.push({ methodname: COMPLETION_METHOD, args: { courseid: courseIds[0], userid } });
  }
  return specs.map((spec, index) => ({ index, methodname: spec.methodname, args: spec.args }));
}

export async function collectDiagnostics(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  courseIds: number[],
  userid: number | null,
): Promise<DiagnosticsResult> {
  const entries = diagnosticEntries(courseIds, userid);
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const mapped = mapBatchResponse(response.body, entries.length);
  // Kulon memotong batch pada method pertama yang tidak tersedia: body adalah
  // presfiks valid yang lebih pendek. Sisa entri disisir satu panggilan per entri.
  const prefix = Array.isArray(response.body) ? response.body : [];
  const truncated = mapped.shape === 'shape-unknown' && prefix.length > 0 && prefix.length < entries.length;
  if (mapped.shape === 'shape-unknown' && !truncated) {
    return { shape: mapped.shape, entries: [], raw: response.body };
  }
  const shape = mapped.shape === 'shape-unknown' ? 'positional' : mapped.shape;
  const results: unknown[] = mapped.shape === 'shape-unknown' ? prefix.slice() : mapped.results;
  if (truncated) {
    for (let index = results.length; index < entries.length; index += 1) {
      const entry = entries[index];
      // Index harus 0: panggilan tunggal ber-index N dibalas objek berkunci {N: ...}, bukan array.
      const single = await ajaxBatch(fetchImpl, cookie, sesskey, [{ index: 0, methodname: entry.methodname, args: entry.args }]);
      const one = mapBatchResponse(single.body, 1);
      if (one.shape === 'shape-unknown') {
        results.push({
          error: true,
          errorcode: 'NOT_TESTED',
          exception: { message: 'respons batch terpotong; panggilan tunggal juga gagal dipetakan' },
        });
      } else {
        results.push(one.results[0]);
      }
    }
  }
  const entriesOut: DiagnosticEntry[] = entries.map((entry, index) => {
    const parsed = readEntryError(results[index]);
    return {
      methodname: entry.methodname,
      error: parsed.error,
      errorcode: parsed.errorcode,
      message: parsed.message,
    };
  });
  return { shape, entries: entriesOut, raw: response.body };
}

export interface Measurement {
  ms: number;
  posts: number;
}

export interface CandidateResult {
  ok: boolean;
  measurement: Measurement;
  assignments: Array<Record<string, unknown>>;
  quizzes: Array<Record<string, unknown>>;
}

function readAssignments(result: unknown): Array<Record<string, unknown>> {
  const courses = readData(result).courses;
  if (!Array.isArray(courses)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of courses) {
    const course = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const list = Array.isArray(course.assignments) ? course.assignments : [];
    for (const item of list) {
      if (item !== null && typeof item === 'object') {
        out.push({ ...(item as Record<string, unknown>), courseId: Number(course.id) });
      }
    }
  }
  return out;
}

function readQuizzes(result: unknown): Array<Record<string, unknown>> {
  const quizzes = readData(result).quizzes;
  if (!Array.isArray(quizzes)) return [];
  return quizzes.filter((quiz): quiz is Record<string, unknown> => quiz !== null && typeof quiz === 'object');
}

export async function measureCandidateAssignments(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  courseIds: number[],
  now: () => number = Date.now,
): Promise<CandidateResult> {
  const started = now();
  const timeline = await ajaxBatch(fetchImpl, cookie, sesskey, timelineEntries());
  const metadata = await ajaxBatch(fetchImpl, cookie, sesskey, [
    { index: 0, methodname: ASSIGN_METHOD, args: { courseids: courseIds } },
    { index: 1, methodname: QUIZ_METHOD, args: { courseids: courseIds } },
  ]);
  const ms = now() - started;
  const timelineMapped = mapBatchResponse(timeline.body, 3);
  const mapped = mapBatchResponse(metadata.body, 2);
  const ok =
    timeline.status === 200 &&
    metadata.status === 200 &&
    timelineMapped.shape !== 'shape-unknown' &&
    timelineMapped.results.every((result) => !readEntryError(result).error) &&
    mapped.shape !== 'shape-unknown' &&
    mapped.results.every((result) => !readEntryError(result).error);
  return {
    ok,
    measurement: { ms, posts: 2 },
    assignments: ok ? readAssignments(mapped.results[0]) : [],
    quizzes: ok ? readQuizzes(mapped.results[1]) : [],
  };
}

export async function measureCandidateCourses(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  courseIds: number[],
  now: () => number = Date.now,
): Promise<{ ok: boolean; measurement: Measurement }> {
  const started = now();
  const timeline = await ajaxBatch(fetchImpl, cookie, sesskey, timelineEntries());
  const entries: BatchEntry[] = courseIds.map((courseid, index) => ({
    index,
    methodname: STATE_METHOD,
    args: { courseid },
  }));
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const ms = now() - started;
  const timelineMapped = mapBatchResponse(timeline.body, 3);
  const timelineOk =
    timeline.status === 200 &&
    timelineMapped.shape !== 'shape-unknown' &&
    timelineMapped.results.every((result) => !readEntryError(result).error);
  const mapped = mapBatchResponse(response.body, entries.length);
  const everyEntryOk =
    mapped.shape !== 'shape-unknown' && mapped.results.every((result) => !readEntryError(result).error);
  return { ok: response.status === 200 && everyEntryOk && timelineOk, measurement: { ms, posts: 2 } };
}

export interface BaselinePages {
  assign: Map<number, string>;
  quiz: Map<number, string>;
}

async function runWorkers(courseIds: number[], workers: number, task: (courseId: number) => Promise<void>): Promise<void> {
  const queue = [...courseIds];
  const worker = async (): Promise<void> => {
    for (;;) {
      const courseId = queue.shift();
      if (courseId === undefined) return;
      await task(courseId);
    }
  };
  const running: Promise<void>[] = [];
  const size = Math.max(1, Math.min(workers, courseIds.length));
  for (let i = 0; i < size; i += 1) running.push(worker());
  await Promise.all(running);
}

export async function measureBaselineAssignments(
  fetchImpl: FetchLike,
  cookie: string,
  courseIds: number[],
  now: () => number = Date.now,
): Promise<{ measurement: Measurement; pages: BaselinePages }> {
  const started = now();
  const pages: BaselinePages = { assign: new Map(), quiz: new Map() };
  await runWorkers(courseIds, 4, async (courseId) => {
    const [assign, quiz] = await Promise.all([
      fetchHtmlPage(fetchImpl, cookie, '/mod/assign/index.php?id=' + courseId),
      fetchHtmlPage(fetchImpl, cookie, '/mod/quiz/index.php?id=' + courseId),
    ]);
    pages.assign.set(courseId, assign.html);
    pages.quiz.set(courseId, quiz.html);
  });
  return { measurement: { ms: now() - started, posts: 2 * courseIds.length }, pages };
}

export async function measureBaselineCourses(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  courseIds: number[],
  now: () => number = Date.now,
): Promise<Measurement> {
  const started = now();
  await Promise.all(
    ['inprogress', 'all', 'hidden'].map((classification) =>
      ajaxBatch(fetchImpl, cookie, sesskey, [
        { index: 0, methodname: TIMELINE_METHOD, args: { classification, limit: 0, offset: 0, sort: 'fullname' } },
      ]),
    ),
  );
  await runWorkers(courseIds, 4, async (courseid) => {
    await ajaxBatch(fetchImpl, cookie, sesskey, [{ index: 0, methodname: STATE_METHOD, args: { courseid } }]);
  });
  return { ms: now() - started, posts: 3 + courseIds.length };
}

export interface SubmissionResult {
  ok: boolean;
  batched: boolean;
  failed: number;
  measurement: Measurement;
}

export function assignmentInstanceIds(assignments: Array<Record<string, unknown>>): number[] {
  return assignments
    .map((assignment) => Number(assignment.id))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export async function measureSubmissionStatus(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  instanceIds: number[],
  now: () => number = Date.now,
): Promise<SubmissionResult> {
  if (instanceIds.length === 0) return { ok: false, batched: true, failed: 0, measurement: { ms: 0, posts: 0 } };
  const started = now();
  const entries: BatchEntry[] = instanceIds.map((assignid, index) => ({
    index,
    methodname: SUBMISSION_METHOD,
    args: { assignid },
  }));
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const mapped = mapBatchResponse(response.body, entries.length);
  if (mapped.shape !== 'shape-unknown') {
    const failed = mapped.results.filter((result) => readEntryError(result).error).length;
    return { ok: failed === 0, batched: true, failed, measurement: { ms: now() - started, posts: 1 } };
  }
  let succeeded = 0;
  for (const assignid of instanceIds) {
    const single = await ajaxBatch(fetchImpl, cookie, sesskey, [
      { index: 0, methodname: SUBMISSION_METHOD, args: { assignid } },
    ]);
    const one = mapBatchResponse(single.body, 1);
    if (one.shape !== 'shape-unknown' && !readEntryError(one.results[0]).error) succeeded += 1;
  }
  return {
    ok: succeeded === instanceIds.length,
    batched: false,
    failed: instanceIds.length - succeeded,
    measurement: { ms: now() - started, posts: instanceIds.length },
  };
}

const QUIZ_CMID_KEYS = ['coursemodule', 'cmid', 'instance'];

export function quizCmid(quiz: Record<string, unknown>): number | null {
  for (const key of QUIZ_CMID_KEYS) {
    const value = Number(quiz[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function buildSpotCheck(
  courseIds: number[],
  assignments: Array<Record<string, unknown>>,
  limit: number,
  mask = true,
): SpotCheckRow[] {
  const allowed = new Set(courseIds.slice(0, limit));
  return assignments
    .filter((assignment) => allowed.has(Number(assignment.courseId)))
    .map((assignment) => {
      const cmid = Number(assignment.cmid);
      return {
        courseId: Number(assignment.courseId),
        cmid,
        name: mask ? '<name#' + cmid + '>' : String(assignment.name ?? ''),
        duedate: String(assignment.duedate ?? ''),
      };
    });
}

export function buildCoverage(
  courseIds: number[],
  pages: BaselinePages,
  assignments: Array<Record<string, unknown>>,
  quizzes: Array<Record<string, unknown>>,
): CoverageRow[] {
  return courseIds.map((courseId) => {
    const assignHtmlSet = extractCmidSet(pages.assign.get(courseId) ?? '', 'assign');
    const quizHtmlSet = extractCmidSet(pages.quiz.get(courseId) ?? '', 'quiz');
    const assignWsSet = assignments
      .filter((assignment) => Number(assignment.courseId) === courseId)
      .map((assignment) => Number(assignment.cmid))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const quizWsSet = quizzes
      .filter((quiz) => Number(quiz.course) === courseId)
      .map((quiz) => quizCmid(quiz))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const assignDiff = diffSets(assignHtmlSet, assignWsSet);
    const quizDiff = diffSets(quizHtmlSet, quizWsSet);
    return {
      courseId,
      assignHtml: assignHtmlSet.length,
      assignWs: assignWsSet.length,
      assignOnlyHtml: assignDiff.onlyLeft,
      assignOnlyWs: assignDiff.onlyRight,
      quizHtml: quizHtmlSet.length,
      quizWs: quizWsSet.length,
      quizOnlyHtml: quizDiff.onlyLeft,
      quizOnlyWs: quizDiff.onlyRight,
    };
  });
}
