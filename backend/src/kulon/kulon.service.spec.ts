import 'reflect-metadata';
import { KulonService } from './kulon.service';

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

  it('fetches assignment detail from page and submission status', async () => {
    const pageHtml =
      '<header id="page-header"><div class="page-context-header"><h1>Tugas Kelompok I</h1></div></header><div class="activity-description" id="intro"><div class="box py-3 generalbox boxaligncenter"><div class="no-overflow"><p>Kerjakan laporan kelompok.</p></div></div></div><div class="fileuploadsubmission"><a target="_blank" href="https://kulon2.undip.ac.id/pluginfile.php/498185/assignsubmission_file/submission_files/659669/laporan.pdf">laporan.pdf</a></div>';
    const submissionPayload = {
      status: 'submitted',
      lastattempt: {
        submission: { timemodified: 1742000000 },
        submissionstatus: 'submitted',
        graded: true,
      },
      feedback: { grade: { grade: '85.0', maxmark: 100 } },
    };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => pageHtml,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: false, data: submissionPayload }],
      });
    const detail = await svc.getAssignmentDetail(
      'session-cookie',
      'sesskey',
      42,
      777,
    );
    expect(detail.assignmentId).toBe(42);
    expect(detail.name).toBe('Tugas Kelompok I');
    expect(detail.descriptionHtml).toContain('Kerjakan laporan kelompok.');
    expect(detail.files[0].name).toBe('laporan.pdf');
    expect(detail.files[0].url).toContain('/pluginfile.php/498185/');
    expect(detail.submission.status).toBe('graded');
    expect(detail.submission.grade).toBe(85);
    expect(detail.submission.maxGrade).toBe(100);
    expect(detail.submission.submittedAt).toBe(1742000000);
    expect(detail.kulonUrl).toContain('view.php?id=777');
  });

  it('returns not_submitted when ajax submission data is empty', async () => {
    const pageHtml =
      '<header id="page-header"><h1>Task</h1></header><div id="intro"><div class="no-overflow"></div></div>';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => pageHtml })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: false, data: {} }],
      });
    const detail = await svc.getAssignmentDetail(
      'session-cookie',
      'sesskey',
      42,
      777,
    );
    expect(detail.name).toBe('Task');
    expect(detail.descriptionHtml).toBe('');
    expect(detail.submission.status).toBe('not_submitted');
    expect(detail.submission.grade).toBeNull();
    expect(detail.submission.maxGrade).toBeNull();
  });

  it('throws ASSIGNMENT_NOT_FOUND when page responds 404', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
    });
    await expect(
      svc.getAssignmentDetail('session-cookie', 'sesskey', 42, 777),
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
  });
});