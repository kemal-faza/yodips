/** Unit test murni untuk kulon-ws-verdict (node test runner). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideVerdict, evaluateInventory, type CoverageRow, type InventoryRow, type VerdictInput } from './kulon-ws-verdict';

function cleanInventory(): InventoryRow[] {
  return [
    { no: 1, field: 'id', object: 'assignment', status: 'ws', evidence: '' },
    { no: 2, field: 'name', object: 'assignment', status: 'ws', evidence: '' },
  ];
}

function cleanCoverage(courseId: number): CoverageRow {
  return {
    courseId,
    assignHtml: 2,
    assignWs: 2,
    assignOnlyHtml: [],
    assignOnlyWs: [],
    quizHtml: 1,
    quizWs: 1,
    quizOnlyHtml: [],
    quizOnlyWs: [],
  };
}

function baseInput(): VerdictInput {
  return {
    inventory: cleanInventory(),
    coverage: [cleanCoverage(9371)],
    posts: { timeline: 1, assignments: 1, submissionStatus: 1, progress: 1 },
    pair1Ms: 3000,
    pair2Ms: 3200,
    baseline1Ms: 7164,
    baseline2Ms: 9000,
    restAvailableFields: [],
  };
}

test('evaluateInventory menghasilkan tepat 19 baris', () => {
  const rows = evaluateInventory({
    wsAssignment: { cmid: 11, name: 'A', duedate: 1, course: 9371 },
    timelineCourse: { id: 9371, fullname: 'C', shortname: 'S', idnumber: 'I' },
    progressFromTimeline: true,
    progressFromState: true,
    submissionStatusAvailable: true,
  });
  assert.equal(rows.length, 19);
  assert.deepEqual(rows.map((r) => r.no), Array.from({ length: 19 }, (_, i) => i + 1));
});

test('evaluateInventory menandai field sebagai missing saat payload tidak memuatnya', () => {
  const rows = evaluateInventory({
    wsAssignment: { name: 'A' },
    timelineCourse: null,
    progressFromTimeline: false,
    progressFromState: false,
    submissionStatusAvailable: false,
  });
  const missing = rows.filter((r) => r.status === 'missing').map((r) => r.no);
  assert.deepEqual(missing, [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19]);
});

test('decideVerdict memberi PROVISIONAL-GO saat semua syarat terpenuhi', () => {
  assert.equal(decideVerdict(baseInput()).verdict, 'PROVISIONAL-GO');
});

test('decideVerdict memberi NO-GO saat ada field missing', () => {
  const input = baseInput();
  input.inventory = [
    { no: 5, field: 'duedate', object: 'assignment', status: 'missing', evidence: '' },
  ];
  const result = decideVerdict(input);
  assert.equal(result.verdict, 'NO-GO');
  assert.match(result.reasons[0], /duedate/);
});

test('decideVerdict memberi CONDITIONAL saat field hilang tetapi tersedia lewat REST', () => {
  const input: VerdictInput = baseInput();
  input.inventory = [{ no: 11, field: 'submissionStatus', object: 'assignment', status: 'missing', evidence: '' }];
  input.restAvailableFields = [11];
  const result = decideVerdict(input);
  assert.equal(result.verdict, 'CONDITIONAL');
  assert.match(result.reasons.join(' '), /jalur token/);
});

test('decideVerdict memberi NO-GO saat selisih cmid di lebih dari 2 kursus', () => {
  const input = baseInput();
  input.coverage = [1, 2, 3].map((id) => ({ ...cleanCoverage(id), assignOnlyWs: [99] }));
  assert.equal(decideVerdict(input).verdict, 'NO-GO');
});

test('decideVerdict memberi NO-GO saat span melewati 8.000 ms', () => {
  assert.equal(decideVerdict({ ...baseInput(), pair1Ms: 8100 }).verdict, 'NO-GO');
});

test('decideVerdict memberi CONDITIONAL saat submissionStatus butuh lebih dari 1 POST', () => {
  const input = baseInput();
  input.posts = { ...input.posts, submissionStatus: 120 };
  const result = decideVerdict(input);
  assert.equal(result.verdict, 'CONDITIONAL');
  assert.match(result.reasons.join(' '), /lebih dari 1 POST/);
});

test('decideVerdict memberi CONDITIONAL saat baseline tidak diukur', () => {
  const input = baseInput();
  input.baseline1Ms = null;
  const result = decideVerdict(input);
  assert.equal(result.verdict, 'CONDITIONAL');
  assert.match(result.reasons.join(' '), /baseline/);
});

test('decideVerdict memberi CONDITIONAL saat peningkatan kurang dari 30 persen', () => {
  assert.equal(decideVerdict({ ...baseInput(), pair1Ms: 5500, baseline1Ms: 7164 }).verdict, 'CONDITIONAL');
});
