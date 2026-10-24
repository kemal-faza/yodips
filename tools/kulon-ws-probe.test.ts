/** Unit test integrasi CLI probe dengan fetch router palsu (node test runner). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProbe, type ProbeDeps } from './kulon-ws-probe';
import type { FetchLike } from './kulon-ws-http';
import {
  ASSIGN_METHOD,
  COMPLETION_METHOD,
  EVENTS_METHOD,
  QUIZ_METHOD,
  SITE_INFO_METHOD,
  STATE_METHOD,
  SUBMISSION_METHOD,
  TIMELINE_METHOD,
} from './kulon-ws-steps';

function course(id: number): Record<string, unknown> {
  return { id, fullname: 'Kursus ' + id, shortname: 'K' + id, idnumber: String(id) };
}

function routeBatch(entries: Array<{ methodname: string; args: Record<string, unknown> }>): string {
  const results = entries.map((entry) => {
    if (entry.methodname === SITE_INFO_METHOD) return { error: false, data: { userid: 55, username: 'uji' } };
    if (entry.methodname === TIMELINE_METHOD) return { error: false, data: { courses: [course(7)] } };
    if (entry.methodname === ASSIGN_METHOD) {
      return {
        error: false,
        data: { courses: [{ id: 7, assignments: [{ id: 101, cmid: 11, name: 'Tugas', duedate: 1700000000, course: 7 }] }] },
      };
    }
    if (entry.methodname === QUIZ_METHOD) {
      return { error: false, data: { quizzes: [{ id: 5, coursemodule: 21, course: 7, name: 'Kuis' }] } };
    }
    if (entry.methodname === COMPLETION_METHOD) return { error: false, data: { statuses: [] } };
    if (entry.methodname === EVENTS_METHOD) return { error: false, data: { events: [] } };
    if (entry.methodname === SUBMISSION_METHOD) {
      return { error: false, data: { lastattempt: { submission: { status: 'submitted' } } } };
    }
    if (entry.methodname === STATE_METHOD) return { error: false, data: { section: [], cm: [] } };
    return { error: true, errorcode: 'tidak-diharapkan', exception: { message: entry.methodname } };
  });
  return JSON.stringify(results);
}

function router(): FetchLike {
  return (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/my/')) {
      return { status: 200, url, headers: { get: () => null }, text: async () => '<input name="sesskey" value="K1">' } as unknown as Response;
    }
    if (url.includes('/lib/ajax/service.php')) {
      const entries = JSON.parse(String(init?.body ?? '[]')) as Array<{ methodname: string; args: Record<string, unknown> }>;
      return { status: 200, url, headers: { get: () => null }, text: async () => routeBatch(entries) } as unknown as Response;
    }
    if (url.includes('/mod/assign/index.php')) {
      return { status: 200, url, headers: { get: () => null }, text: async () => '<a href="/mod/assign/view.php?id=11">x</a>' } as unknown as Response;
    }
    if (url.includes('/mod/quiz/index.php')) {
      return { status: 200, url, headers: { get: () => null }, text: async () => '<a href="view.php?id=21">x</a>' } as unknown as Response;
    }
    return { status: 404, url, headers: { get: () => null }, text: async () => '' } as unknown as Response;
  }) as FetchLike;
}

function deps(written: Map<string, string>): ProbeDeps {
  let clock = 0;
  return {
    fetchImpl: router(),
    env: { KULON_SESSION_COOKIE: 'MoodleSession=rahasia-sekali' },
    now: () => {
      clock += 50;
      return clock;
    },
    writeFile: (path, content) => {
      written.set(path, content);
    },
    readFile: () => {
      throw new Error('tidak dipakai pada test ini');
    },
  };
}

test('runProbe menulis laporan dan mengembalikan verdict', async () => {
  const written = new Map<string, string>();
  const result = await runProbe(deps(written));
  assert.ok(['PROVISIONAL-GO', 'CONDITIONAL', 'NO-GO'].includes(result.verdict));
  assert.equal(written.size, 3);
  assert.ok(written.has(result.reportPath));
  assert.match(result.reportPath, /kulon-ws\.md$/);
});

test('laporan memuat tabel inventaris 19 baris dan cakupan kursus', async () => {
  const written = new Map<string, string>();
  const result = await runProbe(deps(written));
  assert.match(result.report, /## Inventaris 19 field/);
  assert.equal(result.report.split('\n').filter((line) => /^\| \d+ \| [^|]+ \| (assignment|course) \|/.test(line)).length, 19);
  assert.match(result.report, /Cakupan record/);
  assert.match(result.report, /\| 7 \|/);
});

test('laporan tidak pernah memuat cookie mentah', async () => {
  const written = new Map<string, string>();
  const result = await runProbe(deps(written));
  assert.equal(result.report.includes('MoodleSession'), false);
  for (const content of written.values()) assert.equal(content.includes('rahasia-sekali'), false);
});

test('runProbe melempar bila cookie tidak tersedia', async () => {
  const written = new Map<string, string>();
  const base = deps(written);
  await assert.rejects(() => runProbe({ ...base, env: {} }), /KULON_SESSION_COOKIE/);
});
