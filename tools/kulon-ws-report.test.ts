/** Unit test murni untuk kulon-ws-report (node test runner). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CoverageRow, InventoryRow } from './kulon-ws-verdict';
import { renderReport, type ReportInput } from './kulon-ws-report';

function inventory(): InventoryRow[] {
  return Array.from({ length: 19 }, (_, index) => ({
    no: index + 1,
    field: 'field' + (index + 1),
    object: index < 11 ? ('assignment' as const) : ('course' as const),
    status: 'ws' as const,
    evidence: 'bukti',
  }));
}

function coverage(courseId: number): CoverageRow {
  return {
    courseId,
    assignHtml: 1,
    assignWs: 1,
    assignOnlyHtml: [],
    assignOnlyWs: [],
    quizHtml: 1,
    quizWs: 1,
    quizOnlyHtml: [],
    quizOnlyWs: [],
  };
}

function baseInput(): ReportInput {
  return {
    generatedAt: '2026-10-24T10:00:00.000Z',
    n: 30,
    timelineShape: 'positional',
    hasProgress: false,
    extraKeys: ['id', 'fullname'],
    diagnostics: [
      { methodname: 'mod_assign_get_assignments', error: false, errorcode: null, message: null },
      { methodname: 'core_webservice_get_site_info', error: true, errorcode: 'accessexception', message: 'ditolak' },
    ],
    spotCheck: [{ courseId: 9371, cmid: 11, name: 'Tugas', duedate: '1700000000' }],
    inventory: inventory(),
    coverage: [coverage(9371)],
    verdict: 'PROVISIONAL-GO',
    reasons: ['semua syarat terpenuhi'],
    pair1Ms: 3100,
    pair2Ms: 2900,
    baseline1Ms: 7164,
    baseline2Ms: 9000,
    posts: { timeline: 1, assignments: 1, submissionStatus: 1, progress: 1 },
    token: null,
    limitations: ['kesetaraan nilai belum dibuktikan'],
  };
}

test('renderReport memuat verdict dan alasan', () => {
  const report = renderReport(baseInput());
  assert.match(report, /PROVISIONAL-GO/);
  assert.match(report, /semua syarat terpenuhi/);
});

test('renderReport memuat tabel inventaris 19 baris', () => {
  const report = renderReport(baseInput());
  assert.equal(report.split('\n').filter((line) => /^\| \d+ \| [^|]+ \| (assignment|course) \|/.test(line)).length, 19);
});

test('renderReport memuat tabel cakupan per kursus', () => {
  const report = renderReport(baseInput());
  assert.match(report, /9371/);
  assert.match(report, /Cakupan record/);
});

test('renderReport mencantumkan diagnostik yang error beserta errorcode', () => {
  const report = renderReport(baseInput());
  assert.match(report, /accessexception/);
});

test('renderReport tidak pernah memuat string cookie mentah', () => {
  const input = baseInput();
  input.diagnostics.push({
    methodname: 'mod_assign_get_assignments',
    error: true,
    errorcode: 'sesskey',
    message: 'MoodleSession=rahasia-sekali',
  });
  const report = renderReport(input);
  assert.equal(report.includes('MoodleSession'), false);
});
