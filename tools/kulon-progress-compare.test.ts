/** Uji node:test murni untuk pembanding progress timeline vs jalur produksi (tanpa jaringan). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KULON_BASE_URL, type FetchLike } from './kulon-ws-http';
import {
  classifyStateVsHtml,
  compareProgress,
  runCompare,
  type ComparisonInput,
} from './kulon-progress-compare';

function inputRow(
  courseId: number,
  timelineStatus: 'inprogress' | 'past',
  timelineProgress: number | null,
  productionProgress: number | undefined,
  source: 'state' | 'html' | 'error',
  stateProgress: number | undefined,
): ComparisonInput {
  return {
    courseId,
    timelineStatus,
    timelineProgress,
    productionProgress,
    stateProgress,
    stateReason: null,
    source,
    hasProgress: timelineProgress !== null,
  };
}

test('compareProgress mengklasifikasikan tujuh kasus dan memecah ringkasan per timelineStatus', () => {
  const result = compareProgress([
    inputRow(7, 'past', 40, 100, 'state', 100),
    inputRow(3, 'inprogress', 40, 60, 'state', 60),
    inputRow(1, 'inprogress', 100, 100, 'state', 100),
    inputRow(4, 'inprogress', null, 25, 'state', 25),
    inputRow(5, 'inprogress', 75, undefined, 'state', 75),
    inputRow(6, 'past', null, undefined, 'state', undefined),
    inputRow(9, 'past', 90, undefined, 'error', undefined),
    inputRow(2, 'past', 100, 100, 'state', 80),
  ]);

  assert.deepEqual(
    result.rows.map((row) => row.courseId),
    [1, 2, 3, 4, 5, 6, 7, 9],
  );
  const classificationById = new Map(result.rows.map((row) => [row.courseId, row.classification]));
  assert.equal(classificationById.get(1), 'equal');
  // Sama persis tetap 'equal' walau timelineStatus past: coercion tidak mengubah nilai.
  assert.equal(classificationById.get(2), 'equal');
  assert.equal(classificationById.get(3), 'differ');
  assert.equal(classificationById.get(4), 'timeline-missing');
  assert.equal(classificationById.get(5), 'production-missing');
  assert.equal(classificationById.get(6), 'both-missing');
  assert.equal(classificationById.get(7), 'past-coerced');
  assert.equal(classificationById.get(9), 'scrape-error');

  assert.equal(result.summary.total, 8);
  assert.deepEqual(result.summary.counts, {
    equal: 2,
    'past-coerced': 1,
    differ: 1,
    'timeline-missing': 1,
    'production-missing': 1,
    'both-missing': 1,
    'scrape-error': 1,
  });
  assert.deepEqual(result.summary.byStatus.inprogress, {
    equal: 1,
    'past-coerced': 0,
    differ: 1,
    'timeline-missing': 1,
    'production-missing': 1,
    'both-missing': 0,
    'scrape-error': 0,
  });
  assert.deepEqual(result.summary.byStatus.past, {
    equal: 1,
    'past-coerced': 1,
    differ: 0,
    'timeline-missing': 0,
    'production-missing': 0,
    'both-missing': 1,
    'scrape-error': 1,
  });

  // stateVsHtml: kursus 2 state 80 vs produksi 100 -> differ, kursus 5 produksi
  // tidak ada -> html-missing, kursus 9 (scrape-error) -> both-missing.
  const stateVsHtmlById = new Map(result.rows.map((row) => [row.courseId, row.stateVsHtml]));
  assert.equal(stateVsHtmlById.get(1), 'equal');
  assert.equal(stateVsHtmlById.get(2), 'differ');
  assert.equal(stateVsHtmlById.get(5), 'html-missing');
  assert.equal(stateVsHtmlById.get(6), 'both-missing');
  assert.equal(stateVsHtmlById.get(7), 'equal');
  assert.deepEqual(result.summary.stateVsHtml, {
    total: 8,
    counts: {
      equal: 4,
      differ: 1,
      'state-unavailable': 0,
      'html-missing': 1,
      'both-missing': 2,
    },
    byStatus: {
      inprogress: {
        equal: 3,
        differ: 0,
        'state-unavailable': 0,
        'html-missing': 1,
        'both-missing': 0,
      },
      past: {
        equal: 1,
        differ: 1,
        'state-unavailable': 0,
        'html-missing': 0,
        'both-missing': 2,
      },
    },
  });
});

test('classifyStateVsHtml memetakan lima hasil: equal hanya bila dua angka sama', () => {
  assert.equal(classifyStateVsHtml(100, 100), 'equal');
  assert.equal(classifyStateVsHtml(0, 0), 'equal');
  assert.equal(classifyStateVsHtml(50, 100), 'differ');
  assert.equal(classifyStateVsHtml(undefined, 100), 'state-unavailable');
  assert.equal(classifyStateVsHtml(100, undefined), 'html-missing');
  assert.equal(classifyStateVsHtml(undefined, undefined), 'both-missing');
});

interface FakeResponseInit {
  status?: number;
  body: string;
}

function fakeResponse(url: string, init: FakeResponseInit): Response {
  return {
    status: init.status ?? 200,
    url,
    headers: { get: () => null },
    text: async () => init.body,
  } as unknown as Response;
}

function timelineCourse(id: number, progress: number | null): Record<string, unknown> {
  const course: Record<string, unknown> = {
    id,
    fullname: 'Kursus Uji ' + id,
    shortname: 'KU' + id,
    idnumber: String(id),
    hasprogress: progress !== null,
  };
  if (progress !== null) course.progress = progress;
  return course;
}

/** Bentuk NYATA balasan Kulon: 'data' adalah string JSON, bukan objek. */
function stateDataString(
  courseId: number,
  sections: Array<{ number: number; title: string }>,
): string {
  return JSON.stringify({
    course: { id: courseId, fullname: 'Kursus Uji ' + courseId },
    section: sections,
    cm: [],
  });
}

function htmlSections(names: string[]): string {
  const parts: string[] = [];
  for (let index = 0; index < names.length; index += 1) {
    parts.push('<li id="section-' + index + '" data-sectionname="' + names[index] + '"></li>');
  }
  return '<ul>' + parts.join('') + '</ul>';
}

test('runCompare memakai parser produksi, fallback HTML, dan menulis satu artefak tanpa cookie', async () => {
  const cookie = 'MoodleSession=uji-rahasia';
  const stateReplies: Record<string, unknown> = {
    // state 100 == html 100 -> equal
    7: stateDataString(7, [
      { number: 0, title: 'General' },
      { number: 1, title: '9 February - 15 February' },
    ]),
    // state 50 (1 dari 2 pertemuan selesai) != html 100 -> differ
    9: stateDataString(9, [
      { number: 1, title: '1 February - 5 February' },
      { number: 2, title: '1 March - 5 March' },
    ]),
    // string yang bukan JSON -> state tidak tersedia, fallback HTML
    11: '<html>bukan state json</html>',
    // varian objek (bukan bentuk produksi): memastikan cabang objek tetap teruji
    12: { section: [{ number: 1, title: '9 February - 15 February' }], cm: [] },
  };
  const htmlPages: Record<string, string> = {
    7: htmlSections(['General', '9 February - 15 February']),
    9: htmlSections(['General', '1 February - 5 February']),
    11: htmlSections(['General', '1 February - 5 February']),
  };
  const calls: Array<{ url: string; body: string }> = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const body = init?.body === undefined ? '' : String(init.body);
    calls.push({ url, body });
    if (url === KULON_BASE_URL + '/my/') {
      return fakeResponse(url, {
        body: '<html><input type="hidden" name="sesskey" value="sesskey-uji"></html>',
      });
    }
    if (url.startsWith(KULON_BASE_URL + '/lib/ajax/service.php?sesskey=')) {
      const entries = JSON.parse(body) as Array<{
        index: number;
        methodname: string;
        args: Record<string, unknown>;
      }>;
      if (entries.length === 3) {
        assert.deepEqual(
          entries.map((entry) => entry.args.classification),
          ['inprogress', 'all', 'hidden'],
        );
        return fakeResponse(url, {
          body: JSON.stringify([
            {
              error: false,
              data: {
                courses: [timelineCourse(7, 100), timelineCourse(9, 40), timelineCourse(12, 100)],
              },
            },
            {
              error: false,
              data: {
                courses: [
                  timelineCourse(7, 100),
                  timelineCourse(9, 40),
                  timelineCourse(11, 40),
                  timelineCourse(12, 100),
                ],
              },
            },
            { error: false, data: { courses: [] } },
          ]),
        });
      }
      assert.equal(entries.length, 1);
      assert.equal(entries[0].index, 0);
      assert.equal(entries[0].methodname, 'core_courseformat_get_state');
      const courseId = String(entries[0].args.courseid);
      assert.ok(courseId === '7' || courseId === '9' || courseId === '11' || courseId === '12');
      return fakeResponse(url, { body: JSON.stringify([{ error: false, data: stateReplies[courseId] }]) });
    }
    if (url.startsWith(KULON_BASE_URL + '/course/view.php?id=')) {
      const id = url.slice((KULON_BASE_URL + '/course/view.php?id=').length);
      assert.ok(id === '7' || id === '9' || id === '11');
      return fakeResponse(url, { body: htmlPages[id] });
    }
    throw new Error('URL tak terduga di fake fetch: ' + url);
  };

  const writes: Array<{ path: string; content: string }> = [];
  const result = await runCompare({
    fetchImpl,
    env: { KULON_SESSION_COOKIE: cookie },
    now: () => new Date(2026, 1, 20).getTime(),
    writeFile: (path, content) => writes.push({ path, content }),
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, result.reportPath);
  assert.ok(result.reportPath.endsWith('/2026-10-24-kulon-progress-compare.md'));
  assert.equal(result.report.includes('uji-rahasia'), false);
  assert.equal(result.report.includes('MoodleSession'), false);
  // Pesan gagal JSON.parse tidak boleh membocorkan isi balasan.
  assert.equal(result.report.includes('bukan state json'), false);

  assert.equal(result.summary.total, 4);
  assert.deepEqual(result.summary.counts, {
    equal: 2,
    'past-coerced': 1,
    differ: 1,
    'timeline-missing': 0,
    'production-missing': 0,
    'both-missing': 0,
    'scrape-error': 0,
  });
  assert.deepEqual(result.summary.byStatus.inprogress, {
    equal: 2,
    'past-coerced': 0,
    differ: 1,
    'timeline-missing': 0,
    'production-missing': 0,
    'both-missing': 0,
    'scrape-error': 0,
  });
  assert.deepEqual(result.summary.byStatus.past, {
    equal: 0,
    'past-coerced': 1,
    differ: 0,
    'timeline-missing': 0,
    'production-missing': 0,
    'both-missing': 0,
    'scrape-error': 0,
  });
  assert.deepEqual(result.summary.stateVsHtml, {
    total: 4,
    counts: {
      equal: 2,
      differ: 1,
      'state-unavailable': 1,
      'html-missing': 0,
      'both-missing': 0,
    },
    byStatus: {
      inprogress: {
        equal: 2,
        differ: 1,
        'state-unavailable': 0,
        'html-missing': 0,
        'both-missing': 0,
      },
      past: {
        equal: 0,
        differ: 0,
        'state-unavailable': 1,
        'html-missing': 0,
        'both-missing': 0,
      },
    },
  });

  assert.ok(
    result.report.includes(
      '| courseId | timelineStatus | timelineProgress | productionProgress | source | classification |' +
        ' stateProgress | stateVsHtml | stateReason |',
    ),
  );
  // Kursus 7: state string 100 == HTML 100, produksi tetap dari HTML.
  assert.ok(result.report.includes('| 7 | inprogress | 100 | 100 | html | equal | 100 | equal | - |'));
  // Kursus 9: state string 50, HTML 100 -> differ; produksi tetap dari HTML.
  assert.ok(result.report.includes('| 9 | inprogress | 40 | 100 | html | differ | 50 | differ | - |'));
  // Kursus 11: string bukan JSON -> stateProgress undefined + alasan berlabel.
  assert.ok(
    result.report.includes(
      '| 11 | past | 40 | 100 | html | past-coerced | undefined | state-unavailable |' +
        ' get_state data bukan JSON yang valid |',
    ),
  );
  // Kursus 12: data objek (seperti perilaku alat lama) -> produksi dari state.
  assert.ok(result.report.includes('| 12 | inprogress | 100 | 100 | state | equal | 100 | equal | - |'));

  assert.ok(result.report.includes('## Pertanyaan adopsi'));
  assert.ok(
    result.report.includes('## Pertanyaan adopsi 2 - bisakah get_state menggantikan scrape HTML?'),
  );
  assert.ok(result.report.includes('| klasifikasi stateVsHtml | inprogress | past | total |'));
  assert.ok(
    result.report.includes('- Kursus dengan state == html (equal): 2 dari 4 (inprogress 2, past 0).'),
  );
  assert.ok(result.report.includes('- Kursus yang berbeda (differ): 1 dari 4 (inprogress 1, past 0).'));
  assert.ok(
    result.report.includes(
      '- Kursus yang state-nya tidak tersedia (state-unavailable): 1 dari 4 (inprogress 0, past 1).',
    ),
  );
  assert.ok(
    result.report.includes(
      'Kesetaraan di semua 4 kursus adalah prasyarat untuk menggantikan 4 GET HTML +' +
        ' 4 POST get_state yang terbuang dengan satu POST get_state batch.',
    ),
  );

  assert.equal(calls.length, 9);
  assert.equal(
    calls.filter((call) => call.url === KULON_BASE_URL + '/course/view.php?id=7').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url === KULON_BASE_URL + '/course/view.php?id=9').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url === KULON_BASE_URL + '/course/view.php?id=11').length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.url === KULON_BASE_URL + '/course/view.php?id=12').length,
    0,
  );
});
