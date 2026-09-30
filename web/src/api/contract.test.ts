import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API,
  BACKEND_ERROR_CODES,
  isServiceSessionPath,
  isServiceStale,
  parseErrorEnvelope,
} from './contract';

/**
 * SSOT tabel route: `contract/backend-contract.json` `apiPaths`. Tabel `API`
 * web hanya boleh MIRROR sebagian dari kanonik — test di bawah gagal kalau web
 * mengarang path, kalau nilainya berbeda dari kanonik, atau kalau ada entry web
 * baru yang belum punya baris mirror.
 */
const canonical = JSON.parse(
  readFileSync(resolve(__dirname, '../../../contract/backend-contract.json'), 'utf8'),
) as { apiPaths: Record<string, string> };

interface RouteMirror {
  canonicalKey: string;
  /** Argumen contoh untuk entry fungsi; juga menyubstitusi `:param` kanonik. */
  sample?: string | number;
}

const ROUTE_MIRRORS: Record<string, RouteMirror> = {
  'auth.me': { canonicalKey: 'auth.me' },
  'auth.refresh': { canonicalKey: 'auth.refresh' },
  'auth.capture': { canonicalKey: 'auth.capture' },
  'auth.microsoftLogin': { canonicalKey: 'auth.microsoftLogin' },
  'auth.handoff': { canonicalKey: 'auth.handoff' },
  'auth.logout': { canonicalKey: 'auth.logout' },
  'auth.pairRequest': { canonicalKey: 'auth.pairRequest' },
  'auth.pairConsume': { canonicalKey: 'auth.pairConsume' },
  'auth.pairStatus': { canonicalKey: 'auth.pairStatus' },
  'kulon.courses': { canonicalKey: 'kulon.courses' },
  'kulon.courseSummary': { canonicalKey: 'kulon.courseSummary' },
  'kulon.assignments': { canonicalKey: 'kulon.assignments' },
  'kulon.allAssignments': { canonicalKey: 'kulon.allAssignments' },
  'kulon.assignmentDetail': { canonicalKey: 'kulon.assignmentDetail', sample: 42 },
  'kulon.courseContent': { canonicalKey: 'kulon.courseContent', sample: 7 },
  'siap.profile': { canonicalKey: 'siap.profile' },
  'siap.irs': { canonicalKey: 'siap.irs' },
  'siap.khs': { canonicalKey: 'siap.khs' },
  'siap.lecturers': { canonicalKey: 'siap.lecturers' },
  'siap.jadwal': { canonicalKey: 'siap.jadwal' },
  'siap.absen': { canonicalKey: 'siap.absen' },
  'siap.notifications': { canonicalKey: 'siap.notifications' },
  'siap.markNotification': { canonicalKey: 'siap.markNotification', sample: 'abc' },
  // Tabel web memisahkan item (GET :id) dari collection (POST); kanonik
  // menyebutnya kehadiranById dan kehadiran.
  'siap.kehadiran': { canonicalKey: 'siap.kehadiranById', sample: '37' },
  'siap.markKehadiran': { canonicalKey: 'siap.kehadiran' },
  dashboard: { canonicalKey: 'dashboard' },
};

function readWebEntry(dotPath: string): unknown {
  return dotPath
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], API);
}

function renderCanonical(template: string, sample?: string | number): string {
  return sample === undefined ? template : template.replace(/:[A-Za-z]+/g, String(sample));
}

describe('API paths mirror contract/backend-contract.json apiPaths', () => {
  it.each(Object.entries(ROUTE_MIRRORS) as Array<[string, RouteMirror]>)(
    '%s cocok dengan kanonik',
    (webKey, mirror) => {
      const entry = readWebEntry(webKey);
      expect(entry, `${webKey} tidak ada di tabel API web`).toBeDefined();
      const template = canonical.apiPaths[mirror.canonicalKey];
      if (!template) {
        throw new Error(`apiPaths.${mirror.canonicalKey} tidak ada di kontrak kanonik`);
      }

      const actual =
        typeof entry === 'function'
          ? (entry as unknown as (arg: string | number) => string)(mirror.sample as string | number)
          : entry;
      expect(actual).toBe(renderCanonical(template, mirror.sample));
    },
  );

  it('setiap entry tabel API web punya baris mirror', () => {
    const webKeys = Object.entries(API).flatMap(([group, entries]) =>
      typeof entries === 'string'
        ? [group]
        : Object.keys(entries).map((key) => `${group}.${key}`),
    );
    expect(webKeys.sort()).toEqual(Object.keys(ROUTE_MIRRORS).sort());
  });
});

describe('parseErrorEnvelope', () => {
  it('extracts the backend {message, code} envelope fields', () => {
    expect(
      parseErrorEnvelope({ message: 'Sesi berakhir', code: 'SESSION_DEAD' }),
    ).toEqual({ message: 'Sesi berakhir', code: 'SESSION_DEAD' });
  });

  it('tolerates missing / non-object bodies', () => {
    expect(parseErrorEnvelope(undefined)).toEqual({});
    expect(parseErrorEnvelope('Gateway timeout')).toEqual({});
    expect(parseErrorEnvelope(null)).toEqual({});
  });

  it('exposes the canonical backend code strings', () => {
    expect(BACKEND_ERROR_CODES.KULON_STALE).toBe('KULON_STALE');
    expect(BACKEND_ERROR_CODES.SIAP_STALE).toBe('SIAP_STALE');
    expect(BACKEND_ERROR_CODES.INVALID_TOKEN).toBe('INVALID_TOKEN');
    expect(BACKEND_ERROR_CODES.SESSION_DEAD).toBe('SESSION_DEAD');
    expect(BACKEND_ERROR_CODES.INVALID_CODE).toBe('INVALID_CODE');
    expect(BACKEND_ERROR_CODES.EXPIRED_CODE).toBe('EXPIRED_CODE');
  });
});

describe('isServiceSessionPath', () => {
  it('recognizes upstream-scraped routes whose 401 keeps the JWT', () => {
    expect(isServiceSessionPath('/api/kulon/assignments')).toBe(true);
    expect(isServiceSessionPath('/api/siap/profile')).toBe(true);
    expect(isServiceSessionPath('/api/auth/me')).toBe(false);
    expect(isServiceSessionPath('/api/auth/refresh')).toBe(false);
  });
});

describe('isServiceStale', () => {
  // The backend's JwtAuthGuard and StaleUpstreamError BOTH emit a bare 401
  // { message } with no code, so a service-path 401 cannot be classified from
  // the envelope alone — the interceptor must probe refresh instead. This
  // helper keeps route-family fallback for the no-code case.
  it('an explicit upstream-stale code wins over the route family', () => {
    expect(isServiceStale('/api/auth/me', 'KULON_STALE')).toBe(true);
    expect(isServiceStale('/api/dashboard', 'SIAP_STALE')).toBe(true);
  });

  it('without a code, falls back to the route family (legacy behavior)', () => {
    expect(isServiceStale('/api/kulon/assignments')).toBe(true);
    expect(isServiceStale('/api/siap/profile')).toBe(true);
    expect(isServiceStale('/api/auth/me')).toBe(false);
    expect(isServiceStale('/api/dashboard')).toBe(false);
  });
});
