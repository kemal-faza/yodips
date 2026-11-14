import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  isKulonCookieRenewal,
  sameCapturedSession,
  SessionStore,
} from '../session/session-store';
import {
  LEGACY_CLIENT_ID,
  type CapturedSession,
  type SessionRef,
} from '../session/session-contract';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

const SECRET = 's'.repeat(32);

/** In-memory SessionStore fake, keyed by `<sub>:<clientId>` like the real stores. */
class FakeSessionStore extends SessionStore {
  records = new Map<string, CapturedSession>();

  private keyOf(sub: string, clientId: string): string {
    return `${sub}:${clientId}`;
  }

  async set(session: CapturedSession): Promise<void> {
    this.records.set(this.keyOf(session.identity, session.clientId), session);
  }

  async getIfGeneration(ref: SessionRef): Promise<CapturedSession | null> {
    const rec = this.records.get(this.keyOf(ref.sub, ref.clientId)) ?? null;
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return null;
    return rec;
  }

  async replaceIfUnchanged(
    ref: SessionRef,
    expected: CapturedSession,
    replacement: CapturedSession,
  ): Promise<'updated' | 'conflict' | 'dead'> {
    const key = this.keyOf(ref.sub, ref.clientId);
    const rec = this.records.get(key);
    if (!rec || rec.sessionGeneration !== ref.sessionGeneration) return 'dead';
    if (!sameCapturedSession(rec, expected)) return 'conflict';
    if (!isKulonCookieRenewal(ref, expected, replacement)) {
      throw new Error('Invalid session renewal replacement');
    }
    this.records.set(key, replacement);
    return 'updated';
  }

  async clearIfGeneration(ref: SessionRef): Promise<boolean> {
    const key = this.keyOf(ref.sub, ref.clientId);
    const rec = this.records.get(key);
    if (!rec) return true;
    if (rec.sessionGeneration !== ref.sessionGeneration) return false;
    this.records.delete(key);
    return true;
  }

  async listBySub(sub: string): Promise<CapturedSession[]> {
    return [...this.records.values()].filter((s) => s.identity === sub);
  }

  async clearAllForSub(sub: string): Promise<number> {
    let cleared = 0;
    for (const [key, rec] of this.records) {
      if (rec.identity !== sub) continue;
      this.records.delete(key);
      cleared += 1;
    }
    return cleared;
  }

  async all(): Promise<CapturedSession[]> {
    return [...this.records.values()];
  }

  async migrateLegacyKeys(): Promise<{ scanned: number; migrated: number }> {
    return { scanned: 0, migrated: 0 };
  }
}

function ctxWith(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

const GEN_1 = '1'.repeat(32);
const GEN_2 = '2'.repeat(32);

function session(
  sub: string,
  sessionGeneration: string,
  clientId = 'client-a',
): CapturedSession {
  return {
    identity: sub,
    clientId,
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
  let legacyEnabled = true;
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
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => {
              if (k === 'JWT_SECRET') return SECRET;
              if (k === 'SESSION_LEGACY_CLIENT_ENABLED') return legacyEnabled;
              return undefined;
            },
          },
        },
        { provide: SessionStore, useValue: store },
      ],
    }).compile();
    guard = module.get(JwtAuthGuard);
    jwt = module.get(JwtService);
  });

  beforeEach(() => {
    store.records.clear();
    legacyEnabled = true;
    jest.restoreAllMocks();
  });

  function token(payload: Record<string, unknown>, expiresIn?: string): Promise<string> {
    return jwt.signAsync(payload, expiresIn ? { expiresIn } : undefined);
  }

  function seed(record: CapturedSession): CapturedSession {
    store.records.set(`${record.identity}:${record.clientId}`, record);
    return record;
  }

  it('(a) accepts a valid token whose claim matches the live record generation', async () => {
    seed(session('NIM1', GEN_1, 'client-a'));
    const t = await token({ sub: 'NIM1', clientId: 'client-a', sessionGeneration: GEN_1 });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user.sub).toBe('NIM1');
    expect(req.user.clientId).toBe('client-a');
    expect(req.user.sessionGeneration).toBe(GEN_1);
  });

  it('(b) rejects with SESSION_DEAD when the store has no record for the signed sub/client', async () => {
    const t = await token({ sub: 'ghost', clientId: 'client-a', sessionGeneration: GEN_1 });
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
    seed(session('NIM1', GEN_2, 'client-a'));
    const t = await token({ sub: 'NIM1', clientId: 'client-a', sessionGeneration: GEN_1 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('(c2) rejects with SESSION_DEAD when only another device holds that generation', async () => {
    // Another device's live record must never satisfy this token's ref.
    seed(session('NIM1', GEN_1, 'client-b'));
    const t = await token({ sub: 'NIM1', clientId: 'client-a', sessionGeneration: GEN_1 });
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
    seed(session('NIM1', GEN_1, 'client-a'));
    const t = await token({ sub: 'NIM1', clientId: 'client-a', sessionGeneration: 1234 });
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('(d3) rejects SESSION_DEAD when the live record is legacy (no generation)', async () => {
    seed({ ...session('NIM1', GEN_1, 'client-a'), sessionGeneration: undefined as any });
    const t = await token({ sub: 'NIM1', clientId: 'client-a', sessionGeneration: GEN_1 });
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
    const t = await token({ sub: 'NIM1', clientId: 'client-a', sessionGeneration: GEN_1 }, '-1h');
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
      { sub: 'NIM1', clientId: 'client-a', sessionGeneration: GEN_1 },
      { expiresIn: '1h', issuer: 'evil', audience: 'evil' },
    );
    await expect(
      guard.canActivate(ctxWith({ headers: { authorization: `Bearer ${foreign}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('reads the exact device record and attaches the normalized clientId', async () => {
    seed(session('NIM1', GEN_1, 'abcdefgh'));
    const get = jest.spyOn(store, 'getIfGeneration');
    const t = await token({
      sub: 'NIM1',
      clientId: 'abcdefgh',
      sessionGeneration: GEN_1,
      via: 'handoff',
    });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith({
      sub: 'NIM1',
      clientId: 'abcdefgh',
      sessionGeneration: GEN_1,
    });
    expect(req.user).toEqual(
      expect.objectContaining({
        sub: 'NIM1',
        clientId: 'abcdefgh',
        sessionGeneration: GEN_1,
      }),
    );
  });

  it('maps a missing clientId to legacy while the flag is on, and rejects it when off', async () => {
    seed(session('NIM1', GEN_1, LEGACY_CLIENT_ID));
    const get = jest.spyOn(store, 'getIfGeneration');
    const t = await token({ sub: 'NIM1', sessionGeneration: GEN_1 });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user.clientId).toBe(LEGACY_CLIENT_ID);
    expect(get).toHaveBeenCalledWith({
      sub: 'NIM1',
      clientId: LEGACY_CLIENT_ID,
      sessionGeneration: GEN_1,
    });

    legacyEnabled = false;
    const err = await guard
      .canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getStatus()).toBe(401);
    expect((err as UnauthorizedException).getResponse()).toEqual(
      expect.objectContaining({ message: 'Token tidak valid', code: 'INVALID_TOKEN' }),
    );
  });

  it('normalizes an invalid clientId claim to legacy while the flag is on', async () => {
    seed(session('NIM1', GEN_1, LEGACY_CLIENT_ID));
    const t = await token({
      sub: 'NIM1',
      clientId: 'not a client id',
      sessionGeneration: GEN_1,
    });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user.clientId).toBe(LEGACY_CLIENT_ID);
  });

  it('only accepts a signed legacy claim while the flag is on', async () => {
    seed(session('NIM1', GEN_1, LEGACY_CLIENT_ID));
    const t = await token({
      sub: 'NIM1',
      clientId: LEGACY_CLIENT_ID,
      sessionGeneration: GEN_1,
    });
    const req: any = { headers: { authorization: `Bearer ${t}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user.clientId).toBe(LEGACY_CLIENT_ID);

    legacyEnabled = false;
    const err = await guard
      .canActivate(ctxWith({ headers: { authorization: `Bearer ${t}` } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toEqual(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });
});
