import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { KulonController } from './kulon.controller';
import { KulonService } from './kulon.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

describe('KulonController', () => {
  let controller: KulonController;
  const service = {
    getCourses: jest.fn(),
    getAssignments: jest.fn(),
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
    await expect(controller.getCourses()).rejects.toThrow('No Kulon session');
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
});