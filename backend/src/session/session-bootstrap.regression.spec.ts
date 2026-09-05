import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SessionModule } from './session.module';
import { SessionStore } from './session-store';
import { KulonModule } from '../kulon/kulon.module';
import { KulonService } from '../kulon/kulon.service';
import { KulonUpstreamSession } from '../kulon/kulon-upstream.session';
import { SiapModule } from '../siap/siap.module';
import { SiapUpstreamSession } from '../siap/siap-upstream.session';
import { SessionStore as SessionStoreToken } from './session-store';

/**
 * PRODUCTION-STYLE BOOTSTRAP REGRESSION TEST (2026-09-05 SESSION_DEAD blocker).
 *
 * The production outage reproduced only under a DELAYED store factory: Nest
 * builds SessionStore through an async `useFactory` that awaits Redis
 * connect()/ping(). The old code let consumers capture an empty process-global
 * registry when they were constructed before the factory settled (or in a
 * module context whose emitted DI metadata for SessionStore was undefined due
 * to a file-level circular dependency) — every data endpoint then answered
 * 401 SESSION_DEAD.
 *
 * These tests simulate that exact production shape with the REAL modules and a
 * fake `ioredis` whose connect/ping settle only after a controllable delay:
 * module resolution MUST wait for the factory (a true DI edge) and every
 * consumer MUST receive the SAME settled store instance. No store registry,
 * no @Optional() fallback exists anymore, so a bootstrap that lost the race
 * fails loudly here instead of silently capturing `undefined`.
 */

// A module-scoped seam file the mocked ioredis factory can close over.
import { releaseHooks } from './session-bootstrap-test.seam';

// Mock ioredis BEFORE any store module file is imported. jest.mock is hoisted
// above imports by babel/ts-jest, so this factory runs first regardless.
jest.mock('ioredis', () => {
  const seam = jest.requireActual<typeof import('./session-bootstrap-test.seam')>(
    './session-bootstrap-test.seam',
  );
  const Redis = jest.fn().mockImplementation(() => {
    const client = {
      connect: jest.fn(async () => {
        await new Promise<void>((resolve) => {
          seam.releaseHooks.push(resolve);
        });
      }),
      ping: jest.fn(async () => 'PONG'),
      quit: jest.fn(async () => undefined),
      disconnect: jest.fn(),
      status: 'connect',
      set: jest.fn(async () => 'OK'),
      get: jest.fn(async () => null),
      del: jest.fn(async () => 1),
      expire: jest.fn(async () => 1),
      scan: jest.fn(async () => ({ cursor: '0', keys: [] })),
      mget: jest.fn(async () => []),
      pipeline: jest.fn(() => ({
        set: jest.fn(),
        get: jest.fn(),
        expire: jest.fn(),
        del: jest.fn(),
        exec: jest.fn(async () => []),
      })),
    };
    return client;
  });
  return { __esModule: true, default: Redis };
});

function envLoad() {
  return {
    SESSION_BACKEND: 'redis',
    REDIS_URL: 'redis://127.0.0.1:6379',
    SESSION_ENC_KEY: 'k'.repeat(32),
    SESSION_TTL_MS: '604800000',
    SESSION_ABSOLUTE_TTL_MS: '604800000',
    NOTIFICATIONS_ENABLED: false,
  };
}

const release = () => {
  while (releaseHooks.length) releaseHooks.shift()?.();
};

describe('async/delayed SessionStore bootstrap (production redis shape)', () => {
  afterEach(() => release());

  it(
    'consumer providers receive the SAME settled SessionStore even when the store factory is delayed (Redis connect held open)',
    async () => {
      let compileResolve!: (m: Awaited<ReturnType<typeof Test.createTestingModule>>) => void;
      const compiled = new Promise<Awaited<ReturnType<typeof Test.createTestingModule>>>(
        (resolve) => {
          compileResolve = resolve;
        },
      );
      const boot = (async () => {
        const moduleRef = await Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              ignoreEnvFile: true,
              load: [envLoad],
            }),
            KulonModule,
            SiapModule,
            SessionModule,
          ],
        }).compile();
        compileResolve(moduleRef);
        return moduleRef;
      })();

      // Give Nest a beat to begin instantiating providers while the store
      // factory is still parked on connect(). If a consumer is constructed in
      // this window it must WAIT on the DI edge — never capture undefined.
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Release Redis: the factory settles now; consumers may construct.
      release();

      const moduleRef = await boot;
      const store = moduleRef.get(SessionStoreToken);
      const kulonService = moduleRef.get(KulonService);
      const kulonSeam = moduleRef.get(KulonUpstreamSession);
      const siapSeam = moduleRef.get(SiapUpstreamSession);

      expect(kulonSeam.store).toBe(store);
      expect(siapSeam.store).toBe(store);
      expect(
        (kulonService as unknown as { upstream: KulonUpstreamSession }).upstream
          .store,
      ).toBe(store);

      await moduleRef.close();
    },
    15_000,
  );

  it('compilation fails loudly when SessionStore cannot be resolved (no silent undefined capture)', async () => {
    // Register KulonService with NO SessionModule and NO SessionStore provider:
    // the mandatory @Inject(SessionStore) has no DI edge, so instantiation must
    // throw an UnknownDependencies-style error — the old @Optional() swallowed
    // this into a silent undefined store. (KulonModule itself is not usable for
    // this check: it imports SiapModule → SessionModule, which always supplies
    // the store.)
    await expect(
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [envLoad],
          }),
        ],
        providers: [KulonService],
      }).compile(),
    ).rejects.toThrow(/SessionStore|dependency|resolve/i);
  }, 15_000);
});
