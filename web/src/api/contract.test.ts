import { describe, expect, it } from 'vitest';
import {
  API,
  BACKEND_ERROR_CODES,
  buildSsoTicket,
  isServiceSessionPath,
  parseErrorEnvelope,
} from './contract';

describe('API paths', () => {
  it('mirrors the backend route table', () => {
    expect(API.auth.me).toBe('/api/auth/me');
    expect(API.auth.refresh).toBe('/api/auth/refresh');
    expect(API.kulon.courses).toBe('/api/kulon/courses');
    expect(API.kulon.assignmentDetail(42)).toBe('/api/kulon/assignments/42/detail');
    expect(API.siap.kehadiran('37')).toBe('/api/siap/kehadiran/37');
  });

  it('mendaftarkan route pairing + kode INVALID_CODE', () => {
    expect(API.auth.pairRequest).toBe('/api/auth/pair/request');
    expect(API.auth.pairConsume).toBe('/api/auth/pair/consume');
    expect(BACKEND_ERROR_CODES.INVALID_CODE).toBe('INVALID_CODE');
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

describe('buildSsoTicket', () => {
  it('is base64 of the unix-second timestamp (backend SSOTicketService algorithm)', () => {
    // btoa("1756000000") — pinned so drift vs extension/mobile breaks THIS test.
    expect(buildSsoTicket(1_756_000_000)).toBe(btoa('1756000000'));
    expect(buildSsoTicket(1_756_000_000)).toBe('MTc1NjAwMDAwMA==');
  });
});

describe('API.siap lecturers path (kontrak layar mobile)', () => {
  it('mendaftarkan /api/siap/lecturers', () => {
    expect(API.siap.lecturers).toBe('/api/siap/lecturers');
  });
});
