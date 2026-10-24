/** Unit test murni untuk kulon-ws-steps dengan fetch palsu (node test runner). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FetchLike } from './kulon-ws-http';
import {
  ASSIGN_METHOD,
  assignmentInstanceIds,
  buildCoverage,
  collectDiagnostics,
  collectTimeline,
  diagnosticEntries,
  measureCandidateAssignments,
  measureCandidateCourses,
  measureSubmissionStatus,
  timelineEntries,
} from './kulon-ws-steps';

interface Reply {
  status?: number;
  body: string;
}

function sequence(replies: Reply[]): { fetchImpl: FetchLike; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  let index = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return {
      status: reply.status ?? 200,
      url,
      headers: { get: () => null },
      text: async () => reply.body,
    } as unknown as Response;
  }) as FetchLike;
  return { fetchImpl, calls };
}

function timelineReply(): Reply {
  return {
    body: JSON.stringify([
      { error: false, data: { courses: [{ id: 9, fullname: 'Kesembilan', shortname: 'K9', idnumber: '9' }] } },
      {
        error: false,
        data: {
          courses: [
            { id: 7, fullname: 'Ketujuh', shortname: 'K7', idnumber: '7' },
            { id: 9, fullname: 'Kesembilan', shortname: 'K9', idnumber: '9' },
          ],
        },
      },
      { error: false, data: { courses: [{ id: 7, fullname: 'Ketujuh-hidden', shortname: 'K7', idnumber: '7' }] } },
    ]),
  };
}

test('timelineEntries mengirim tiga klasifikasi dalam satu array', () => {
  const entries = timelineEntries();
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => entry.args.classification),
    ['inprogress', 'all', 'hidden'],
  );
});

test('collectTimeline menggabungkan hidden lalu all, dedupe, dan urut menaik', async () => {
  const { fetchImpl } = sequence([timelineReply()]);
  const result = await collectTimeline(fetchImpl, 'cookie', 'K1');
  assert.equal(result.shape, 'positional');
  assert.deepEqual(result.courses.map((course) => course.id), [7, 9]);
  assert.equal(result.courses[0].fullname, 'Ketujuh-hidden');
  assert.equal(result.hasProgress, false);
});

test('diagnosticEntries membuang entri completion saat userid tidak diketahui', () => {
  assert.equal(diagnosticEntries([1, 2], null).length, 4);
  const withUser = diagnosticEntries([1, 2], 55);
  assert.equal(withUser.length, 5);
  assert.deepEqual(withUser[4].args, { courseid: 1, userid: 55 });
});

test('collectDiagnostics memetakan error per entri berdasarkan posisi', async () => {
  const { fetchImpl } = sequence([
    {
      body: JSON.stringify([
        { error: true, errorcode: 'accessexception', exception: { message: 'ditolak' } },
        { error: false, data: { quizzes: [] } },
        { error: false, data: { events: [] } },
        { error: false, data: { section: [] } },
      ]),
    },
  ]);
  const result = await collectDiagnostics(fetchImpl, 'cookie', 'K1', [1, 2], null);
  assert.equal(result.shape, 'positional');
  assert.equal(result.entries[0].methodname, ASSIGN_METHOD);
  assert.equal(result.entries[0].error, true);
  assert.equal(result.entries[0].errorcode, 'accessexception');
  assert.equal(result.entries[1].error, false);
});

test('measureSubmissionStatus memakai satu POST saat batch diterima', async () => {
  const { fetchImpl, calls } = sequence([
    { body: JSON.stringify([{ error: false, data: {} }, { error: false, data: {} }]) },
  ]);
  const result = await measureSubmissionStatus(fetchImpl, 'cookie', 'K1', [11, 12]);
  assert.equal(calls.length, 1);
  assert.equal(result.batched, true);
  assert.equal(result.measurement.posts, 1);
  assert.equal(result.ok, true);
});

test('measureSubmissionStatus jatuh ke M POST saat respons bukan batch', async () => {
  const { fetchImpl, calls } = sequence([
    { body: '<html>login</html>' },
    { body: JSON.stringify([{ error: false, data: {} }]) },
    { body: JSON.stringify([{ error: false, data: {} }]) },
  ]);
  const result = await measureSubmissionStatus(fetchImpl, 'cookie', 'K1', [11, 12]);
  assert.equal(calls.length, 3);
  assert.equal(result.batched, false);
  assert.equal(result.measurement.posts, 2);
  assert.equal(result.ok, true);
});

test('measureCandidateAssignments menolak entry timeline yang ber-error', async () => {
  const { fetchImpl } = sequence([
    { body: JSON.stringify([{ error: true, errorcode: 'sesskey' }, { error: true }, { error: true }]) },
    { body: JSON.stringify([{ error: false, data: {} }, { error: false, data: {} }]) },
  ]);
  const result = await measureCandidateAssignments(fetchImpl, 'cookie', 'K1', [7]);
  assert.equal(result.ok, false);
});

test('measureCandidateCourses menolak timeline yang gagal', async () => {
  const { fetchImpl } = sequence([
    { body: JSON.stringify([{ error: true }, { error: true }, { error: true }]) },
    { body: JSON.stringify([{ error: false, data: { section: [] } }]) },
  ]);
  const result = await measureCandidateCourses(fetchImpl, 'cookie', 'K1', [7]);
  assert.equal(result.ok, false);
});

test('measureSubmissionStatus menolak keberhasilan parsial', async () => {
  const { fetchImpl } = sequence([
    { body: JSON.stringify([{ error: false, data: {} }, { error: true, errorcode: 'notfound' }]) },
  ]);
  const result = await measureSubmissionStatus(fetchImpl, 'cookie', 'K1', [11, 12]);
  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.equal(result.measurement.posts, 1);
});

test('assignmentInstanceIds mengambil id instance dan mengabaikan nilai tidak valid', () => {
  assert.deepEqual(assignmentInstanceIds([{ id: 101 }, { id: 0 }, { id: 'x' }, {}]), [101]);
});

test('buildCoverage melaporkan selisih cmid dua arah per kursus', () => {
  const pages = {
    assign: new Map([
      [7, '<a href="/mod/assign/view.php?id=11">a</a><a href="/mod/assign/view.php?id=12">b</a>'],
    ]),
    quiz: new Map([[7, '<a href="view.php?id=21">a</a>']]),
  };
  const coverage = buildCoverage(
    [7],
    pages,
    [
      { cmid: 11, courseId: 7 },
      { cmid: 99, courseId: 7 },
    ],
    [{ coursemodule: 21, course: 7 }],
  );
  assert.equal(coverage.length, 1);
  assert.deepEqual(coverage[0].assignOnlyHtml, [12]);
  assert.deepEqual(coverage[0].assignOnlyWs, [99]);
  assert.deepEqual(coverage[0].quizOnlyHtml, []);
});
