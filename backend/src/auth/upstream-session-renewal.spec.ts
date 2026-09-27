import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { CapturedSession, SessionStore } from '../session/session-store';
import { KulonService } from '../kulon/kulon.service';
import { SiapService } from '../siap/siap.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UpstreamSessionRenewalDto } from './dto/upstream-session-renewal.dto';

const SUB = '24060121130077';
const GENERATION = 'a'.repeat(32);
const OLD_COOKIE = 'MoodleSession=old-session-value';
const NEW_COOKIE = 'MoodleSession=new-session-value';

function capturedSession(): CapturedSession {
  return {
    identity: SUB,
    ssoCookie: 'ci_session_sso=keep-sso',
    microsoftCookie: 'MSAL=keep-microsoft',
    kulonCookie: OLD_COOKIE,
    siapCookie: 'sia_app_session=keep-siap',
    emailSso: 'student@example.test',
    capturedAt: 1_700_000_000_000,
    sessionGeneration: GENERATION,
  };
}

function dto(cookie = NEW_COOKIE): UpstreamSessionRenewalDto {
  return { service: 'kulon', cookie };
}

function makeAuthService(
  sessionStore: SessionStore,
  validate = jest.fn(async () => ({ kind: 'valid' as const, identity: SUB })),
): AuthService {
  return new AuthService(
    sessionStore,
    {} as JwtService,
    {} as ConfigService,
    { validateSessionCookieForRenewal: validate } as unknown as KulonService,
    {} as SiapService,
  );
}

async function rejectedWithCode(
  action: Promise<unknown>,
  status: number,
  code: string,
) {
  let error: unknown;
  try {
    await action;
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ status });
  expect((error as { getResponse: () => unknown }).getResponse()).toMatchObject(
    { code },
  );
  return error as { getResponse: () => unknown };
}

describe('AuthService.upstream-session renewal', () => {
  it('validates the JWT-bound Kulon identity and CAS-replaces only the Kulon cookie', async () => {
    const store = new InMemorySessionStore(60_000);
    const original = capturedSession();
    await store.set(SUB, original);
    const validate = jest.fn(async () => ({
      kind: 'valid' as const,
      identity: SUB,
    }));
    const service = makeAuthService(store, validate);

    const result = await service.renewUpstreamSession(dto(), {
      sub: SUB,
      sessionGeneration: GENERATION,
    });

    expect(validate).toHaveBeenCalledWith(NEW_COOKIE);
    expect(result).toEqual({ service: 'kulon', status: 'renewed' });
    expect(JSON.stringify(result)).not.toContain(NEW_COOKIE);
    expect(await store.getIfGeneration(SUB, GENERATION)).toEqual({
      ...original,
      kulonCookie: NEW_COOKIE,
    });
  });

  it('returns SESSION_DEAD before probing if the JWT generation has no live record', async () => {
    const store = {
      getIfGeneration: jest.fn().mockResolvedValue(null),
      replaceIfUnchanged: jest.fn(),
    } as unknown as SessionStore;
    const validate = jest.fn();
    const service = makeAuthService(store, validate);

    await rejectedWithCode(
      service.renewUpstreamSession(dto(), {
        sub: SUB,
        sessionGeneration: GENERATION,
      }),
      401,
      'SESSION_DEAD',
    );
    expect(validate).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed cookie header', 'not-a-cookie'],
    ['missing Moodle session cookie', 'other=value'],
    ['empty Moodle session cookie', 'MoodleSession='],
    ['cookie header injection', 'MoodleSession=value\r\nX-Header: yes'],
  ])(
    'rejects %s as UPSTREAM_SESSION_INVALID without probing',
    async (_label, cookie) => {
      const store = new InMemorySessionStore(60_000);
      await store.set(SUB, capturedSession());
      const validate = jest.fn();
      const service = makeAuthService(store, validate);

      await rejectedWithCode(
        service.renewUpstreamSession(dto(cookie), {
          sub: SUB,
          sessionGeneration: GENERATION,
        }),
        422,
        'UPSTREAM_SESSION_INVALID',
      );
      expect(validate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ kind: 'invalid' as const }, SUB],
    [{ kind: 'valid' as const, identity: '24060121999999' }, '24060121999999'],
  ])(
    'rejects an invalid or other-identity Kulon cookie',
    async (validation, _identity) => {
      const store = new InMemorySessionStore(60_000);
      await store.set(SUB, capturedSession());
      const service = makeAuthService(
        store,
        jest.fn(async () => validation),
      );

      await rejectedWithCode(
        service.renewUpstreamSession(dto(), {
          sub: SUB,
          sessionGeneration: GENERATION,
        }),
        422,
        'UPSTREAM_SESSION_INVALID',
      );
      expect(await store.getIfGeneration(SUB, GENERATION)).toEqual(
        capturedSession(),
      );
    },
  );

  it('maps verification failures to UPSTREAM_UNAVAILABLE and does not write', async () => {
    const store = new InMemorySessionStore(60_000);
    await store.set(SUB, capturedSession());
    const validate = jest.fn(async () => ({ kind: 'unavailable' as const }));
    const service = makeAuthService(store, validate);
    const error = await rejectedWithCode(
      service.renewUpstreamSession(dto(), {
        sub: SUB,
        sessionGeneration: GENERATION,
      }),
      502,
      'UPSTREAM_UNAVAILABLE',
    );

    expect(JSON.stringify(error.getResponse())).not.toContain(NEW_COOKIE);
    expect(await store.getIfGeneration(SUB, GENERATION)).toEqual(
      capturedSession(),
    );
  });

  it.each([
    ['dead', 401, 'SESSION_DEAD'],
    ['conflict', 409, 'UPSTREAM_SESSION_CONFLICT'],
  ] as const)(
    'maps the CAS %s result to its stable HTTP contract',
    async (outcome, status, code) => {
      const expected = capturedSession();
      const store = {
        getIfGeneration: jest.fn().mockResolvedValue(expected),
        replaceIfUnchanged: jest.fn().mockResolvedValue(outcome),
      } as unknown as SessionStore;
      const service = makeAuthService(store);

      await rejectedWithCode(
        service.renewUpstreamSession(dto(), {
          sub: SUB,
          sessionGeneration: GENERATION,
        }),
        status,
        code,
      );
      expect(store.replaceIfUnchanged).toHaveBeenCalledWith(
        SUB,
        GENERATION,
        expected,
        {
          ...expected,
          kulonCookie: NEW_COOKIE,
        },
      );
    },
  );
});

describe('POST /api/auth/upstream-session/renew contract', () => {
  const secret = 'focused-test-secret';
  let app: INestApplication;
  let token: string;
  let renew: jest.Mock;

  beforeEach(async () => {
    const store = new InMemorySessionStore(60_000);
    await store.set(SUB, capturedSession());
    renew = jest
      .fn()
      .mockResolvedValue({ service: 'kulon', status: 'renewed' });
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret,
          signOptions: {
            algorithm: 'HS256',
            issuer: 'yodips',
            audience: 'yodips-web',
          },
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { renewUpstreamSession: renew } },
        { provide: SessionStore, useValue: store },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined),
          },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await moduleRef.get(JwtService).signAsync({
      sub: SUB,
      via: 'handoff',
      sessionGeneration: GENERATION,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a valid JWT and passes only the permitted DTO fields and JWT identity', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/upstream-session/renew')
      .send({ service: 'kulon', cookie: NEW_COOKIE })
      .expect(401);

    const response = await request(app.getHttpServer())
      .post('/api/auth/upstream-session/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({ service: 'kulon', cookie: NEW_COOKIE, identity: 'spoofed-sub' })
      .expect(200);

    expect(response.body).toEqual({ service: 'kulon', status: 'renewed' });
    expect(JSON.stringify(response.body)).not.toContain(NEW_COOKIE);
    expect(renew).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'kulon', cookie: NEW_COOKIE }),
      expect.objectContaining({ sub: SUB, sessionGeneration: GENERATION }),
    );
    expect(Object.keys(renew.mock.calls[0][0])).toEqual(['service', 'cookie']);
  });

  it('validates the fixed service and rejects unsafe cookie header characters', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/upstream-session/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({ service: 'siap', cookie: NEW_COOKIE })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/auth/upstream-session/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({ service: 'kulon', cookie: 'MoodleSession=x\r\nX-Injected: yes' })
      .expect(400);
    expect(renew).not.toHaveBeenCalled();
  });

  it('limits renewal to five requests per minute', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app.getHttpServer())
        .post('/api/auth/upstream-session/renew')
        .set('Authorization', `Bearer ${token}`)
        .send({ service: 'kulon', cookie: NEW_COOKIE })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/api/auth/upstream-session/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({ service: 'kulon', cookie: NEW_COOKIE })
      .expect(429);
    expect(renew).toHaveBeenCalledTimes(5);
  });
});
