import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { DashboardPayload } from './dashboard.service';
import type { TelemetryRuntime } from '../observability/telemetry';

describe('DashboardController', () => {
  const GEN = 'a'.repeat(32);
  function runtime() {
    const events: unknown[] = [];
    const values = [1_000_000n, 8_000_000n];
    const telemetry: TelemetryRuntime = {
      sink: { record: (event) => events.push(event) },
      wallNowMs: () => 1_725_148_800_000,
      monotonicNowNs: () => values.shift() ?? 8_000_000n,
    };
    return { telemetry, events };
  }

  it('returns the payload for req.user SessionRef', async () => {
    const payload: DashboardPayload = {
      profile: null,
      khs: null,
      irs: null,
      jadwal: [],
      courses: [],
      assignments: [],
      errors: {},
    };
    const service = { getDashboard: jest.fn().mockResolvedValue(payload) };
    const observed = runtime();
    const controller = new DashboardController(
      service as any,
      observed.telemetry,
    );
    const req = { user: { sub: '24060121130000', sessionGeneration: GEN } };
    await expect(controller.getDashboard(req as any)).resolves.toEqual(payload);
    expect(service.getDashboard).toHaveBeenCalledWith({
      sub: '24060121130000',
      sessionGeneration: GEN,
    });
    expect(observed.events).toEqual([
      {
        event: 'dashboard.request',
        route: 'GET /api/dashboard',
        outcome: 'ok',
        status: 200,
        durationMs: 7,
        responseBytes: Buffer.byteLength(JSON.stringify(payload)),
        cacheState: 'unknown',
      },
    ]);
  });

  it('accepts a low-cardinality cache-state measurement header', async () => {
    const service = {
      getDashboard: jest.fn().mockResolvedValue({ errors: {} }),
    };
    const observed = runtime();
    const controller = new DashboardController(
      service as any,
      observed.telemetry,
    );
    await controller.getDashboard({
      user: { sub: 'u1', sessionGeneration: GEN },
      headers: { 'x-yodips-cache-state': 'cold' },
    } as any);
    expect(observed.events).toHaveLength(1);
    expect(observed.events[0]).toMatchObject({ cacheState: 'cold' });
  });

  it('records authenticated dashboard failures without exposing the error message', async () => {
    const service = {
      getDashboard: jest
        .fn()
        .mockRejectedValue(
          new HttpException('secret upstream detail', HttpStatus.UNAUTHORIZED),
        ),
    };
    const observed = runtime();
    const controller = new DashboardController(
      service as any,
      observed.telemetry,
    );
    await expect(
      controller.getDashboard({
        user: { sub: 'u1', sessionGeneration: GEN },
      } as any),
    ).rejects.toThrow();
    expect(observed.events).toEqual([
      {
        event: 'dashboard.request',
        route: 'GET /api/dashboard',
        outcome: 'error',
        status: 401,
        durationMs: 7,
        cacheState: 'unknown',
      },
    ]);
    expect(JSON.stringify(observed.events)).not.toContain(
      'secret upstream detail',
    );
  });

  it('rejects 401 SESSION_DEAD without a generation (never drops to sub-only)', async () => {
    const service = { getDashboard: jest.fn() };
    const controller = new DashboardController(service as any);
    await expect(
      controller.getDashboard({ user: { sub: 'u1' } } as any),
    ).rejects.toMatchObject({
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
          ctx.switchToHttp().getRequest().user = {
            sub: 'u1',
            sessionGeneration: GEN,
          };
          return Promise.resolve(true);
        }),
      })
      .compile()
      .then((m) => m.createNestApplication());
    await app.init();
    await request(app.getHttpServer()).get('/api/dashboard').expect(200);
    await app.close();
    expect(getDashboard).toHaveBeenCalledWith({
      sub: 'u1',
      sessionGeneration: GEN,
    });
  });
});
