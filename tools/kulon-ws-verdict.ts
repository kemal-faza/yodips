/**
 * Inventaris 19 field klien + keputusan verdict probe Kulon.
 * Pure: tanpa fetch, env, maupun filesystem.
 */

export type FieldStatus = 'ws' | 'derived' | 'missing';

export interface InventoryRow {
  no: number;
  field: string;
  object: 'assignment' | 'course';
  status: FieldStatus;
  evidence: string;
}

export interface InventoryInput {
  wsAssignment: Record<string, unknown> | null;
  timelineCourse: Record<string, unknown> | null;
  progressFromTimeline: boolean;
  progressFromState: boolean;
  submissionStatusAvailable: boolean;
}

function present(source: Record<string, unknown> | null, key: string): boolean {
  return source !== null && source[key] !== undefined && source[key] !== null;
}

export function evaluateInventory(input: InventoryInput): InventoryRow[] {
  const assignment = input.wsAssignment;
  const course = input.timelineCourse;
  const cmid = present(assignment, 'cmid');
  const courseIdKnown = present(assignment, 'courseId') || present(assignment, 'course');
  const assignmentCourse = present(course, 'fullname');
  const rows: InventoryRow[] = [
    { no: 1, field: 'id', object: 'assignment', status: cmid ? 'ws' : 'missing', evidence: 'cmid' },
    { no: 2, field: 'name', object: 'assignment', status: present(assignment, 'name') ? 'ws' : 'missing', evidence: 'name' },
    { no: 3, field: 'module', object: 'assignment', status: 'derived', evidence: 'literal assign/quiz' },
    { no: 4, field: 'eventType', object: 'assignment', status: 'derived', evidence: 'literal due' },
    { no: 5, field: 'duedate', object: 'assignment', status: present(assignment, 'duedate') ? 'ws' : 'missing', evidence: 'duedate/cutoffdate' },
    { no: 6, field: 'overdue', object: 'assignment', status: present(assignment, 'duedate') ? 'derived' : 'missing', evidence: 'hitung dari duedate' },
    { no: 7, field: 'course', object: 'assignment', status: courseIdKnown && assignmentCourse ? 'ws' : 'missing', evidence: 'nama kursus timeline' },
    { no: 8, field: 'courseId', object: 'assignment', status: courseIdKnown ? 'ws' : 'missing', evidence: 'id kursus' },
    { no: 9, field: 'assignmentId', object: 'assignment', status: cmid ? 'derived' : 'missing', evidence: 'collapse cmid (F15)' },
    { no: 10, field: 'courseModuleId', object: 'assignment', status: cmid ? 'ws' : 'missing', evidence: 'cmid/coursemodule' },
    { no: 11, field: 'submissionStatus', object: 'assignment', status: input.submissionStatusAvailable ? 'ws' : 'missing', evidence: 'submission status' },
    { no: 12, field: 'id', object: 'course', status: present(course, 'id') ? 'ws' : 'missing', evidence: 'timeline' },
    { no: 13, field: 'fullname', object: 'course', status: present(course, 'fullname') ? 'derived' : 'missing', evidence: 'buang prefix SIAP' },
    { no: 14, field: 'shortname', object: 'course', status: present(course, 'shortname') ? 'derived' : 'missing', evidence: 'extractCourseCode' },
    { no: 15, field: 'idnumber', object: 'course', status: present(course, 'idnumber') ? 'ws' : 'missing', evidence: 'timeline' },
    { no: 16, field: 'semester', object: 'course', status: present(course, 'fullname') ? 'derived' : 'missing', evidence: 'parseSemester' },
    { no: 17, field: 'timelineStatus', object: 'course', status: 'derived', evidence: 'bucket inprogress' },
    { no: 18, field: 'lecturer', object: 'course', status: 'derived', evidence: 'merge SIAP, tidak diuji probe' },
    {
      no: 19,
      field: 'progress',
      object: 'course',
      status: input.progressFromTimeline || input.progressFromState ? 'ws' : 'missing',
      evidence: 'field timeline atau get_state',
    },
  ];
  return rows;
}

export interface CoverageRow {
  courseId: number;
  assignHtml: number;
  assignWs: number;
  assignOnlyHtml: number[];
  assignOnlyWs: number[];
  quizHtml: number;
  quizWs: number;
  quizOnlyHtml: number[];
  quizOnlyWs: number[];
}

export type Verdict = 'PROVISIONAL-GO' | 'CONDITIONAL' | 'NO-GO';

export interface VerdictInput {
  inventory: InventoryRow[];
  coverage: CoverageRow[];
  posts: { timeline: number; assignments: number; submissionStatus: number | null; progress: number };
  pair1Ms: number;
  pair2Ms: number;
  baseline1Ms: number | null;
  baseline2Ms: number | null;
  restAvailableFields: number[];
}

export function decideVerdict(input: VerdictInput): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  const missing = input.inventory.filter((row) => row.status === 'missing');
  const badCoverage = input.coverage.filter(
    (row) =>
      row.assignOnlyHtml.length > 0 ||
      row.assignOnlyWs.length > 0 ||
      row.quizOnlyHtml.length > 0 ||
      row.quizOnlyWs.length > 0,
  );

  const uncoverable = missing.filter((row) => !input.restAvailableFields.includes(row.no));
  const viaRestOnly = missing.filter((row) => input.restAvailableFields.includes(row.no));

  if (uncoverable.length > 0) {
    reasons.push('field tidak dapat diproduksi di jalur mana pun: ' + uncoverable.map((row) => row.no + '.' + row.field).join(', '));
  }
  if (badCoverage.length > 2) reasons.push('selisih cmid pada ' + badCoverage.length + ' kursus (lebih dari 2)');
  if (input.pair1Ms > 8000) reasons.push('pasangan 1 ' + input.pair1Ms + ' ms (lebih dari 8.000)');
  if (input.pair2Ms > 8000) reasons.push('pasangan 2 ' + input.pair2Ms + ' ms (lebih dari 8.000)');
  if (reasons.length > 0) return { verdict: 'NO-GO', reasons };

  if (viaRestOnly.length > 0) {
    reasons.push('field hanya tersedia lewat jalur token (REST): ' + viaRestOnly.map((row) => row.no + '.' + row.field).join(', '));
  }
  if (badCoverage.length > 0) reasons.push('selisih cmid pada ' + badCoverage.length + ' kursus, perlu verifikasi manual');
  if (input.pair1Ms >= 5000 || input.pair2Ms >= 5000) reasons.push('span waktu di rentang 5.000-8.000 ms');
  const moreThanOnePost =
    input.posts.timeline > 1 ||
    input.posts.assignments > 1 ||
    input.posts.progress > 1 ||
    (input.posts.submissionStatus !== null && input.posts.submissionStatus > 1);
  if (moreThanOnePost) reasons.push('ada kebutuhan data yang butuh lebih dari 1 POST');
  const baselineMissing = input.baseline1Ms === null || input.baseline2Ms === null;
  if (baselineMissing) reasons.push('baseline tidak diukur sehingga peningkatan 30 persen tidak dapat dibuktikan');
  if (!baselineMissing) {
    const tooSlow =
      input.pair1Ms > (input.baseline1Ms as number) * 0.7 || input.pair2Ms > (input.baseline2Ms as number) * 0.7;
    if (tooSlow) reasons.push('peningkatan kurang dari 30 persen terhadap baseline');
  }
  if (reasons.length > 0) return { verdict: 'CONDITIONAL', reasons };
  return {
    verdict: 'PROVISIONAL-GO',
    reasons: ['19 field terpetakan, cakupan cmid penuh, maksimal 1 POST per kebutuhan, di bawah 5.000 ms dan minimal 30 persen lebih cepat'],
  };
}
