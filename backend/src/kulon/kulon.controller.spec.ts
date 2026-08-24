import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * After the upstream-session consolidation the controller is a thin router:
 * it resolves nothing but `sub`, validates path/query input, and maps the
 * service's domain errors (ASSIGNMENT_NOT_FOUND / COURSE_NOT_FOUND) to 404s.
 * Session/stale behaviour lives in kulon.service + kulon-upstream specs.
 */
describe('KulonController', () => {
  let controller: KulonController;
  const service = {
    getCourses: jest.fn(),
    getAssignments: jest.fn(),
    getAllAssignments: jest.fn(),
    getAssignmentDetail: jest.fn(),
    getCourseContent: jest.fn(),
    parseSesskey: jest.fn(),
  };
  const req = () => ({ user: { sub: '24060121130000' } });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [KulonController],
      providers: [{ provide: KulonService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(KulonController);
  });

  it('routes courses by sub only (no cookies cross this layer)', async () => {
    service.getCourses.mockResolvedValue([
      { id: 1, fullname: 'A', shortname: 'A', idnumber: '1' },
    ]);
    const res = await controller.getCourses(req() as any);
    expect(res[0].fullname).toBe('A');
    expect(service.getCourses).toHaveBeenCalledWith('24060121130000');
  });

  it('routes assignments aggregation by sub', async () => {
    service.getAllAssignments.mockResolvedValue([]);
    await expect(controller.getAllAssignments(req() as any)).resolves.toEqual(
      [],
    );
    expect(service.getAllAssignments).toHaveBeenCalledWith('24060121130000');
  });

  it('throws 404 when assignment id is invalid', async () => {
    await expect(
      controller.getAssignmentDetail('bukan-angka', '123', req() as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(service.getAssignmentDetail).not.toHaveBeenCalled();
  });

  it('throws 404 when cmid is missing or non-positive', async () => {
    await expect(
      controller.getAssignmentDetail('10', '', req() as any),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.getAssignmentDetail('10', '-3', req() as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('maps ASSIGNMENT_NOT_FOUND to a 404', async () => {
    service.getAssignmentDetail.mockRejectedValue(
      new Error('ASSIGNMENT_NOT_FOUND'),
    );
    await expect(
      controller.getAssignmentDetail('10', '20', req() as any),
    ).rejects.toBeInstanceOf(HttpException);
    expect(service.getAssignmentDetail).toHaveBeenCalledWith(
      '24060121130000',
      10,
      20,
    );
  });

  it('rethrows unknown assignment-detail errors untouched', async () => {
    service.getAssignmentDetail.mockRejectedValue(new Error('boom'));
    await expect(
      controller.getAssignmentDetail('10', '20', req() as any),
    ).rejects.toThrow('boom');
  });

  it('throws 404 when course id is invalid for content', async () => {
    await expect(
      controller.getCourseContent('nol', req() as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(service.getCourseContent).not.toHaveBeenCalled();
  });

  it('maps COURSE_NOT_FOUND to a 404 and routes content by sub', async () => {
    service.getCourseContent.mockRejectedValue(new Error('COURSE_NOT_FOUND'));
    await expect(
      controller.getCourseContent('77', req() as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(service.getCourseContent).toHaveBeenCalledWith('24060121130000', 77);
  });
});
