import 'reflect-metadata';
import {
  deriveSectionLabel,
  extractCourseCode,
  extractFileType,
  parseAssignmentIndex,
  parseSectionProgress,
  parseSemester,
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

  it('maps a graded row', () => {
    const gradedHtml =
      '<table class="generaltable"><tbody>' +
      '<tr><td class="cell c0">Pertemuan Kedua</td>' +
      '<td class="cell c1"><a href="https://kulon2.undip.ac.id/mod/assign/view.php?id=9999">Tugas Dinilai</a></td>' +
      '<td class="cell c2">Monday, 2 June 2025, 8:00 AM</td>' +
      '<td class="cell c3">Graded</td><td class="cell c4 lastcol">85.00</td></tr>' +
      '</tbody></table>';
    const rows = parseAssignmentIndex(gradedHtml, 9371, 'Struktur Diskret D');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submissionStatus: 'graded', overdue: true });
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

describe('parseSemester', () => {
  it('extracts semester from fullname', () => {
    expect(parseSemester('S1 2025/2026 Genap Keamanan dan Jaminan Informasi B')).toBe('2025/2026 Genap');
  });
  it('returns null when no pattern', () => {
    expect(parseSemester('Pemrograman Berorientasi Objek E')).toBeNull();
  });
  it('falls back to idnumber', () => {
    expect(parseSemester('KJI B', 'MIK1624601 S1 2025/2026 Genap')).toBe('2025/2026 Genap');
  });
  it('handles Ganjil and case-insensitive', () => {
    expect(parseSemester('S1 2024/2025 ganjil Algoritma')).toBe('2024/2025 Ganjil');
  });
});

describe('extractFileType', () => {
  it.each([
    ['https://kulon/pl/pluginfile.php/1.pdf', 'pdf'],
    ['https://kulon/theme/image.php/moove/core/1/f/pdf', 'pdf'],
    ['https://kulon/theme/image.php/moove/core/1/f/vnd.ms-powerpoint', 'pptx'],
    ['https://kulon/theme/image.php/moove/core/1/f/pptx', 'pptx'],
    ['https://kulon/theme/image.php/moove/core/1/f/edit-doc', 'doc'],
    ['https://kulon/mod/resource/view.php?id=5', 'other'],
    ['https://kulon/a/notes.pptx?forcedownload=1', 'pptx'],
    ['https://kulon/x.DOC', 'doc'],
    ['https://kulon/y.xlsx', 'xlsx'],
  ])('%s -> %s', (url, expected) => expect(extractFileType(url)).toBe(expected));
});

describe('deriveSectionLabel', () => {
  it('labels section 0 as General', () => {
    expect(deriveSectionLabel(0, 'General')).toEqual({ label: 'General' });
  });
  it('synthesizes Pertemuan N for a pure date-range title', () => {
    expect(deriveSectionLabel(1, '9 February - 15 February')).toEqual({
      label: 'Pertemuan 1',
      dateRange: '9 February - 15 February',
    });
  });
  it('keeps a custom name without dateRange', () => {
    expect(deriveSectionLabel(2, 'Pertemuan 11')).toEqual({ label: 'Pertemuan 11' });
  });
  it('strips surrounding whitespace', () => {
    expect(deriveSectionLabel(3, '  Bab 4  ')).toEqual({ label: 'Bab 4' });
  });
});

describe('extractCourseCode', () => {
  const RAW = '[SIAP] [55201] [K2024] [Reguler] [MIK1624105] S1 2024/2025 Ganjil Aljabar Linier D';

  it('extracts bracketed MIK-style code from shortname', () => {
    expect(extractCourseCode(RAW, 'S1 2024/2025 Ganjil Aljabar Linier D')).toBe('MIK1624105');
  });
  it('falls back to fullname when shortname has no bracketed code', () => {
    expect(extractCourseCode('CA', 'S1 [MIK1624503] Sistem Informasi')).toBe('MIK1624503');
  });
  it('ignores non-code bracket tokens and passes original shortname through', () => {
    // [SIAP]/[Reguler] letters-only, [55201] digits-only, [K2024] 1-letter+4-digits
    // -> no [A-Z]{2,3}\d{5,} token, so the helper returns the original shortname untouched.
    expect(extractCourseCode('[SIAP] [55201] [K2024] [Reguler] X', '')).toBe('[SIAP] [55201] [K2024] [Reguler] X');
  });
  it('returns original shortname when neither shortname nor fullname has a code', () => {
    expect(extractCourseCode('CA', 'Course A')).toBe('CA');
    expect(extractCourseCode('K', 'Kripto')).toBe('K');
  });
});

describe('parseSectionProgress', () => {
  const section = (label: string, dateRange?: string) => ({ id: 1, label, dateRange, items: [] });
  const now = new Date(2026, 1, 20); // 20 Feb 2026

  it('returns undefined when no dated sections', () => {
    expect(parseSectionProgress([section('General'), section('Bab 1')], now)).toBeUndefined();
  });
  it('counts a dated section as ended when its end date has passed', () => {
    expect(parseSectionProgress([section('P1', '1 February - 8 February')], now)).toBe(100);
  });
  it('does not count a dated section that has not ended yet', () => {
    expect(parseSectionProgress([section('P1', '15 March - 22 March')], now)).toBe(0);
  });
  it('computes a partial ratio (1 of 2 ended = 50)', () => {
    expect(parseSectionProgress([
      section('P1', '1 February - 5 February'),
      section('P2', '1 March - 5 March'),
    ], now)).toBe(50);
  });
  it('ignores sections with unparseable dateRange and uses only parseable ones', () => {
    expect(parseSectionProgress([
      section('P1', '1 February - 5 February'),
      section('P2', 'weird'),
    ], now)).toBe(100);
  });
  it('returns 100 for a PAST course even when its end-date month is ahead of now (year inference fails for past semesters)', () => {
    // A past-semester course (ended Dec 2024) whose section end month is "December":
    // with now = 20 Feb 2026, the old year-inference checked Dec 2026 & Dec 2027 (both
    // future) and misclassified it as not-ended -> 0%. A past course must be 100%.
    expect(parseSectionProgress(
      [section('P1', '1 December - 15 December')],
      now,
      { isPast: true },
    )).toBe(100);
  });
  it('keeps inprogress logic when isPast is false (a not-yet-ended section stays 0)', () => {
    expect(parseSectionProgress(
      [section('P1', '15 March - 22 March')],
      now,
      { isPast: false },
    )).toBe(0);
  });
});
