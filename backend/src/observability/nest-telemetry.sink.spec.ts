import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestTelemetrySink } from './nest-telemetry.sink';
import { TelemetryEventInput } from './telemetry-contract';

describe('NestTelemetrySink', () => {
  let debug: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockReturnValue(1_725_148_800_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function record(event: TelemetryEventInput): void {
    new NestTelemetrySink().record(event);
  }

  function logged(spy: jest.SpyInstance): Record<string, unknown> {
    expect(spy).toHaveBeenCalledTimes(1);
    return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
  }

  it('serializes an allowlisted envelope once with a safe timestamp', () => {
    const stringify = jest.spyOn(JSON, 'stringify');
    record({
      event: 'cache.read',
      cache: 'siap.profile',
      backend: 'memory',
      outcome: 'fresh',
      ageMs: 20,
      freshTtlMs: 300_000,
      staleTtlMs: 600_000,
      durationMs: 3,
      url: 'https://private.example/?nim=12345678901234',
      cookie: 'secret-cookie',
      body: 'secret-body',
      exception: 'secret exception text',
    } as never);

    expect(stringify).toHaveBeenCalledTimes(1);
    expect(logged(debug)).toEqual({
      v: 1,
      ts: '2024-09-01T00:00:00.000Z',
      event: 'cache.read',
      cache: 'siap.profile',
      backend: 'memory',
      outcome: 'fresh',
      ageMs: 20,
      freshTtlMs: 300_000,
      staleTtlMs: 600_000,
      durationMs: 3,
    });
    expect(JSON.stringify(logged(debug))).not.toContain('12345678901234');
  });

  it('emits every conditional event shape and maps its logger level', () => {
    const cases: Array<{ event: TelemetryEventInput; level: 'debug' | 'warn' | 'error' }> = [
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'miss', durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.read', cache: 'auth.probe', backend: 'memory', outcome: 'hit', durationMs: 1 },
        level: 'debug',
      },
      {
        event: {
          event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'miss',
          freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 1,
        },
        level: 'debug',
      },
      {
        event: {
          event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'stale',
          ageMs: 300_001, freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 1,
        },
        level: 'warn',
      },
      {
        event: {
          event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'expired',
          ageMs: 900_000, freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 1,
        },
        level: 'debug',
      },
      {
        event: {
          event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'started',
          freshTtlMs: 300_000, staleTtlMs: 600_000,
        },
        level: 'debug',
      },
      {
        event: {
          event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'ok',
          freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 4,
        },
        level: 'debug',
      },
      {
        event: {
          event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'error',
          freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 4, reason: 'dead-session',
        },
        level: 'warn',
      },
      {
        event: {
          event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'error',
          freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 4, reason: 'transient',
        },
        level: 'warn',
      },
      {
        event: {
          event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'error',
          freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 4, reason: 'unexpected',
        },
        level: 'error',
      },
      {
        event: {
          event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'hard_expire',
          freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 4, reason: 'dead-session',
        },
        level: 'warn',
      },
      {
        event: {
          event: 'upstream.request', service: 'siap', operation: 'profile_page',
          route: 'GET /pages/mhs/dashboard', outcome: 'ok', status: 200, durationMs: 2,
        },
        level: 'debug',
      },
      {
        event: {
          event: 'upstream.request', service: 'siap', operation: 'profile_page',
          route: 'GET /pages/mhs/dashboard', outcome: 'http_error', status: 502,
          durationMs: 2, reason: 'http-not-ok',
        },
        level: 'warn',
      },
      {
        event: {
          event: 'upstream.request', service: 'siap', operation: 'profile_page',
          route: 'GET /pages/mhs/dashboard', outcome: 'network_error', durationMs: 2,
          reason: 'fetch-threw',
        },
        level: 'warn',
      },
      {
        event: {
          event: 'upstream.request', service: 'siap', operation: 'profile_page',
          route: 'GET /pages/mhs/dashboard', outcome: 'parse_error', status: 200,
          durationMs: 2, reason: 'malformed-json',
        },
        level: 'warn',
      },
      {
        event: {
          event: 'upstream.request', service: 'siap', operation: 'profile_page',
          route: 'GET /pages/mhs/dashboard', outcome: 'parse_error', status: 200,
          durationMs: 2, reason: 'unknown',
        },
        level: 'error',
      },
      {
        event: {
          event: 'upstream.request', service: 'siap', operation: 'profile_page',
          route: 'GET /pages/mhs/dashboard', outcome: 'stale', status: 401,
          durationMs: 2, reason: 'login-redirect',
        },
        level: 'warn',
      },
    ];

    for (const current of cases) {
      jest.clearAllMocks();
      record(current.event);
      const spies = { debug, warn, error };
      expect(spies[current.level]).toHaveBeenCalledTimes(1);
      for (const [name, spy] of Object.entries(spies)) {
        if (name !== current.level) expect(spy).not.toHaveBeenCalled();
      }
    }
  });

  it('serializes the exact field set for every conditional shape', () => {
    const cases: Array<{
      event: TelemetryEventInput;
      expected: Record<string, unknown>;
      level: 'debug' | 'warn' | 'error';
    }> = [
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: 1 },
        expected: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'miss', durationMs: 1 },
        expected: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'miss', durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'miss', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        expected: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'miss', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'fresh', ageMs: 1, freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        expected: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'fresh', ageMs: 1, freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'stale', ageMs: 2, freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        expected: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'stale', ageMs: 2, freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        level: 'warn',
      },
      {
        event: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'expired', ageMs: 5, freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        expected: { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'expired', ageMs: 5, freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'started', freshTtlMs: 2, staleTtlMs: 3 },
        expected: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'started', freshTtlMs: 2, staleTtlMs: 3 },
        level: 'debug',
      },
      {
        event: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'ok', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        expected: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'ok', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'error', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1, reason: 'dead-session' },
        expected: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'error', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1, reason: 'dead-session' },
        level: 'warn',
      },
      {
        event: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'hard_expire', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1, reason: 'dead-session' },
        expected: { event: 'cache.refresh', cache: 'siap.profile', backend: 'redis', outcome: 'hard_expire', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1, reason: 'dead-session' },
        level: 'warn',
      },
      {
        event: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'ok', status: 200, durationMs: 1 },
        expected: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'ok', status: 200, durationMs: 1 },
        level: 'debug',
      },
      {
        event: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'http_error', status: 502, durationMs: 1, reason: 'http-not-ok' },
        expected: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'http_error', status: 502, durationMs: 1, reason: 'http-not-ok' },
        level: 'warn',
      },
      {
        event: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'network_error', durationMs: 1, reason: 'fetch-threw' },
        expected: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'network_error', durationMs: 1, reason: 'fetch-threw' },
        level: 'warn',
      },
      {
        event: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'parse_error', status: 200, durationMs: 1, reason: 'malformed-json' },
        expected: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'parse_error', status: 200, durationMs: 1, reason: 'malformed-json' },
        level: 'warn',
      },
      {
        event: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'stale', status: 401, durationMs: 1, reason: 'login-redirect' },
        expected: { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'stale', status: 401, durationMs: 1, reason: 'login-redirect' },
        level: 'warn',
      },
    ];

    for (const current of cases) {
      jest.clearAllMocks();
      record(current.event);
      const spies = { debug, warn, error };
      const payload = logged(spies[current.level]);
      expect(payload).toEqual({ v: 1, ts: '2024-09-01T00:00:00.000Z', ...current.expected });
      for (const [name, spy] of Object.entries(spies)) {
        if (name !== current.level) expect(spy).not.toHaveBeenCalled();
      }
    }
  });

  it('requires conditional fields and drops invalid numeric or wall-clock values', () => {
    const invalidEvents: unknown[] = [
      { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'fresh', ageMs: 1, freshTtlMs: 2, staleTtlMs: 3 },
      { event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: -1 },
      { event: 'cache.read', cache: 'auth.probe', backend: 'redis', outcome: 'hit', durationMs: 1 },
      { event: 'cache.refresh', cache: 'auth.probe', backend: 'memory', outcome: 'started', freshTtlMs: 2, staleTtlMs: 3 },
      { event: 'cache.refresh', cache: 'siap.profile', backend: 'memory', outcome: 'hard_expire', freshTtlMs: 2, staleTtlMs: 3, durationMs: 1, reason: 'transient' },
      { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'network_error', status: 500, durationMs: 1, reason: 'fetch-threw' },
      { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'ok', status: 99, durationMs: 1 },
      { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard', outcome: 'stale', status: 401, durationMs: 1, reason: 'http-not-ok' },
      { event: 'upstream.request', service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard?nim=12345678901234', outcome: 'ok', status: 200, durationMs: 1 },
    ];

    for (const invalid of invalidEvents) {
      jest.clearAllMocks();
      record(invalid as TelemetryEventInput);
      expect(debug).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }

    for (const clock of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20]) {
      jest.clearAllMocks();
      (Date.now as jest.Mock).mockReturnValue(clock);
      record({ event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: 1 });
      expect(debug).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  });

  it('swallows serialization and logger failures without recursive logging', () => {
    jest.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('serialization failed'); });
    expect(() => record({ event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: 1 })).not.toThrow();
    expect(debug).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    const failingLogger = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => { throw new Error('logger failed'); });
    const errorLogger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(() => record({ event: 'cache.read', cache: 'siap.profile', backend: 'memory', outcome: 'hit', durationMs: 1 })).not.toThrow();
    expect(failingLogger).toHaveBeenCalledTimes(1);
    expect(errorLogger).not.toHaveBeenCalled();
  });
});
