import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

describe('KulonController', () => {
  let controller: KulonController;
  const service = {
    getCourses: jest.fn(),
    getAssignments: jest.fn(),
    getAssignmentDetail: jest.fn(),
    parseSesskey: jest.fn(),
  };
  const sessionStore = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '<input type="hidden" name="sesskey" value="sesskey123">',
    });
    const module = await Test.createTestingModule({
      controllers: [KulonController],
      providers: [
        { provide: KulonService, useValue: service },
        { provide: SessionStore, useValue: sessionStore },
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
    const res = await controller.getCourses();
    expect(res[0].fullname).toBe('A');
    expect(service.getCourses).toHaveBeenCalledWith('MoodleSession=K', 'sesskey123');
  });

  it('throws when no kulon session stored', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(controller.getCourses()).rejects.toThrow('Kulon session');
  });

  it('returns assignments with stored session', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.parseSesskey.mockReturnValue('sesskey123');
    service.getAssignments.mockResolvedValue([
      { id: 1, name: 'Tugas', duedate: 0, overdue: false, course: 'C' },
    ]);
    const res = await controller.getAssignments();
    expect(res[0].name).toBe('Tugas');
  });

  it('throws 401 when no kulon session stored (session expired)', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(controller.getCourses()).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { message: expect.stringContaining('Kulon session') },
    });
    await expect(controller.getCourses()).rejects.toBeInstanceOf(HttpException);
  });

  it('throws 401 when Kulon fetch hits redirect loop (expired cookie)', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=STALE' });
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: new Error('redirect count exceeded') }),
    );
    await expect(controller.getCourses()).rejects.toMatchObject({
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
    const res = await controller.getAssignmentDetail('42', '777');
    expect(res.assignmentId).toBe(42);
    expect(service.getAssignmentDetail).toHaveBeenCalledWith(
      'MoodleSession=K',
      'sesskey123',
      42,
      777,
    );
  });

  it('throws 401 when no kulon session stored for detail', async () => {
    sessionStore.get.mockReturnValue(null);
    await expect(controller.getAssignmentDetail('42', '777')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('throws 404 when assignment id is invalid', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    await expect(controller.getAssignmentDetail('abc', '777')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Detail tugas tidak ditemukan' },
    });
  });

  it('throws 404 when cmid is missing', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    await expect(controller.getAssignmentDetail('42', undefined)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws 404 when service reports assignment not found', async () => {
    sessionStore.get.mockReturnValue({ kulonCookie: 'MoodleSession=K' });
    service.getAssignmentDetail.mockRejectedValue(new Error('ASSIGNMENT_NOT_FOUND'));
    await expect(controller.getAssignmentDetail('42', '777')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { message: 'Detail tugas tidak ditemukan' },
    });
  });
});