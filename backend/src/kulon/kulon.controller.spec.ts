import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('KulonController', () => {
  let controller: KulonController;
  const service = {
    getCourses: jest.fn(),
    getAssignments: jest.fn(),
    parseSesskey: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [KulonController],
      providers: [{ provide: KulonService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(KulonController);
  });

  it('returns courses using msSession and sesskey', async () => {
    service.parseSesskey.mockReturnValue('sesskey123');
    service.getCourses.mockResolvedValue([
      { id: 1, fullname: 'A', shortname: 'A', idnumber: '1' },
    ]);
    const req = { user: { msSession: 'ms-cookie' } };
    const res = await controller.getCourses(req as any);
    expect(res[0].fullname).toBe('A');
    expect(service.getCourses).toHaveBeenCalledWith('ms-cookie', 'sesskey123');
  });

  it('returns assignments with msSession', async () => {
    service.parseSesskey.mockReturnValue('sesskey123');
    service.getAssignments.mockResolvedValue([
      { id: 1, name: 'Tugas', duedate: 0, overdue: false, course: 'C' },
    ]);
    const req = { user: { msSession: 'ms-cookie' } };
    const res = await controller.getAssignments(req as any);
    expect(res[0].name).toBe('Tugas');
  });
});