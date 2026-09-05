import 'reflect-metadata';
// MUST be imported before AppModule: ConfigModule.forRoot() validates env at
// import time (see auth.refresh.e2e.env.ts).
import './auth.refresh.e2e.env';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../app.module';
import { KulonService } from '../kulon/kulon.service';
import { SiapService } from '../siap/siap.service';

/**
 * TEMPORARY live E2E for the auto-rotate JWT feature (deleted after run).
 * Boots the REAL Nest app (real routes, real JwtAuthGuard, real
 * InMemorySessionStore) and stubs ONLY the upstream Kulon/SIAP probes so
 * /session/handoff can seed a session without campus credentials.
 *
 * Proves the full chain over HTTP:
 *   expired JWT -> guard 401 -> POST /auth/refresh 200 (new token)
 *   new token -> GET /auth/me authenticated
 */
describe('AuthModule refresh E2E (temporary)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const NIM = '24060121130077';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KulonService)
      .useValue({
        checkSessionValid: jest.fn(async () => ({ valid: true, reason: 'ok' })),
        getSessionIdentity: jest.fn(async () => NIM),
      })
      .overrideProvider(SiapService)
      .useValue({
        checkSessionValid: jest.fn(async () => ({ valid: true, reason: 'ok' })),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('handoff seeds a session and issues a valid JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E', siapCookie: 'sia_app_session=E2E' })
      .expect(201);
    expect(res.body.accessToken).toBeTruthy();

    // The freshly-issued JWT passes the guard on /me.
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.sub ?? me.body.nim ?? me.body.identity).toBeTruthy();
  });

  it('an EXPIRED but validly-signed JWT is rejected by the guard, then silently rotated by /refresh; the new token passes the guard', async () => {
    // Seed a live session so the expired token below can carry a real generation
    // (the guard requires the claim from Task 2 on).
    const session = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-ROT', siapCookie: 'sia_app_session=E2E-ROT' })
      .expect(201);
    const generation = session.body.sessionGeneration as string;
    expect(generation).toMatch(/^[0-9a-f]{32}$/);
    // Sign with a PAST expiry using the app's own config/secret/iss/aud and the
    // live session generation.
    const expired = await jwt.signAsync(
      { sub: NIM, via: 'handoff', sessionGeneration: generation },
      { expiresIn: '-1h' },
    );

    // 1. Guard rejects the expired token with proper HTTP semantics (401,
    // NOT the NestJS-default 403 from a bare `return false`) so clients can
    // distinguish auth-expiry and trigger silent refresh.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);

    // 2. Refresh rotates it because the backend session is still alive.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${expired}`)
      .expect((r) => {
        if (r.status !== 201 && r.status !== 200) {
          throw new Error(`refresh failed: ${r.status} ${JSON.stringify(r.body)}`);
        }
      });
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.accessToken).not.toBe(expired);

    // 3. The minted token passes the guard — user never re-logged-in.
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);

    // 4. The old expired token KEEPS failing (rotation did not resurrect it).
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('a MISSING Authorization header is 401 (not the default 403)', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('refresh returns SESSION_DEAD when no backend session exists for sub', async () => {
    const orphan = await jwt.signAsync(
      { sub: 'nobody-e2e', via: 'handoff', sessionGeneration: 'f'.repeat(32) },
      { expiresIn: '-1h' },
    );
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${orphan}`)
      .expect(401);
    expect(res.body.code ?? res.body.message?.code).toBe('SESSION_DEAD');
  });

  it('refresh returns INVALID_TOKEN for a garbage/forged token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(401);
    expect(res.body.code ?? res.body.message?.code).toBe('INVALID_TOKEN');
  });

  it('refresh rejects a VALID signature issued for another audience (iss/aud pin)', async () => {
    // Signed with the same secret but wrong issuer/audience must NOT refresh.
    const foreign = await jwt.signAsync(
      { sub: NIM, via: 'handoff' },
      { expiresIn: '-1h', issuer: 'evil', audience: 'evil' },
    );
    // jwt.verify inside refresh pins iss/aud from config, so this must fail
    // verification regardless of the store having the session.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${foreign}`)
      .expect(401);
    expect(res.body.code ?? res.body.message?.code).toBe('INVALID_TOKEN');
  });

  it('after POST /api/auth/logout the same (still valid) JWT can no longer refresh (SESSION_DEAD)', async () => {
    // Seed a fresh session via handoff.
    const handoff = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-LOGOUT', siapCookie: 'sia_app_session=E2E-LOGOUT' })
      .expect(201);
    const token = handoff.body.accessToken;
    const generation = handoff.body.sessionGeneration as string;
    expect(token).toBeTruthy();
    expect(generation).toMatch(/^[0-9a-f]{32}$/);

    // Guard passes (token valid, live record) before logout.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Logout clears the server session (route no longer JWT-guarded; bearer verified in service).
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect((r) => {
        if (r.status !== 200 && r.status !== 201) {
          throw new Error(`logout failed: ${r.status} ${JSON.stringify(r.body)}`);
        }
      });

    // The SAME unexpired JWT now hits a dead session on refresh → SESSION_DEAD.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.code ?? res.body.message?.code).toBe('SESSION_DEAD');

    // And on /me → 401 SESSION_DEAD (fail-closed, was 200 {authenticated:false}).
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(me.body.code ?? me.body.message?.code).toBe('SESSION_DEAD');
  });

  it('logout is idempotent: a repeated logout with a no-longer-live record returns ok', async () => {
    const handoff = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-IDEM', siapCookie: 'sia_app_session=E2E-IDEM' })
      .expect(201);
    const token = handoff.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect((r) => {
        if (r.status !== 200 && r.status !== 201) throw new Error(`logout failed: ${r.status}`);
      });

    // Record is gone; a second logout is idempotent { ok: true }.
    const again = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect((r) => {
        if (r.status !== 200 && r.status !== 201) throw new Error(`second logout failed: ${r.status}`);
      });
    expect(again.body.ok).toBe(true);
  });

  it('an EXPIRED but validly-signed JWT with a matching generation CAN log out (record cleared)', async () => {
    const handoff = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-EXP', siapCookie: 'sia_app_session=E2E-EXP' })
      .expect(201);
    const generation = handoff.body.sessionGeneration as string;
    const expired = await jwt.signAsync(
      { sub: NIM, via: 'handoff', sessionGeneration: generation },
      { expiresIn: '-1h' },
    );

    // The unguarded logout route verifies signature-only (ignoreExpiration) and
    // clears the matching record.
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${expired}`)
      .expect((r) => {
        if (r.status !== 200 && r.status !== 201) throw new Error(`logout failed: ${r.status} ${JSON.stringify(r.body)}`);
      });

    // The session is gone: refresh of the same expired token → SESSION_DEAD.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(res.body.code ?? res.body.message?.code).toBe('SESSION_DEAD');
  });

  it('an OLD-GENERATION valid token cannot clear a NEWER live session (SESSION_DEAD, record survives)', async () => {
    // First handoff mints generation G1 (crypto random — never collides).
    const first = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-GEN1', siapCookie: 'sia_app_session=E2E-GEN1' })
      .expect(201);
    const g1Token = first.body.accessToken;
    const g1 = first.body.sessionGeneration as string;

    // Same NIM re-logs-in → new generation G2 (handoff overwrites the record).
    // Crypto generations never collide, so no same-ms sleep is needed.
    const second = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-GEN2', siapCookie: 'sia_app_session=E2E-GEN2' })
      .expect(201);
    const g2Token = second.body.accessToken;
    const g2 = second.body.sessionGeneration as string;
    expect(g2).not.toBe(g1);

    // The NEW token works.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${g2Token}`)
      .expect(200);

    // The OLD token is dead on /me (guard generation check).
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${g1Token}`)
      .expect(401);
    expect(me.body.code ?? me.body.message?.code).toBe('SESSION_DEAD');

    // And on /refresh (refresh generation check).
    const rf = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${g1Token}`)
      .expect(401);
    expect(rf.body.code ?? rf.body.message?.code).toBe('SESSION_DEAD');

    // Logout with the OLD token → SESSION_DEAD (service generation check), and
    // the NEW session SURVIVES (guard presence+generation passes for g2Token).
    const lo = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${g1Token}`)
      .expect(401);
    expect(lo.body.code ?? lo.body.message?.code).toBe('SESSION_DEAD');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${g2Token}`)
      .expect(200);
  });

  it('logout with a garbage/no-claim token is INVALID_TOKEN and clears nothing; missing bearer is 401', async () => {
    const handoff = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-BAD', siapCookie: 'sia_app_session=E2E-BAD' })
      .expect(201);
    const token = handoff.body.accessToken;

    // Garbage token.
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(401);

    // No bearer at all → 401 (INVALID_TOKEN at the controller).
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);

    // A well-formed token with NO sessionGeneration claim (legacy) → 401 INVALID_TOKEN.
    const legacy = await jwt.signAsync({ sub: NIM, via: 'handoff' });
    const legacyRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${legacy}`)
      .expect(401);
    expect(legacyRes.body.code ?? legacyRes.body.message?.code).toBe('INVALID_TOKEN');

    // Nothing was cleared — the fresh token still works.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
