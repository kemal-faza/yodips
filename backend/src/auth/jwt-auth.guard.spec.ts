import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionStore } from '../session/session-store';
import type { CapturedSession } from '../playwright/playwright-auth.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

const SECRET = 's'.repeat(32);

/** Configurable in-memory SessionStore fake — record (per sub) set per test. */
class FakeSessionStore extends SessionStore {
  records = new Map<string, CapturedSession>();
  async set(identity: string, session: CapturedSession): Promise<void> {
    this.records.set(identity, session);
  }
  async get(identity: string): Promise<CapturedSession | null> {
    return this.records.get(identity) ?? null;
  }
  async clear(identity: string): Promise<void> {
    this.records.delete(identity);
  }
  async all(): Promise<CapturedSession[]> {
    return [...this.records.values()];
  }
}

function ctxWith(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

function session(sub: string, capturedAt: number): CapturedSession {
  return {
    identity: sub,
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=K',
    siapCookie: '',
    capturedAt,
  };
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwt: JwtService;
  const store = new FakeSessionStore();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: SECRET,
          signOptions: {
            expiresIn: '1h',
            algorithm: 'HS256',
            issuer: 'yodips',
            audience: 'yodips-web',
          },
        }),
      ],
      providers: [
        JwtAuthGuard,
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } },
        { provide: SessionStore, useValue: store },
      ],
    }).compile();
    guard = module.get(JwtAuthGuard);
    jwt = module.get(JwtService);
  });

  beforeEach(() => {
    store.records.clear();
  });

  function token(payload: Record<string, unknown>, expiresIn?: string): Promise<string> {
    return jwt.signAsync(payload, expiresIn ? { expiresIn } : undefined);
  }

  it('(a) accepts a valid token whose claim matches the live record generation', async () => {
    store.records.set('NIM1', session('NIM1', 1000));
    const t = await token({ sub: 'NIM1', sessionCapturedAt: 1000 });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user.sub).toBe('NIM1');
    expect(req.user.sessionCapturedAt).toBe(1000);
  });

  it('(b) rejects with SESSION_DEAD when the store has no record for the signed sub', async () => {
    const t = await token({ sub: 'ghost', sessionCapturedAt: 1000 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('(c) rejects with SESSION_DEAD when the live record is a NEWER generation than the claim', async () => {
    // Token minted against generation 1000; the user re-logged-in → live
    // record has capturedAt 2000. The old token must NOT pass.
    store.records.set('NIM1', session('NIM1', 2000));
    const t = await token({ sub: 'NIM1', sessionCapturedAt: 1000 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('(d) rejects a well-formed token with NO sessionCapturedAt claim (legacy token) with a bare 401', async () => {
    const t = await token({ sub: 'NIM1', via: 'handoff' });
    const err = await guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getStatus()).toBe(401);
    // Bare 401 — no code body (SESSION_DEAD/INVALID_TOKEN bodies carry a code).
    expect(((err as UnauthorizedException).getResponse() as any).code).toBeUndefined();
  });

  it('(e) rejects a garbage token with a bare 401', async () => {
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: 'Bearer abc.def.ghi' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('(f) rejects an expired token with a bare 401', async () => {
    const t = await token({ sub: 'NIM1', sessionCapturedAt: 1000 }, '-1h');
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a missing Authorization header with a bare 401', async () => {
    await expect(guard.canActivate(ctxWith({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed for another issuer/audience (iss/aud pin)', async () => {
    const foreign = await jwt.signAsync(
      { sub: 'NIM1', sessionCapturedAt: 1000 },
      { expiresIn: '1h', issuer: 'evil', audience: 'evil' },
    );
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${foreign}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
