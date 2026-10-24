/** Uji node:test murni untuk pembanding progress timeline vs jalur produksi (tanpa jaringan). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KULON_BASE_URL, type FetchLike } from './kulon-ws-http';
import { compareProgress, runCompare, type ComparisonInput } from './kulon-progress-compare';

function inputRow(
  courseId: number,
  timelineStatus: 'inprogress' | 'past',
  timelineProgress: number | null,
  productionProgress: number | undefined,
  source: 'state' | 'html' | 'error',
): ComparisonInput {
  return {
    courseId,
    timelineStatus,
    timelineProgress,
    productionProgress,
    source,
    hasProgress: timelineProgress !== null,
  };
}

test('compareProgress mengklasifikasikan tujuh kasus dan memecah ringkasan per timelineStatus', () => {
  const result = compareProgress([
    inputRow(7, 'past', 40, 100, 'state'),
    inputRow(3, 'inprogress', 40, 60, 'state'),
    inputRow(1, 'inprogress', 100, 100, 'state'),
    inputRow(4, 'inprogress', null, 25, 'state'),
    inputRow(5, 'inprogress', 75, undefined, 'state'),
    inputRow(6, 'past', null, undefined, 'state'),
    inputRow(9, 'past', 90, undefined, 'error'),
    inputRow(2, 'past', 100, 100, 'state'),
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

test('runCompare memakai parser produksi, fallback HTML, dan menulis satu artefak tanpa cookie', async () => {
  const cookie = 'MoodleSession=uji-rahasia';
  const stateReplies: Record<string, unknown> = {
    7: { error: false, data: { section: [{ number: 1, title: '9 February - 15 February' }], cm: [] } },
    9: {
      error: false,
      data: {
        section: [
          { number: 1, title: '1 February - 5 February' },
          { number: 2, title: '1 March - 5 March' },
        ],
        cm: [],
      },
    },
    11: '<html>bukan state json</html>',
  };
  const htmlPage =
    '<ul><li id="section-0" data-sectionname="General"></li>' +
    '<li id="section-1" data-sectionname="1 February - 5 February"></li></ul>';
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
            { error: false, data: { courses: [timelineCourse(7, 100), timelineCourse(9, 40)] } },
            {
              error: false,
              data: { courses: [timelineCourse(7, 100), timelineCourse(9, 40), timelineCourse(11, 40)] },
            },
            { error: false, data: { courses: [] } },
          ]),
        });
      }
      assert.equal(entries.length, 1);
      assert.equal(entries[0].index, 0);
      assert.equal(entries[0].methodname, 'core_courseformat_get_state');
      const courseId = String(entries[0].args.courseid);
      assert.ok(courseId === '7' || courseId === '9' || courseId === '11');
      return fakeResponse(url, { body: JSON.stringify([stateReplies[courseId]]) });
    }
    if (url === KULON_BASE_URL + '/course/view.php?id=11') {
      return fakeResponse(url, { body: htmlPage });
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

  assert.equal(result.summary.total, 3);
  assert.deepEqual(result.summary.counts, {
    equal: 1,
    'past-coerced': 1,
    differ: 1,
    'timeline-missing': 0,
    'production-missing': 0,
    'both-missing': 0,
    'scrape-error': 0,
  });
  assert.deepEqual(result.summary.byStatus.inprogress, {
    equal: 1,
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

  assert.ok(result.report.includes('| 7 | inprogress | 100 | 100 | state | equal |'));
  assert.ok(result.report.includes('| 9 | inprogress | 40 | 50 | state | differ |'));
  assert.ok(result.report.includes('| 11 | past | 40 | 100 | html | past-coerced |'));

  assert.equal(calls.length, 6);
  assert.equal(
    calls.filter((call) => call.url === KULON_BASE_URL + '/course/view.php?id=11').length,
    1,
  );
});
