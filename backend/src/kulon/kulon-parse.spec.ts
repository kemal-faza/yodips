import 'reflect-metadata';
import {
  extractFileType,
  parseAssignmentIndex,
  parseMoodleDate,
  parseSectionProgress,
  parseSubmissionFromHtml,
} from './kulon-parse';

describe('parseAssignmentIndex', () => {
  const indexHtml =
    '<table class="generaltable"><tbody>' +
    '<tr><td class="cell c0">Pertemuan Kedua</td>' +
    '<td class="cell c1"><a href="https://kulon2.undip.ac.id/mod/assign/view.php?id=3317">Tugas Kelompok I. Galat</a></td>' +
    '<td class="cell c2">Tuesday, 18 March 2025, 12:00 AM</td>' +
    '<td class="cell c3">No submission</td><td class="cell c4 lastcol">-</td></tr>' +
    '<tr><td class="cell c1"><a href="/mod/assign/view.php?id=3342">Tugas Individu</a></td>' +
    '<td class="cell c2">Thursday, 7 May 2027, 11:50 PM</td>' +
    '<td class="cell c3">Submitted for grading</td></tr>' +
    '</tbody></table>';

  it('maps each linked row into an assignment with due/submission data', () => {
    const rows = parseAssignmentIndex(indexHtml, 9371, 'Struktur Diskret D');
    expect(rows).toHaveLength(2);
    const [notSub, submitted] = rows;
    expect(notSub).toMatchObject({
      name: 'Tugas Kelompok I. Galat',
      courseModuleId: 3317,
      assignmentId: 3317,
      courseId: 9371,
      course: 'Struktur Diskret D',
      submissionStatus: 'not_submitted',
      overdue: true, // March 2025 < now
    });
    expect(submitted.submissionStatus).toBe('submitted');
    expect(submitted.overdue).toBe(false); // May 2027 future
  });

  it('returns empty when page has no assignment table', () => {
    expect(parseAssignmentIndex('<html>no table</html>', 1, 'C')).toEqual([]);
  });
});

describe('parseSubmissionFromHtml', () => {
  it('parses a graded submission with the "85.00 / 100.00" grade pair', () => {
    const html = `
      <div class="submissionstatustable"><table>
        <tr><th>Submission status</th><td>Submitted for grading</td></tr>
        <tr><th>Grading status</th><td>Graded</td></tr>
        <tr><th>Last modified</th><td>Thursday, 7 May 2026, 11:50 PM</td></tr>
        <tr><th>Grade</th><td>85.00 / 100.00</td></tr>
      </table></div>`;
    const out = parseSubmissionFromHtml(html);
    expect(out.status).toBe('graded');
    expect(out.grade).toBe(85);
    expect(out.maxGrade).toBe(100);
    // Moodle timestamps render in WIB (UTC+7): 2026-05-07 23:50 WIB -> epoch sec
    expect(out.submittedAt).toBe(1778172600);
  });

  it('falls back to unknown when the summary table is absent', () => {
    expect(parseSubmissionFromHtml('<html>nothing</html>')).toEqual({
      status: 'unknown',
      grade: null,
      maxGrade: null,
    });
  });
});

describe('extractFileType', () => {
  it.each([
    ['https://k/theme/image.php/moove/core/1/f/pdf', 'pdf'],
    ['https://k/theme/image.php/moove/core/1/f/vnd.ms-powerpoint', 'pptx'],
    ['https://k/a/notes.pptx?forcedownload=1', 'pptx'],
    ['https://k/mod/resource/view.php?id=5', 'other'],
  ])('%s -> %s', (input, expected) =>
    expect(extractFileType(input)).toBe(expected),
  );
});

describe('parseSectionProgress', () => {
  const section = (label: string, dateRange?: string) => ({
    id: 1,
    label,
    dateRange,
    items: [],
  });
  const now = new Date(2026, 1, 20); // 20 Feb 2026

  it('computes a partial ratio across dated sections', () => {
    expect(
      parseSectionProgress(
        [section('P1', '1 February - 5 February'), section('P2', 'weird')],
        now,
      ),
    ).toBe(100);
  });

  it('reports 100 for a past course regardless of month inference', () => {
    expect(
      parseSectionProgress(
        [section('P1', '1 December - 15 December')],
        now,
        { isPast: true },
      ),
    ).toBe(100);
  });
});
