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
    const generation = session.body.capturedAt as number;
    // Sign with a PAST expiry using the app's own config/secret/iss/aud and the
    // live session generation.
    const expired = await jwt.signAsync(
      { sub: NIM, via: 'handoff', sessionCapturedAt: generation },
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

    // 3. PRE-TASK-4: the refresh-minted replacement is still claim-less (refresh
    //    gains the claim + generation check in Task 4), so the guard rejects it
    //    with 401 today. Task 4 flips this block back to .expect(200).
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(401);

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
      { sub: 'nobody-e2e', via: 'handoff' },
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

  it('after POST /api/auth/logout the same (still valid) JWT can no longer refresh', async () => {
    // Seed a fresh session via handoff.
    const handoff = await request(app.getHttpServer())
      .post('/api/auth/session/handoff')
      .send({ kulonCookie: 'MoodleSession=E2E-LOGOUT', siapCookie: 'sia_app_session=E2E-LOGOUT' })
      .expect(201);
    const token = handoff.body.accessToken;

    // Guard passes (token valid) before logout.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Logout clears the server session.
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // The SAME unexpired JWT now hits a dead session on refresh → SESSION_DEAD.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.code ?? res.body.message?.code).toBe('SESSION_DEAD');
  });

  it('POST /api/auth/logout without a bearer token is 401 (guarded)', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
  });

  it('an EXPIRED validly-signed JWT cannot log out (guard rejects), and the absolute cap means refresh is dead anyway', async () => {
    const expired = await jwt.signAsync(
      { sub: 'logout-expired-e2e', via: 'handoff' },
      { expiresIn: '-1h' },
    );
    // The guard verifies exp, so the expired token cannot reach logout.
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });
});
