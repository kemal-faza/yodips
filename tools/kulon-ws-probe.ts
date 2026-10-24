/**
 * CLI probe web-service Kulon: merangkai langkah dan menulis laporan markdown.
 * Cookie hanya dibaca dari env/file dan tidak pernah masuk artefak.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fetchSesskey, launchToken, publicTokenShape, randomPassport, restCall, type FetchLike } from './kulon-ws-http';
import { renderReport } from './kulon-ws-report';
import {
  ASSIGN_METHOD,
  COMPLETION_METHOD,
  EVENTS_METHOD,
  QUIZ_METHOD,
  SITE_INFO_METHOD,
  STATE_METHOD,
  SUBMISSION_METHOD,
  assignmentInstanceIds,
  buildCoverage,
  buildSpotCheck,
  collectDiagnostics,
  collectTimeline,
  fetchUserid,
  measureBaselineAssignments,
  measureBaselineCourses,
  measureCandidateAssignments,
  measureCandidateCourses,
  measureSubmissionStatus,
} from './kulon-ws-steps';
import type { DiagnosticEntry } from './kulon-ws-shape';
import { decideVerdict, evaluateInventory, type Verdict } from './kulon-ws-verdict';

export interface ProbeDeps {
  fetchImpl: FetchLike;
  env: Record<string, string | undefined>;
  now: () => number;
  writeFile: (path: string, content: string) => void;
  readFile: (path: string) => string;
}

export interface ProbeResult {
  verdict: Verdict;
  reasons: string[];
  reportPath: string;
  report: string;
}

const REPORT_NAME = '2026-10-24-kulon-ws.md';
const DEFAULT_OUT_DIR = resolve(__dirname, '..', 'docs', 'probe');

function readCookie(deps: ProbeDeps): string {
  const file = deps.env.KULON_SESSION_COOKIE_FILE;
  if (file !== undefined && file.length > 0) return deps.readFile(file).trim();
  const direct = deps.env.KULON_SESSION_COOKIE;
  if (direct !== undefined && direct.length > 0) return direct.trim();
  throw new Error('KULON_SESSION_COOKIE_FILE atau KULON_SESSION_COOKIE wajib diisi');
}

function outDir(deps: ProbeDeps): string {
  const configured = deps.env.KULON_PROBE_OUT;
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_OUT_DIR;
}

interface TokenRun {
  token: Record<string, unknown>;
  functions: DiagnosticEntry[];
}

function restArgsFor(
  methodname: string,
  courseIds: number[],
  userid: number | null,
  sampleAssignid: number | null,
): Record<string, unknown> | null {
  if (methodname === SITE_INFO_METHOD) return {};
  if (methodname === ASSIGN_METHOD || methodname === QUIZ_METHOD) return { courseids: courseIds.slice(0, 2) };
  if (methodname === STATE_METHOD) return { courseid: courseIds[0] };
  if (methodname === COMPLETION_METHOD) return userid === null ? null : { courseid: courseIds[0], userid };
  if (methodname === SUBMISSION_METHOD) return sampleAssignid === null ? null : { assignid: sampleAssignid };
  return null;
}

async function runTokenPath(
  deps: ProbeDeps,
  cookie: string,
  courseIds: number[],
  userid: number | null,
  failedFunctions: string[],
  sampleAssignid: number | null,
): Promise<TokenRun | null> {
  if (deps.env.KULON_PROBE_TOKEN !== '1') return null;
  const shape = await launchToken(deps.fetchImpl, cookie, randomPassport(), 'kulonprobe');
  const token = publicTokenShape(shape);
  if (shape.shape !== 'ok') return { token, functions: [] };
  const functions: DiagnosticEntry[] = [];
  const targets = [SITE_INFO_METHOD].concat(failedFunctions);
  for (const methodname of targets) {
    const args = restArgsFor(methodname, courseIds, userid, sampleAssignid);
    if (args === null) {
      functions.push({
        methodname: 'rest:' + methodname,
        error: true,
        errorcode: 'NOT_TESTED',
        message: 'parameter tidak tersedia',
        status: 0,
      });
      continue;
    }
    const response = await restCall(deps.fetchImpl, shape.token, methodname, args);
    const record =
      response.body !== null && typeof response.body === 'object' && !Array.isArray(response.body)
        ? (response.body as Record<string, unknown>)
        : {};
    const exception =
      record.exception !== null && typeof record.exception === 'object'
        ? (record.exception as Record<string, unknown>)
        : {};
    functions.push({
      methodname: 'rest:' + methodname,
      error: record.errorcode !== undefined || record.exception !== undefined,
      errorcode: typeof record.errorcode === 'string' ? record.errorcode : null,
      message: typeof exception.message === 'string' ? exception.message : null,
      status: response.status,
    });
  }
  return { token, functions };
}

export async function runProbe(deps: ProbeDeps): Promise<ProbeResult> {
  const cookie = readCookie(deps);
  const session = await fetchSesskey(deps.fetchImpl, cookie);
  if (!session.ok) throw new Error('sesi tidak valid: ' + session.reason);

  const userid = await fetchUserid(deps.fetchImpl, cookie, session.sesskey);
  const timeline = await collectTimeline(deps.fetchImpl, cookie, session.sesskey);
  if (timeline.courses.length === 0) throw new Error('timeline tidak menghasilkan kursus');
  const courseIds = timeline.courses.map((course) => course.id);

  const diagnostics = await collectDiagnostics(deps.fetchImpl, cookie, session.sesskey, courseIds, userid);
  if (diagnostics.shape === 'shape-unknown' && userid === null) {
    throw new Error('SESSION_DEAD_REJECTED: batch non-array dan preflight identitas juga gagal');
  }
  const positiveControl = diagnostics.entries.find((entry) => entry.methodname === EVENTS_METHOD);
  if (positiveControl !== undefined && positiveControl.error) {
    throw new Error('ABORT: kontrol positif gagal (' + (positiveControl.errorcode ?? 'tanpa errorcode') + ')');
  }

  const candidateAssignments = await measureCandidateAssignments(deps.fetchImpl, cookie, session.sesskey, courseIds, deps.now);
  const candidateCourses = await measureCandidateCourses(deps.fetchImpl, cookie, session.sesskey, courseIds, deps.now);

  const runBaseline = deps.env.KULON_PROBE_BASELINE !== '0';
  const baselineAssignments = runBaseline ? await measureBaselineAssignments(deps.fetchImpl, cookie, courseIds, deps.now) : null;
  const baselineCourses = runBaseline
    ? await measureBaselineCourses(deps.fetchImpl, cookie, session.sesskey, courseIds, deps.now)
    : null;

  const instanceIds = assignmentInstanceIds(candidateAssignments.assignments);
  const submission =
    instanceIds.length > 0 ? await measureSubmissionStatus(deps.fetchImpl, cookie, session.sesskey, instanceIds, deps.now) : null;

  const ajaxEntryOk = (methodname: string): boolean => {
    const entry = diagnostics.entries.find((candidate) => candidate.methodname === methodname);
    return entry !== undefined && entry.error === false;
  };
  const ajaxAvailability: Record<string, boolean> = {
    [ASSIGN_METHOD]: ajaxEntryOk(ASSIGN_METHOD),
    [QUIZ_METHOD]: ajaxEntryOk(QUIZ_METHOD),
    [STATE_METHOD]: ajaxEntryOk(STATE_METHOD) && candidateCourses.ok,
    [SUBMISSION_METHOD]: submission !== null && submission.ok,
  };
  const neededFunctions: string[] = [ASSIGN_METHOD, QUIZ_METHOD];
  if (!timeline.hasProgress) neededFunctions.push(STATE_METHOD);
  if (instanceIds.length > 0) neededFunctions.push(SUBMISSION_METHOD);
  const failedFunctions = neededFunctions.filter((methodname) => ajaxAvailability[methodname] !== true);
  const tokenRun =
    failedFunctions.length === 0
      ? null
      : await runTokenPath(deps, cookie, courseIds, userid, failedFunctions, instanceIds[0] ?? null);
  const restOk = (methodname: string): boolean =>
    tokenRun !== null &&
    tokenRun.functions.some((fn) => fn.methodname === 'rest:' + methodname && fn.status !== undefined && fn.error === false);
  const restAvailableFields: number[] = [];
  if (restOk(ASSIGN_METHOD)) restAvailableFields.push(1, 2, 5, 6, 7, 8, 9, 10);
  if (restOk(SUBMISSION_METHOD)) restAvailableFields.push(11);
  if (restOk(STATE_METHOD)) restAvailableFields.push(19);
  const notTestedFunctions = neededFunctions.filter(
    (methodname) => ajaxAvailability[methodname] !== true && !restOk(methodname),
  );
  const limitEnv = Number(deps.env.KULON_PROBE_LIMIT);
  const spotLimit = Number.isFinite(limitEnv) && limitEnv > 0 ? limitEnv : 3;

  const coverage =
    baselineAssignments === null
      ? []
      : buildCoverage(courseIds, baselineAssignments.pages, candidateAssignments.assignments, candidateAssignments.quizzes);

  const firstCourse = timeline.courses[0];
  const inventory = evaluateInventory({
    wsAssignment: candidateAssignments.assignments[0] ?? null,
    timelineCourse:
      firstCourse === undefined
        ? null
        : {
            id: firstCourse.id,
            fullname: firstCourse.fullname,
            shortname: firstCourse.shortname,
            idnumber: firstCourse.idnumber,
          },
    progressFromTimeline: timeline.hasProgress,
    progressFromState: candidateCourses.ok,
    submissionStatusAvailable: submission !== null && submission.ok,
  });

  const pair1Ms = candidateAssignments.measurement.ms + (submission === null ? 0 : submission.measurement.ms);
  const posts = {
    timeline: 1,
    assignments: candidateAssignments.ok ? 1 : 0,
    submissionStatus: submission === null ? null : submission.measurement.posts,
    progress: candidateCourses.ok ? 1 : 0,
  };
  const decision = decideVerdict({
    inventory,
    coverage,
    posts,
    pair1Ms,
    pair2Ms: candidateCourses.measurement.ms,
    baseline1Ms: baselineAssignments === null ? null : baselineAssignments.measurement.ms,
    baseline2Ms: baselineCourses === null ? null : baselineCourses.ms,
    restAvailableFields,
  });

  const report = renderReport({
    generatedAt: new Date(deps.now()).toISOString(),
    n: courseIds.length,
    timelineShape: timeline.shape,
    hasProgress: timeline.hasProgress,
    extraKeys: timeline.extraKeys,
    diagnostics: tokenRun === null ? diagnostics.entries : diagnostics.entries.concat(tokenRun.functions),
    spotCheck: buildSpotCheck(courseIds, candidateAssignments.assignments, spotLimit, deps.env.KULON_PROBE_MASK !== '0'),
    inventory,
    coverage,
    verdict: decision.verdict,
    reasons: decision.reasons,
    pair1Ms,
    pair2Ms: candidateCourses.measurement.ms,
    baseline1Ms: baselineAssignments === null ? null : baselineAssignments.measurement.ms,
    baseline2Ms: baselineCourses === null ? null : baselineCourses.ms,
    posts,
    token: tokenRun === null ? null : tokenRun.token,
    limitations: [
      submission === null
        ? 'submissionStatus: tidak diuji (tidak ada instance assignment)'
        : submission.failed > 0
          ? 'submissionStatus: ' + submission.failed + ' dari ' + instanceIds.length + ' assignment gagal dipetakan (NOT_TESTED)'
          : 'submissionStatus: seluruh ' + instanceIds.length + ' assignment sampel terpetakan',
      notTestedFunctions.length > 0
        ? 'fungsi wajib yang tidak tersedia di jalur mana pun: ' + notTestedFunctions.join(', ')
        : 'semua fungsi wajib tersedia di salah satu jalur',
      'semantik id dua arah belum dibuktikan: keluaran memakai cmid, masukan assignid memakai instance id',
      'status quiz tetap unknown seperti produksi dan belum diuji kesetaraannya',
      'kesetaraan nilai field (name, duedate, overdue) belum dibuktikan; itu fase migrasi',
      'cakupan seluruh varian submissionStatus belum dibuktikan',
      'field turunan course (semester, timelineStatus, lecturer, shortname) belum diuji kesetaraannya',
      'urutan hasil agregat belum dibuktikan stabil',
    ],
  });

  const rawBase = outDir(deps) + '/raw';
  deps.writeFile(rawBase + '/timeline-batch.json', JSON.stringify(timeline.raw, null, 2));
  deps.writeFile(rawBase + '/diagnostics-batch.json', JSON.stringify(diagnostics.raw, null, 2));

  const reportPath = outDir(deps) + '/' + REPORT_NAME;
  deps.writeFile(reportPath, report);
  return { verdict: decision.verdict, reasons: decision.reasons, reportPath, report };
}

async function main(): Promise<void> {
  const result = await runProbe({
    fetchImpl: (url, init) => fetch(url, init),
    env: process.env,
    now: () => Date.now(),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
    },
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  process.stdout.write('verdict: ' + result.verdict + '\n');
  for (const reason of result.reasons) process.stdout.write('alasan: ' + reason + '\n');
  process.stdout.write('laporan: ' + result.reportPath + '\n');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('probe gagal: ' + message + '\n');
    process.exitCode = 1;
  });
}
