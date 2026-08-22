import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';
import { KulonSessionProbe } from './kulon-session-probe';

describe('KulonController', () => {
  let controller: KulonController;
  const service = {
    getCourses: jest.fn(),
    getAssignments: jest.fn(),
    getAssignmentDetail: jest.fn(),
    getCourseContent: jest.fn(),
    parseSesskey: jest.fn(),
  };
  const sessionStore = { get: jest.fn() };
  const req = () => ({ user: { sub: '24060121130000' } });

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<input type="hidden" name="sesskey" value="sesskey123">',
    });
    const module = await Test.createTestingModule({
      controllers: [KulonController],
      providers: [
        { provide: KulonService, useValue: service },
        { provide: SessionStore, useValue: sessionStore },
        KulonSessionProbe,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(KulonController);
  });

  it('returns courses using stored session kulon cookie', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.parseSesskey.mockReturnValue('sesskey123');
    service.getCourses.mockResolvedValue([
      { id: 1, fullname: 'A', shortname: 'A', idnumber: '1' },
    ]);
    const res = await controller.getCourses(req() as any);
    expect(res[0].fullname).toBe('A');
    expect(service.getCourses).toHaveBeenCalledWith(
      'MoodleSession=K',
      'sesskey123',
      '24060121130000',
      undefined,
    );
  });

  it('throws when no kulon session stored', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(controller.getCourses(req() as any)).rejects.toThrow(
      'Kulon session',
    );
  });

  it('returns assignments with stored session', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.parseSesskey.mockReturnValue('sesskey123');
    service.getAssignments.mockResolvedValue([
      { id: 1, name: 'Tugas', duedate: 0, overdue: false, course: 'C' },
    ]);
    const res = await controller.getAssignments(req() as any);
    expect(res[0].name).toBe('Tugas');
  });

  it('throws 401 when no kulon session stored (session expired)', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(controller.getCourses(req() as any)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { message: expect.stringContaining('Kulon session') },
    });
    await expect(controller.getCourses(req() as any)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('throws 401 when Kulon fetch hits redirect loop (expired cookie)', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=STALE' });
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: new Error('redirect count exceeded'),
      }),
    );
    await expect(controller.getCourses(req() as any)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { message: expect.stringContaining('expired') },
    });
  });

  it('returns assignment detail with stored session', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.getAssignmentDetail.mockResolvedValue({
      assignmentId: 42,
      name: 'Tugas',
      descriptionHtml: '<p>x</p>',
      files: [],
      submission: { status: 'graded', grade: 85, maxGrade: 100 },
      kulonUrl: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=777',
    });
    const res = await controller.getAssignmentDetail('42', '777', req() as any);
    expect(res.assignmentId).toBe(42);
    expect(service.getAssignmentDetail).toHaveBeenCalledWith(
      'MoodleSession=K',
      42,
      777,
    );
  });

  it('throws 401 when no kulon session stored for detail', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(
      controller.getAssignmentDetail('42', '777', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('throws 404 when assignment id is invalid', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    await expect(
      controller.getAssignmentDetail('abc', '777', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Detail tugas tidak ditemukan' },
    });
  });

  it('throws 404 when cmid is missing', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    await expect(
      controller.getAssignmentDetail('42', undefined, req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws 404 when cmid is zero or negative (B9)', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    await expect(
      controller.getAssignmentDetail('42', '0', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Detail tugas tidak ditemukan' },
    });
    await expect(
      controller.getAssignmentDetail('42', '-5', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(service.getAssignmentDetail).not.toHaveBeenCalled();
  });

  it('throws 404 when service reports assignment not found', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.getAssignmentDetail.mockRejectedValue(
      new Error('ASSIGNMENT_NOT_FOUND'),
    );
    await expect(
      controller.getAssignmentDetail('42', '777', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Detail tugas tidak ditemukan' },
    });
  });

  it('throws 401 (not 500) when the Kulon page is a login page (no sesskey)', async () => {
    // Stale MoodleSession: /my/ returns 200 with the Moodle login page (no
    // `name="sesskey"` input) or an OIDC redirect landing page. This must
    // surface as a clean 401 so the frontend prompts re-login.
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=STALE' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      url: 'https://kulon2.undip.ac.id/login/index.php',
      text: async () =>
        '<html><form class="login-form"><input name="username"><input name="password"></form></html>',
    });
    service.parseSesskey.mockImplementation(() => {
      throw new Error('sesskey not found in Kulon page');
    });
    await expect(controller.getCourses(req() as any)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { message: expect.stringContaining('login ulang') },
    });
  });

  it('throws 401 (not 500) when /my/ redirects to the Microsoft OIDC login page', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=STALE' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      url: 'https://login.microsoftonline.com/03290435-ff74-45d1-aeaa-173677221cf8/oauth2/authorize?x=1',
      text: async () => '<html>Sign in to your account</html>',
    });
    service.parseSesskey.mockImplementation(() => {
      throw new Error('sesskey not found in Kulon page');
    });
    await expect(controller.getCourses(req() as any)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('returns course content using stored session', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.parseSesskey.mockReturnValue('sesskey123');
    service.getCourseContent.mockResolvedValue({
      courseId: 9,
      sections: [
        {
          id: 1,
          label: 'Pertemuan 1',
          dateRange: '9 February - 15 February',
          items: [],
        },
      ],
    });
    const res = await controller.getCourseContent('9', req() as any);
    expect(res.courseId).toBe(9);
    expect(service.getCourseContent).toHaveBeenCalledWith(
      'MoodleSession=K',
      'sesskey123',
      9,
      '24060121130000',
    );
  });

  it('throws 401 when no kulon session stored for content', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(
      controller.getCourseContent('9', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('throws 404 when course id is invalid', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    await expect(
      controller.getCourseContent('abc', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Mata kuliah tidak ditemukan' },
    });
  });

  it('throws 404 when service reports course not found', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.getCourseContent.mockRejectedValue(new Error('COURSE_NOT_FOUND'));
    await expect(
      controller.getCourseContent('9', req() as any),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Mata kuliah tidak ditemukan' },
    });
  });
});
