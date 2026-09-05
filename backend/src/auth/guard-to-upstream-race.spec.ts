import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionStore } from '../session/session-store';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { KulonUpstreamSession } from '../kulon/kulon-upstream.session';
import { KulonService } from '../kulon/kulon.service';
import { SiapUpstreamSession } from '../siap/siap-upstream.session';
import { SiapService } from '../siap/siap.service';
import { InMemoryDataCache } from '../cache/in-memory-data.cache';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

const SECRET = 's'.repeat(32);
const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);
const COOKIE_A = 'MoodleSession=AAA';
const COOKIE_B = 'MoodleSession=BBB';
const SIAP_A = 'sia_app_session=AAA';
const SIAP_B = 'sia_app_session=BBB';

function ctxWith(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

describe('Guard-to-upstream TOCTOU (B): A-token never uses B cookies', () => {
  let guard: JwtAuthGuard;
  let jwt: JwtService;
  let store: InMemorySessionStore;

  beforeAll(async () => {
    store = new InMemorySessionStore(60_000, 3_600_000);
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

  beforeEach(async () => {
    await store.clear('U1');
    await store.set('U1', {
      identity: 'U1',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: COOKIE_A,
      siapCookie: SIAP_A,
      capturedAt: Date.now(),
      sessionGeneration: GEN_A,
    });
    jest.restoreAllMocks();
  });

  it('Kulon: guard validates A, replacement B lands first, service read with A is SESSION_DEAD and never fetches with B', async () => {
    const tokenA = await jwt.signAsync({ sub: 'U1', via: 'handoff', sessionGeneration: GEN_A });
    const req: any = { headers: { authorization: `Bearer ${tokenA}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'U1', sessionGeneration: GEN_A });

    // Re-login replaces the live record BEFORE the service/upstream read.
    await store.set('U1', {
      identity: 'U1',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: COOKIE_B,
      siapCookie: SIAP_B,
      capturedAt: Date.now(),
      sessionGeneration: GEN_B,
    });

    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('must not fetch on dead session'));
    const cache = new InMemoryDataCache(60_000);
    const upstream = new KulonUpstreamSession(store, cache);
    const svc = new KulonService(store, cache, undefined, upstream);

    await expect(
      svc.getCourses({ sub: 'U1', sessionGeneration: GEN_A }),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
    // No upstream fetch was attempted with either cookie — B never leaks.
    expect(fetchSpy).not.toHaveBeenCalled();

    // B remains live and hittable with its own generation.
    jest.restoreAllMocks();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://kulon2.undip.ac.id/my/',
      text: async () => '<html><input type="hidden" name="sesskey" value="skB"/></html>',
    } as unknown as Response);
    // Direct adapter proof: A still dead, B resolves to B's cookie.
    await expect(
      upstream.getContextForSession({ sub: 'U1', sessionGeneration: GEN_A }),
    ).rejects.toMatchObject({ status: 401 });
    const ctxB = await upstream.getContextForSession({ sub: 'U1', sessionGeneration: GEN_B });
    expect(ctxB.cookie).toBe(COOKIE_B);
  });

  it('SIAP: guard validates A, replacement B lands first, service read with A is SESSION_DEAD and never mints/fetches with B', async () => {
    const tokenA = await jwt.signAsync({ sub: 'U1', via: 'handoff', sessionGeneration: GEN_A });
    const req: any = { headers: { authorization: `Bearer ${tokenA}` } };
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);

    await store.set('U1', {
      identity: 'U1',
      ssoCookie: 'ci_session_sso=SSO',
      microsoftCookie: '',
      kulonCookie: COOKIE_B,
      siapCookie: SIAP_B,
      emailSso: 'u1@students.undip.ac.id',
      capturedAt: Date.now(),
      sessionGeneration: GEN_B,
    });

    const mint = jest.fn();
    const apiFetch = jest.fn();
    const cache = new InMemoryDataCache(60_000);
    const upstream = new SiapUpstreamSession(
      store,
      cache,
      { mintToken: mint, fetch: apiFetch } as any,
      async () => ({ nim: 'U1', emailSso: 'u1@students.undip.ac.id' }),
    );
    const svc = new SiapService(store, cache, upstream, { mintToken: mint, fetch: apiFetch } as any);

    await expect(
      svc.getProfile({ sub: 'U1', sessionGeneration: GEN_A }),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
    // No mint and no API fetch with B material.
    expect(mint).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('deferred GET -> replacement -> qualified read: B survives and A stays dead (stateful InMemory interleaving)', async () => {
    // Guard snapshot was A; the service read is deferred until after B lands.
    const staleRef = { sub: 'U1', sessionGeneration: GEN_A };
    await store.set('U1', {
      identity: 'U1',
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: COOKIE_B,
      siapCookie: SIAP_B,
      capturedAt: Date.now(),
      sessionGeneration: GEN_B,
    });
    const cache = new InMemoryDataCache(60_000);
    const upstream = new KulonUpstreamSession(store, cache);
    await expect(upstream.getContextForSession(staleRef)).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
    const live = await store.getIfGeneration('U1', GEN_B);
    expect(live?.kulonCookie).toBe(COOKIE_B);
  });
});
