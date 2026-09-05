import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { DashboardPayload } from './dashboard.service';

describe('DashboardController', () => {
  const GEN = 'a'.repeat(32);
  it('returns the payload for req.user SessionRef', async () => {
    const payload: DashboardPayload = {
      profile: null, khs: null, irs: null, jadwal: [], courses: [], assignments: [], errors: {},
    };
    const service = { getDashboard: jest.fn().mockResolvedValue(payload) };
    const controller = new DashboardController(service as any);
    const req = { user: { sub: '24060124120013', sessionGeneration: GEN } };
    await expect(controller.getDashboard(req as any)).resolves.toEqual(payload);
    expect(service.getDashboard).toHaveBeenCalledWith({ sub: '24060124120013', sessionGeneration: GEN });
  });

  it('rejects 401 SESSION_DEAD without a generation (never drops to sub-only)', async () => {
    const service = { getDashboard: jest.fn() };
    const controller = new DashboardController(service as any);
    await expect(controller.getDashboard({ user: { sub: 'u1' } } as any)).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(service.getDashboard).not.toHaveBeenCalled();
  });

  it('is guarded by JwtAuthGuard', async () => {
    const getDashboard = jest.fn().mockResolvedValue({ errors: {} });
    const app: INestApplication = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: { getDashboard } }],
    })
      .overrideGuard(JwtAuthGuard)
      // Mock guard attaches a valid SessionRef like the real JwtAuthGuard does.
      .useValue({
        canActivate: jest.fn().mockImplementation((ctx: any) => {
          ctx.switchToHttp().getRequest().user = { sub: 'u1', sessionGeneration: GEN };
          return Promise.resolve(true);
        }),
      })
      .compile()
      .then((m) => m.createNestApplication());
    await app.init();
    await request(app.getHttpServer()).get('/api/dashboard').expect(200);
    await app.close();
    expect(getDashboard).toHaveBeenCalledWith({ sub: 'u1', sessionGeneration: GEN });
  });
});
