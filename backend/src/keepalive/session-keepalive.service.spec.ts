import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { generateSessionGeneration, type CapturedSession } from '../session/session-contract';
import { SessionKeepAliveService } from './session-keepalive.service';

const GEN = generateSessionGeneration();

function session(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return {
    identity: '24060121130000',
    ssoCookie: 'ci_session_sso=OLD',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=OLD',
    siapCookie: 'sia_app_session=OLD',
    capturedAt: Date.now(),
    sessionGeneration: GEN,
    ...overrides,
  };
}

function config(overrides: Record<string, unknown> = {}): ConfigService {
  return new ConfigService({
    SESSION_ABSOLUTE_TTL_MS: 2_592_000_000,
    SESSION_KEEPALIVE_CONCURRENCY: 1,
    SESSION_KEEPALIVE_CYCLE_BUDGET_MS: 20 * 60_000,
    SESSION_KEEPALIVE_JITTER_MS: 0,
    ...overrides,
  });
}

describe('SessionKeepAliveService.runCycle', () => {
  it('does not slide when every probe is invalid', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );
    const slide = jest.spyOn(store, 'getIfGeneration');
    await service.runCycle();

    expect(slide).not.toHaveBeenCalled();
    expect(await store.get('24060121130000')).toBeDefined();
  });

  it('slides when at least one probe is valid and no cookie rotated', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    const slide = jest.spyOn(store, 'getIfGeneration');
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: true, setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    expect(slide).toHaveBeenCalledWith('24060121130000', GEN);
  });

  it('applies SSO rotation before Kulon rotation', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: true, setCookies: ['ci_session_sso=NEW; Path=/'] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: true, setCookies: ['MoodleSession=NEW; Path=/'] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    expect(await store.get('24060121130000')).toMatchObject({
      ssoCookie: 'ci_session_sso=NEW',
      kulonCookie: 'MoodleSession=NEW',
    });
  });

  it('skips sessions past the absolute cap', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set(
      '24060121130000',
      session({ capturedAt: Date.now() - 2_592_000_001 }),
    );
    const sso = { probe: jest.fn() };
    const service = new SessionKeepAliveService(
      store,
      sso as never,
      { probeForKeepAlive: jest.fn() } as never,
      { probeForKeepAlive: jest.fn() } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    expect(sso.probe).not.toHaveBeenCalled();
  });

  it('does not let a no-cookie SSO probe block a valid Kulon rotation', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: false, kind: 'no-cookie', setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: true, setCookies: ['MoodleSession=NEW; Path=/'] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    expect(await store.get('24060121130000')).toMatchObject({
      kulonCookie: 'MoodleSession=NEW',
    });
  });

  it('stops the user on a CAS conflict', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    jest.spyOn(store, 'replaceIfUnchanged').mockResolvedValueOnce('conflict');
    const slide = jest.spyOn(store, 'getIfGeneration');
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: true, setCookies: ['ci_session_sso=NEW; Path=/'] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: true, setCookies: ['MoodleSession=NEW; Path=/'] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    expect(slide).not.toHaveBeenCalled();
    expect((await store.get('24060121130000'))?.kulonCookie).toBe('MoodleSession=OLD');
  });

  it('backs off one rate-limited service without skipping the others', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    const slide = jest.spyOn(store, 'getIfGeneration');
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: false, kind: 'rate-limited', setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: true, setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: true, setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    expect(slide).toHaveBeenCalledWith('24060121130000', GEN);
  });

  it('never logs cookie values', async () => {
    const store = new InMemorySessionStore(60_000, 2_592_000_000);
    await store.set('24060121130000', session());
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new SessionKeepAliveService(
      store,
      { probe: jest.fn().mockResolvedValue({ valid: true, setCookies: ['ci_session_sso=SECRET; Path=/'] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      { probeForKeepAlive: jest.fn().mockResolvedValue({ valid: false, kind: 'invalid', setCookies: [] }) } as never,
      config(),
      { addCronJob: jest.fn(), deleteCronJob: jest.fn() } as never,
    );

    await service.runCycle();

    const text = log.mock.calls.flat().join(' ');
    expect(text).not.toContain('ci_session_sso=');
    expect(text).not.toContain('MoodleSession=');
    expect(text).not.toContain('sia_app_session=');
  });
});

describe('SessionKeepAliveService.onApplicationBootstrap', () => {
  const makeService = (values: Record<string, unknown>, addCronJob = jest.fn(), deleteCronJob = jest.fn()) =>
    new SessionKeepAliveService(
      new InMemorySessionStore(60_000, 2_592_000_000),
      { probe: jest.fn() } as never,
      { probeForKeepAlive: jest.fn() } as never,
      { probeForKeepAlive: jest.fn() } as never,
      config(values),
      { addCronJob, deleteCronJob } as never,
    );

  it('does not register a job when disabled', () => {
    const addCronJob = jest.fn();
    const svc = makeService({ SESSION_KEEPALIVE_ENABLED: false }, addCronJob);
    svc.onApplicationBootstrap();
    expect(addCronJob).not.toHaveBeenCalled();
  });

  it('registers the configured cron expression', () => {
    const addCronJob = jest.fn();
    const svc = makeService(
      { SESSION_KEEPALIVE_ENABLED: true, SESSION_KEEPALIVE_CRON: '*/7 * * * *' },
      addCronJob,
    );
    svc.onApplicationBootstrap();
    expect(addCronJob).toHaveBeenCalledWith('session-keepalive', expect.anything());
    const job = addCronJob.mock.calls[0][1];
    expect(job.cronTime.source).toBe('*/7 * * * *');
    svc.onApplicationShutdown();
  });

  it('throws on an invalid cron expression', () => {
    const svc = makeService({
      SESSION_KEEPALIVE_ENABLED: true,
      SESSION_KEEPALIVE_CRON: 'not-a-cron',
    });
    expect(() => svc.onApplicationBootstrap()).toThrow();
  });
});
