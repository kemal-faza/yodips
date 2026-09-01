import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CACHE_BACKENDS,
  CACHE_LABELS,
  CACHE_READ_OUTCOMES,
  CACHE_REFRESH_OUTCOMES,
  CACHE_REFRESH_REASONS,
  TELEMETRY_EVENT_SHAPES,
  TELEMETRY_SCHEMA_VERSION,
  UPSTREAM_OUTCOMES,
  UPSTREAM_REASONS,
  UPSTREAM_ROUTES,
  UPSTREAM_SERVICES,
} from './telemetry-contract';
import {
  createNoopTelemetryRuntime,
  elapsedMs,
  recordTelemetry,
  safeAgeMs,
  TelemetryRuntime,
} from './telemetry';
import { serializeTelemetryEvent } from './nest-telemetry.sink';

describe('telemetry contract and runtime', () => {
  it('records the versioned recording-runtime example without exposing caller secrets', () => {
    const events: unknown[] = [];
    const wall = 1_725_148_800_000;
    const runtime: TelemetryRuntime & { events: unknown[] } = {
      events,
      sink: {
        record(event) {
          const serialized = serializeTelemetryEvent(event, wall);
          if (serialized) events.push(serialized);
        },
      },
      wallNowMs: () => wall,
      monotonicNowNs: (() => {
        const values = [5_000_000n, 8_900_000n];
        return () => values.shift() ?? 8_900_000n;
      })(),
    };

    recordTelemetry(runtime, {
      event: 'cache.read',
      cache: 'siap.profile',
      backend: 'memory',
      outcome: 'fresh',
      ageMs: 20,
      freshTtlMs: 300_000,
      staleTtlMs: 600_000,
      durationMs: 3,
      nim: '12345678901234',
    } as never);

    expect(runtime.events).toEqual([
      {
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
      },
    ]);
    expect(JSON.stringify(runtime.events)).not.toContain('12345678901234');
  });

  it('publishes the finite allowlists and exact upstream route inventory', () => {
    expect([...CACHE_LABELS]).toEqual([
      'kulon.courses',
      'kulon.assignments_all',
      'kulon.assignment_detail',
      'kulon.course_content',
      'kulon.sesskey',
      'siap.profile',
      'siap.irs',
      'siap.khs',
      'siap.lecturers',
      'siap.notifications',
      'siap.jadwal',
      'siap.absen',
      'siap.identity',
      'siap.token',
      'auth.probe',
      'unknown',
    ]);
    expect([...CACHE_BACKENDS]).toEqual(['memory', 'redis']);
    expect([...CACHE_READ_OUTCOMES]).toEqual(['fresh', 'stale', 'hit', 'miss', 'expired']);
    expect([...CACHE_REFRESH_OUTCOMES]).toEqual(['started', 'ok', 'error', 'hard_expire']);
    expect([...CACHE_REFRESH_REASONS]).toEqual([
      'dead-session',
      'transient',
      'unexpected',
      'unknown',
    ]);
    expect([...UPSTREAM_SERVICES]).toEqual(['kulon', 'siap', 'siap-api', 'sso', 'microsoft']);
    expect([...UPSTREAM_OUTCOMES]).toEqual([
      'ok',
      'http_error',
      'network_error',
      'parse_error',
      'stale',
    ]);
    expect([...UPSTREAM_REASONS]).toEqual([
      'redirect-loop',
      'http-not-ok',
      'login-redirect',
      'html-content-type',
      'malformed-json',
      'no-cookie',
      'api-credential',
      'api-endpoint',
      'no-api-upstream',
      'no-emailSso',
      'non-json-process',
      'fetch-threw',
      'stale',
      'unknown',
    ]);
    expect(UPSTREAM_ROUTES).toHaveLength(26);
    expect(UPSTREAM_ROUTES).toEqual([
      { service: 'kulon', operation: 'session_probe', route: 'GET /my/' },
      { service: 'siap', operation: 'session_probe', route: 'GET /pages/mhs/dashboard' },
      { service: 'kulon', operation: 'session_identity', route: 'GET /my/' },
      { service: 'kulon', operation: 'profile_identity', route: 'GET /user/profile.php' },
      { service: 'kulon', operation: 'assignments_index', route: 'GET /mod/assign/index.php' },
      { service: 'kulon', operation: 'quiz_index', route: 'GET /mod/quiz/index.php' },
      { service: 'kulon', operation: 'assignment_detail', route: 'GET /mod/assign/view.php' },
      { service: 'kulon', operation: 'course_content', route: 'GET /course/view.php' },
      { service: 'kulon', operation: 'sesskey', route: 'GET /my/' },
      { service: 'kulon', operation: 'ajax', route: 'POST /lib/ajax/service.php' },
      { service: 'siap', operation: 'profile_page', route: 'GET /pages/mhs/dashboard' },
      {
        service: 'siap',
        operation: 'attendance_page',
        route: 'POST /jadwal_mahasiswa/mhs/jadwal/get_absen',
      },
      {
        service: 'siap',
        operation: 'notification_action',
        route: 'POST /pages/mhs/dashboard/ajax/unread',
      },
      {
        service: 'siap',
        operation: 'qr_presence',
        route: 'POST /master_perkuliahan/mhs/absensi/process/',
      },
      { service: 'siap-api', operation: 'mintToken', route: 'POST /index.php/mahasiswa_sso' },
      { service: 'siap-api', operation: 'semester_aktif', route: 'POST /index.php/semester_aktif' },
      { service: 'siap-api', operation: 'data_mahasiswa', route: 'POST /index.php/data_mahasiswa' },
      { service: 'siap-api', operation: 'v2/lihat_irs', route: 'POST /index.php/v2/lihat_irs' },
      { service: 'siap-api', operation: 'v2/daftar_khs', route: 'POST /index.php/v2/daftar_khs' },
      { service: 'siap-api', operation: 'v2/lihat_khs', route: 'POST /index.php/v2/lihat_khs' },
      { service: 'siap-api', operation: 'jadwal', route: 'POST /index.php/jadwal' },
      { service: 'siap-api', operation: 'absen', route: 'POST /index.php/absen' },
      { service: 'siap-api', operation: 'pengumuman', route: 'POST /index.php/pengumuman' },
      { service: 'sso', operation: 'login_page', route: 'GET /auth/user/login' },
      { service: 'sso', operation: 'session_exchange', route: 'POST /sso/auth_v2' },
      { service: 'microsoft', operation: 'token_exchange', route: 'POST /oauth2/v2.0/token' },
    ]);
  });

  it('matches the checked standalone contract fixture', () => {
    const fixture = JSON.parse(
      readFileSync(resolve(__dirname, '../../../tools/observability-contract.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(fixture).toEqual({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      cacheLabels: [...CACHE_LABELS],
      cacheBackends: [...CACHE_BACKENDS],
      cacheReadOutcomes: [...CACHE_READ_OUTCOMES],
      cacheRefreshOutcomes: [...CACHE_REFRESH_OUTCOMES],
      cacheRefreshReasons: [...CACHE_REFRESH_REASONS],
      upstreamServices: [...UPSTREAM_SERVICES],
      upstreamOutcomes: [...UPSTREAM_OUTCOMES],
      upstreamReasons: [...UPSTREAM_REASONS],
      upstreamRoutes: UPSTREAM_ROUTES,
      eventShapes: TELEMETRY_EVENT_SHAPES,
    });
  });

  it('clamps monotonic and wall-clock age calculations safely', () => {
    expect(elapsedMs(9n, 4n)).toBe(0);
    expect(elapsedMs(5_000_000n, 8_900_000n)).toBe(3);
    expect(elapsedMs(0n, BigInt(Number.MAX_SAFE_INTEGER) * 2_000_000n)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(safeAgeMs(100, 120)).toBe(0);
    expect(safeAgeMs(120.9, 100)).toBe(20);
  });

  it('provides production clocks and swallows sink failures', () => {
    const runtime = createNoopTelemetryRuntime();
    expect(runtime.wallNowMs).toBe(Date.now);
    expect(runtime.monotonicNowNs).toBe(process.hrtime.bigint);
    expect(() => recordTelemetry(runtime, { event: 'invalid' } as never)).not.toThrow();

    const throwingRuntime: TelemetryRuntime = {
      ...runtime,
      sink: { record: () => { throw new Error('must not escape'); } },
    };
    expect(() => recordTelemetry(throwingRuntime, { event: 'invalid' } as never)).not.toThrow();
  });
});
