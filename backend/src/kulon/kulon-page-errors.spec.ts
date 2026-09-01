import 'reflect-metadata';
import { isKulonPageCompatibilityError, KulonService } from './kulon.service';
import { StaleUpstreamError } from '../upstream/upstream-fetch';
import type {
  KulonAssignment,
  KulonAssignmentDetail,
  KulonCourse,
  KulonCourseContent,
} from './kulon-parse';

type KulonServiceInternals = {
  fetchAssignmentDetail: (
    cookie: string,
    cmid: number,
    assignmentId: number,
  ) => Promise<KulonAssignmentDetail>;
  contentFromHTML: (
    cookie: string,
    courseId: number,
  ) => Promise<KulonCourseContent>;
  fetchCourses: (
    cookie: string,
    sesskey: string,
    sub?: string,
    opts?: { withLecturers?: boolean; withProgress?: boolean },
  ) => Promise<KulonCourse[]>;
  fetchAllAssignments: (
    cookie: string,
    sesskey: string,
    sub?: string,
  ) => Promise<KulonAssignment[]>;
};

function internals(service: KulonService): KulonServiceInternals {
  return service as unknown as KulonServiceInternals;
}

function loginRedirectResponse() {
  return {
    ok: true,
    status: 200,
    url: 'https://kulon2.undip.ac.id/login/index.php',
    text: () => Promise.resolve('<html>login</html>'),
  } as unknown as Response;
}

function loginPageHtml(): string {
  return '<html><body id="page-login-index"><form id="login" action="/login/index.php"><input name="username"></form></body></html>';
}

describe('Kulon page transport error classification', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps dead-session assignment detail failures typed', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginRedirectResponse());
    const service = new KulonService();

    await expect(
      internals(service).fetchAssignmentDetail('cookie', 777, 42),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
  });

  it('classifies a 2xx login page body as a typed dead-session error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // The redirect target can remain the requested page when an upstream
      // proxy serves its login HTML with a successful status.
      url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
      text: () => Promise.resolve(loginPageHtml()),
    });
    const service = new KulonService();

    await expect(
      internals(service).fetchAssignmentDetail('cookie', 777, 42),
    ).rejects.toMatchObject({ reason: 'login-redirect', status: 401 });
  });

  it('keeps dead-session failures visible through assignment aggregation', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginRedirectResponse());
    const service = new KulonService();
    jest.spyOn(internals(service), 'fetchCourses').mockResolvedValue([
      {
        id: 9371,
        fullname: 'Course',
        shortname: 'C',
        idnumber: '',
        timelineStatus: 'past',
      },
    ]);

    await expect(
      internals(service).fetchAllAssignments('cookie', 'sesskey'),
    ).rejects.toMatchObject({ reason: 'login-redirect', status: 401 });
  });

  it('maps transient page failures to typed gateway errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      url: 'https://kulon2.undip.ac.id/course/view.php?id=9371',
    });
    const service = new KulonService();

    await expect(
      internals(service).contentFromHTML('cookie', 9371),
    ).rejects.toMatchObject({ reason: 'http-not-ok', status: 502 });
  });

  it('keeps transient assignment-index failures visible through aggregation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      url: 'https://kulon2.undip.ac.id/mod/assign/index.php?id=9371',
    });
    const service = new KulonService();
    jest.spyOn(internals(service), 'fetchCourses').mockResolvedValue([
      {
        id: 9371,
        fullname: 'Course',
        shortname: 'C',
        idnumber: '',
        timelineStatus: 'past',
      },
    ]);

    await expect(
      internals(service).fetchAllAssignments('cookie', 'sesskey'),
    ).rejects.toMatchObject({ reason: 'http-not-ok', status: 502 });
  });

  it.each([
    [404, 'COURSE_NOT_FOUND'],
    [302, 'Kulon page failed: 302'],
  ])('marks page compatibility error without changing its plain Error shape (%i)', async (status, message) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status,
      url: 'https://kulon2.undip.ac.id/course/view.php?id=9371',
    });
    const service = new KulonService();

    const error = await internals(service)
      .contentFromHTML('cookie', 9371)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(message);
    expect(error).not.toBeInstanceOf(StaleUpstreamError);
    expect(isKulonPageCompatibilityError(error)).toBe(true);
  });

  it('emits one timed stale event for a login HTML page', async () => {
    const events: unknown[] = [];
    let now = 0n;
    const runtime = {
      sink: { record: (event: unknown) => events.push(event) },
      wallNowMs: () => 0,
      monotonicNowNs: () => {
        now += 1_000_000n;
        return now;
      },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
      text: () => Promise.resolve(loginPageHtml()),
    });
    const service = new KulonService(undefined, undefined, undefined, undefined, runtime as any);

    await expect(
      internals(service).fetchAssignmentDetail('cookie', 777, 42),
    ).rejects.toMatchObject({ reason: 'login-redirect', status: 401 });
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'assignment_detail',
        route: 'GET /mod/assign/view.php',
        outcome: 'stale',
        reason: 'login-redirect',
      }),
    ]);
  });
});
