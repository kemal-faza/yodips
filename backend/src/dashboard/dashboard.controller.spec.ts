import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { DashboardPayload } from './dashboard.service';

describe('DashboardController', () => {
  it('returns the payload for req.user.sub', async () => {
    const payload: DashboardPayload = {
      profile: null, khs: null, irs: null, jadwal: [], courses: [], assignments: [], errors: {},
    };
    const service = { getDashboard: jest.fn().mockResolvedValue(payload) };
    const controller = new DashboardController(service as any);
    const req = { user: { sub: '24060124120013' } };
    await expect(controller.getDashboard(req as any)).resolves.toEqual(payload);
    expect(service.getDashboard).toHaveBeenCalledWith('24060124120013');
  });

  it('is guarded by JwtAuthGuard', async () => {
    const getDashboard = jest.fn().mockResolvedValue({ errors: {} });
    const app: INestApplication = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: { getDashboard } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile()
      .then((m) => m.createNestApplication());
    await app.init();
    const guard = app.get<JwtAuthGuard>(JwtAuthGuard);
    const guardSpy = jest.spyOn(guard, 'canActivate').mockResolvedValue(true);
    await request(app.getHttpServer()).get('/api/dashboard').expect(200);
    await app.close();
    expect(guardSpy).toHaveBeenCalled();
  });
});
