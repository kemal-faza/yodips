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
  async clearIfGeneration(identity: string, generation: string): Promise<boolean> {
    const rec = this.records.get(identity);
    if (!rec) return true;
    if (rec.sessionGeneration !== generation) return false;
    this.records.delete(identity);
    return true;
  }
  async all(): Promise<CapturedSession[]> {
    return [...this.records.values()];
  }
}

function ctxWith(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

const GEN_1 = '1'.repeat(32);
const GEN_2 = '2'.repeat(32);

function session(sub: string, sessionGeneration: string): CapturedSession {
  return {
    identity: sub,
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=K',
    siapCookie: '',
    capturedAt: Date.now(),
    sessionGeneration,
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
    store.records.set('NIM1', session('NIM1', GEN_1));
    const t = await token({ sub: 'NIM1', sessionGeneration: GEN_1 });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user.sub).toBe('NIM1');
    expect(req.user.sessionGeneration).toBe(GEN_1);
  });

  it('(b) rejects with SESSION_DEAD when the store has no record for the signed sub', async () => {
    const t = await token({ sub: 'ghost', sessionGeneration: GEN_1 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('(c) rejects with SESSION_DEAD when the live record is a NEWER generation than the claim', async () => {
    // Token minted against generation GEN_1; the user re-logged-in → live
    // record has GEN_2. The old token must NOT pass.
    store.records.set('NIM1', session('NIM1', GEN_2));
    const t = await token({ sub: 'NIM1', sessionGeneration: GEN_1 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('(d) rejects a well-formed token with NO sessionGeneration claim (legacy token) with a bare 401', async () => {
    const t = await token({ sub: 'NIM1', via: 'handoff' });
    const err = await guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getStatus()).toBe(401);
    // Bare 401 — no code body (SESSION_DEAD/INVALID_TOKEN bodies carry a code).
    expect(((err as UnauthorizedException).getResponse() as any).code).toBeUndefined();
  });

  it('(d2) rejects a token with an ill-typed generation (numeric legacy capturedAt) with a bare 401', async () => {
    store.records.set('NIM1', session('NIM1', GEN_1));
    const t = await token({ sub: 'NIM1', sessionGeneration: 1234 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('(d3) rejects SESSION_DEAD when the live record is legacy (no generation)', async () => {
    store.records.set('NIM1', { ...session('NIM1', GEN_1), sessionGeneration: undefined as any });
    const t = await token({ sub: 'NIM1', sessionGeneration: GEN_1 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('(e) rejects a garbage token with a bare 401', async () => {
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: 'Bearer abc.def.ghi' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('(f) rejects an expired token with a bare 401', async () => {
    const t = await token({ sub: 'NIM1', sessionGeneration: GEN_1 }, '-1h');
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
      { sub: 'NIM1', sessionGeneration: GEN_1 },
      { expiresIn: '1h', issuer: 'evil', audience: 'evil' },
    );
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${foreign}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
