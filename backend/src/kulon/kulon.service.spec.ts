import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import {
  KulonService,
  parseSemester,
  extractFileType,
  deriveSectionLabel,
} from './kulon.service';

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



describe('getCourseContent (HTML fixture)', () => {
  it('parses real Kulon HTML into sections/items', async () => {
    const svc = new KulonService();
    const html = fs.readFileSync(
      path.join(__dirname, '../../test/fixtures/kulon/course-content-html.html'),
      'utf8',
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/course/view.php?id=16294',
      text: async () => html,
    }) as any;
    const content = await svc.getCourseContent('cookie', 'sk', 16294);
    expect(content.courseId).toBe(16294);
    // Section 0 = General (forum Announcements).
    const gen = content.sections.find((s) => s.id === 0);
    expect(gen?.label).toBe('General');
    expect(gen?.items[0]?.kind).toBe('forum');
    // Section 1: title date-range -> Pertemuan 1 + dateRange; file pdf.
    const s1 = content.sections.find((s) => s.id === 1);
    expect(s1?.label).toBe('Pertemuan 1');
    expect(s1?.dateRange).toBe('9 February - 15 February');
    const fileItem = s1?.items.find((i) => i.kind === 'file');
    expect(fileItem?.fileType).toBe('pdf');
    expect(fileItem?.name).toBe('0. Peraturan Perkuliahan');
    // Section 12: file + assign (assign ter-bucket benar meski di luar block regex).
    const s12 = content.sections.find((s) => s.id === 12);
    const assignItem = s12?.items.find((i) => i.kind === 'assign');
    expect(assignItem?.kind).toBe('assign');
    expect(assignItem?.name).toBe('Tugas Kriptografi');
    expect(s12?.items.every((i) => i.kind === 'file' || i.kind === 'assign')).toBe(true);
    // Section 13: custom name "Pertemuan 11" dipertahankan (bukan synthesize ulang).
    const s13 = content.sections.find((s) => s.id === 13);
    expect(s13?.label).toBe('Pertemuan 11');
  });
});

describe('KulonService', () => {
  let svc: KulonService;
  beforeEach(() => {
    svc = new KulonService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('gets courses from timeline classification endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            courses: [
              { id: 1, fullname: 'Course A', shortname: 'CA', idnumber: '1' },
            ],
          },
        },
      ],
    });
    const courses = await svc.getCourses('session-cookie', 'sesskey');
    expect(courses[0].fullname).toBe('Course A');
    expect(courses[0].id).toBe(1);
  });

  it('gets assignments with deadlines from calendar endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                course: { id: 9371, fullname: 'Metode Numerik D' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('session-cookie', 'sesskey');
    expect(assignments[0].name).toBe('Tugas Kelompok I');
    expect(assignments[0].duedate).toBe(1742230800);
    expect(assignments[0].course).toBe('Metode Numerik D');
    expect(assignments[0].overdue).toBe(true);
  });

  it('extracts sesskey from page html', async () => {
    const html = `<form><input type="hidden" name="sesskey" value="abc123XYZ"></form>`;
    const key = svc.parseSesskey(html);
    expect(key).toBe('abc123XYZ');
  });

  it('maps assignmentId and courseModuleId into assignments list', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                instance: 42,
                url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
                course: { id: 9371, fullname: 'C' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('session-cookie', 'sesskey');
    expect(assignments[0].assignmentId).toBe(42);
    expect(assignments[0].courseModuleId).toBe(777);
  });

  it('derives courseModuleId from the event url (no extra AJAX call)', async () => {
    // Real Kulon events carry NO cmid field; the page id lives in event.url.
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                instance: 42,
                url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=3335',
                course: { id: 9371, fullname: 'C' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('session-cookie', 'sesskey');
    expect(assignments[0].courseModuleId).toBe(3335);
    // Exactly one fetch: the calendar AJAX. No course-module lookup call.
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('returns courseModuleId 0 when event url does not match an assign page', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Quiz A',
                modulename: 'quiz',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: false,
                instance: 9,
                url: 'https://kulon2.undip.ac.id/mod/quiz/view.php?id=9',
                course: { id: 9371, fullname: 'C' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('session-cookie', 'sesskey');
    expect(assignments[0].courseModuleId).toBe(0);
  });

  it('fetches assignment detail and parses a graded submission from HTML', async () => {
    const pageHtml =
      '<header id="page-header"><div class="page-context-header"><h1>Tugas Kelompok I</h1></div></header>' +
      '<div class="activity-description" id="intro"><div class="box py-3 generalbox boxaligncenter"><div class="no-overflow"><p>Kerjakan laporan kelompok.</p></div></div></div>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr><th class="cell c0" scope="row">Submission status</th><td class="submissionstatussubmitted cell c1 lastcol">Submitted for grading</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grading status</th><td class="submissiongraded cell c1 lastcol">Graded</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grade</th><td class="cell c1 lastcol">85.00 / 100.00</td></tr>' +
      '<tr><th class="cell c0" scope="row">Last modified</th><td class="cell c1 lastcol">Thursday, 7 May 2026, 11:50 PM</td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('session-cookie', 42, 777);
    expect(detail.assignmentId).toBe(42);
    expect(detail.name).toBe('Tugas Kelompok I');
    expect(detail.descriptionHtml).toContain('Kerjakan laporan kelompok.');
    expect(detail.submission.status).toBe('graded');
    expect(detail.submission.grade).toBe(85);
    expect(detail.submission.maxGrade).toBe(100);
    expect(detail.submission.submittedAt).toBe(
      Math.floor(new Date(2026, 4, 7, 23, 50).getTime() / 1000),
    );
    expect(detail.kulonUrl).toContain('view.php?id=777');
  });

  it('parses submitted + not graded submission (verified live shape)', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr><th class="cell c0" scope="row">Submission status</th><td class="submissionstatussubmitted cell c1 lastcol">Submitted for grading</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grading status</th><td class="submissionnotgraded cell c1 lastcol">Not graded</td></tr>' +
      '<tr><th class="cell c0" scope="row">Last modified</th><td class="cell c1 lastcol">Thursday, 7 May 2026, 11:50 PM</td></tr>' +
      '<tr><th class="cell c0" scope="row">File submissions</th><td class="cell c1 lastcol"><div class="fileuploadsubmission"><a href="https://kulon2.undip.ac.id/pluginfile.php/484704/assignsubmission_file/submission_files/595020/x.pdf">x.pdf</a></div></td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('session-cookie', 42, 777);
    expect(detail.submission.status).toBe('submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
    expect(detail.submission.submittedAt).toBe(
      Math.floor(new Date(2026, 4, 7, 23, 50).getTime() / 1000),
    );
    expect(detail.files.some((f) => f.name === 'x.pdf')).toBe(true);
  });

  it('returns not_submitted when submission status says not submitted', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header>' +
      '<div class="activity-description" id="intro"><div class="no-overflow"></div></div>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr><th class="cell c0" scope="row">Submission status</th><td class="submissionstatusnotsubmitted cell c1 lastcol">Not submitted</td></tr>' +
      '<tr><th class="cell c0" scope="row">Grading status</th><td class="submissionnotgraded cell c1 lastcol">Not graded</td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('session-cookie', 42, 777);
    expect(detail.name).toBe('Task');
    expect(detail.descriptionHtml).toBe('');
    expect(detail.submission.status).toBe('not_submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
    expect(detail.submission.submittedAt).toBeUndefined();
  });

  it('returns not_submitted for real Moodle phrasing "No submissions have been made yet"', async () => {
    // Verified live: Moodle renders not-submitted WITHOUT a status class on the
    // td and with the text "No submissions have been made yet" (not "Not submitted").
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header>' +
      '<div class="submissionstatustable"><h3>Submission status</h3><div class="box py-3 boxaligncenter submissionsummarytable">' +
      '<div class="table-responsive"><table class="generaltable table-bordered"><tbody>' +
      '<tr class=""><th class="cell c0" style="" scope="row">Submission status</th><td class="cell c1 lastcol" style="">No submissions have been made yet</td></tr>' +
      '<tr class=""><th class="cell c0" style="" scope="row">Grading status</th><td class="submissionnotgraded cell c1 lastcol" style="">Not graded</td></tr>' +
      '<tr class=""><th class="cell c0" style="" scope="row">Last modified</th><td class="cell c1 lastcol" style="">-</td></tr>' +
      '</tbody></table></div></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('session-cookie', 42, 777);
    expect(detail.submission.status).toBe('not_submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
    expect(detail.submission.submittedAt).toBeUndefined();
  });

  it('returns unknown submission when page has no submissionstatustable', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header><div id="intro"><div class="no-overflow"></div></div>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => pageHtml,
    });
    const detail = await svc.getAssignmentDetail('session-cookie', 42, 777);
    expect(detail.submission.status).toBe('unknown');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
  });

  it('throws ASSIGNMENT_NOT_FOUND when page responds 404', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
    });
    await expect(
      svc.getAssignmentDetail('session-cookie', 42, 777),
    ).rejects.toThrow('ASSIGNMENT_NOT_FOUND');
  });

  describe('checkSessionValid', () => {
    it('returns valid ok when /my/ has a sesskey', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://kulon2.undip.ac.id/my/',
        text: async () => '<input type="hidden" name="sesskey" value="abc">',
      });
      const res = await svc.checkSessionValid('MoodleSession=K');
      expect(res).toEqual({ valid: true, reason: 'ok' });
    });

    it('returns no-cookie when cookie is empty', async () => {
      const res = await svc.checkSessionValid('');
      expect(res).toEqual({ valid: false, reason: 'no-cookie' });
    });

    it('returns stale when final URL is a login page', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://kulon2.undip.ac.id/login/index.php',
        text: async () => '<html>login</html>',
      });
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when redirecting to microsoft login', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://login.microsoftonline.com/...',
        text: async () => '<html>sign in</html>',
      });
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when fetch fails (redirect loop)', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: new Error('redirect count exceeded') }),
      );
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });

    it('returns stale when page has no sesskey', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://kulon2.undip.ac.id/my/',
        text: async () => '<html>no sesskey here</html>',
      });
      const res = await svc.checkSessionValid('MoodleSession=STALE');
      expect(res).toEqual({ valid: false, reason: 'stale' });
    });
  });

  describe('getSessionIdentity', () => {
    it('returns the username (NIM) from core_webservice_get_site_info', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: false, data: { username: '24060121130000' } }],
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBe('24060121130000');
    });

    it('returns null when /my/ has no sesskey (stale session)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        url: 'https://kulon2.undip.ac.id/my/',
        text: async () => '<html>login page</html>',
      });
      const id = await svc.getSessionIdentity('MoodleSession=STALE');
      expect(id).toBeNull();
    });

    it('returns null when session cookie is empty', async () => {
      const id = await svc.getSessionIdentity('');
      expect(id).toBeNull();
    });

    it('returns null when the ajax call errors', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockRejectedValueOnce(new Error('network'));
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBeNull();
    });

    it('falls back to scraping NIM from /user/profile.php when site_info is disabled', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: true, exception: { message: "Web service is not available. (It doesn't exist or might be disabled.)" } }],
        })
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/user/profile.php',
          text: async () => '<head><title>Anonim Uji 24060121130000: Public profile</title></head>',
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBe('24060121130000');
    });

    it('returns null when profile page has no NIM in title', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/my/',
          text: async () => '<input type="hidden" name="sesskey" value="sess123">',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ error: true, exception: { message: 'disabled' } }],
        })
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://kulon2.undip.ac.id/user/profile.php',
          text: async () => '<head><title>Public profile</title></head>',
        });
      const id = await svc.getSessionIdentity('MoodleSession=K');
      expect(id).toBeNull();
    });
  });
});