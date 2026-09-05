import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PairingController } from './pairing.controller';
import { PairingService } from './pairing.service';
import { ConsumeDto } from './dto/pair.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

/** Mock ExecutionContext minimal utk JwtAuthGuard. */
function ctxWith(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

describe('PairingController', () => {
  let controller: PairingController;
  const pairing = { requestPairing: jest.fn(), consume: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [PairingController],
      providers: [{ provide: PairingService, useValue: pairing }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PairingController);
  });

  it('pair/request meneruskan sub+generation dari JWT guard', async () => {
    pairing.requestPairing.mockResolvedValue({ code: 'ABCD1234', qrUrl: 'u', expiresAt: 1 });
    const gen = 'a'.repeat(32);
    const res = await controller.request({ user: { sub: 'NIM1', sessionGeneration: gen } } as any);
    expect(pairing.requestPairing).toHaveBeenCalledWith({ sub: 'NIM1', sessionGeneration: gen });
    expect(res.code).toBe('ABCD1234');
  });

  it('pair/request tanpa generation → 401 SESSION_DEAD (tidak diteruskan)', async () => {
    await expect(controller.request({ user: { sub: 'NIM1' } } as any)).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    expect(pairing.requestPairing).not.toHaveBeenCalled();
  });

  it('pair/consume meneruskan dto.code ke service', async () => {
    pairing.consume.mockResolvedValue({ accessToken: 'j', hasKulon: true, hasSiap: true });
    const res = await controller.consume({ code: 'abcd1234' } as any);
    expect(pairing.consume).toHaveBeenCalledWith('abcd1234');
    expect(res.accessToken).toBe('j');
  });

  it('pair/status meneruskan sub + code ke service (JWT-guarded)', async () => {
    pairing.statusFor = jest
      .fn()
      .mockResolvedValue({ status: 'pending', expiresAt: 123 });
    const res = await controller.status(
      { user: { sub: 'NIM1' } } as any,
      'abcd1234',
    );
    expect(pairing.statusFor).toHaveBeenCalledWith('NIM1', 'abcd1234');
    expect(res.status).toBe('pending');
  });

  it('pair/status tanpa query code → invalid, bukan 500', async () => {
    pairing.statusFor = jest.fn().mockResolvedValue({ status: 'invalid' });
    await expect(
      controller.status({ user: { sub: 'NIM1' } } as any, undefined),
    ).resolves.toEqual({ status: 'invalid' });
    expect(pairing.statusFor).toHaveBeenCalledWith('NIM1', '');
  });

  it('DTO tanpa code ditolak ValidationPipe (400, bukan 500)', async () => {
    const pipe = new ValidationPipe({ whitelist: true });
    await expect(
      pipe.transform({} as any, {
        type: 'body',
        metatype: ConsumeDto,
      }),
    ).rejects.toThrow();
  });

  it('round-trip: JWT via=pair (with sessionGeneration) dari JwtModule ter-pin LOLOS JwtAuthGuard asli — SessionStore DI resolves', async () => {
    const SECRET = 's'.repeat(32);
    const gen = '9'.repeat(32);
    const records = new Map<string, any>([
      ['X', { identity: 'X', ssoCookie: '', microsoftCookie: '', kulonCookie: 'K', siapCookie: '', capturedAt: Date.now(), sessionGeneration: gen }],
    ]);
    const fakeStore = {
      get: async (sub: string) => records.get(sub) ?? null,
      getIfGeneration: async (sub: string, generation: string) => {
        const rec = records.get(sub) ?? null;
        if (!rec || rec.sessionGeneration !== generation) return null;
        return rec;
      },
      clearIfGeneration: async () => true,
    };
    const module = await Test.createTestingModule({
      controllers: [PairingController],
      imports: [
        // Pin identik bentuk AuthModule (iss/aud/alg) — register() sinkron agar
        // tidak butuh resolusi ConfigService lintas dynamic-module di test.
        JwtModule.register({
          secret: SECRET,
          signOptions: { expiresIn: '1h', algorithm: 'HS256', issuer: 'yodips', audience: 'yodips-web' },
        }),
      ],
      providers: [
        JwtAuthGuard,
        { provide: PairingService, useValue: pairing },
        { provide: SessionStore, useValue: fakeStore },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } },
      ],
    }).compile();

    const jwt = module.get(JwtService);
    const guard = module.get(JwtAuthGuard);
    // The token carries the claim the fake record holds (generation gen), so the
    // guard's shape check passes and the exact-generation compare passes.
    const token = await jwt.signAsync({ sub: 'X', via: 'pair', sessionGeneration: gen });
    await expect(guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${token}` } }))).resolves.toBe(true);
  });
});
