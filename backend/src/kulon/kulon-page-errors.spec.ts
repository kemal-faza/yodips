import 'reflect-metadata';
import { KulonService } from './kulon.service';
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

describe('Kulon page transport error classification', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps dead-session assignment detail failures typed', async () => {
    global.fetch = jest.fn().mockResolvedValue(loginRedirectResponse());
    const service = new KulonService();

    await expect(
      internals(service).fetchAssignmentDetail('cookie', 777, 42),
    ).rejects.toBeInstanceOf(StaleUpstreamError);
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
});
