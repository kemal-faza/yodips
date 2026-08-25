import { describe, expect, it } from 'vitest';
import { extractPairCode, normalizePairingInput, pairErrorMessage } from './pairing';

describe('normalizePairingInput', () => {
  it('uppercase, buang spasi/dash, map huruf ambigu', () => {
    expect(normalizePairingInput('ab-cd efgh')).toBe('ABCDEFGH');
    expect(normalizePairingInput('oi1l')).toBe('0111');
  });
});

describe('extractPairCode', () => {
  it('mengambil param pair dari URL hasil scan', () => {
    expect(extractPairCode('https://sso.crunchy.my.id/login?pair=ABCD2345')).toBe('ABCD2345');
  });

  it('relative path (FRONTEND_BASE_URL kosong → qrUrl relatif) tetap ter-parse', () => {
    expect(extractPairCode('/login?pair=ABCD2345')).toBe('ABCD2345');
  });

  it('query-only tanpa path juga ter-parse', () => {
    expect(extractPairCode('?pair=ABCD2345')).toBe('ABCD2345');
  });

  it('menerima kode polos (dinormalisasi)', () => {
    expect(extractPairCode('abcd-2345')).toBe('ABCD2345');
  });

  it('null bila bukan kode 8-char valid', () => {
    expect(extractPairCode('https://contoh.com/lain?x=1')).toBeNull();
    expect(extractPairCode('/login?pair=SHORT')).toBeNull();
    expect(extractPairCode('SHORT')).toBeNull();
    expect(extractPairCode('')).toBeNull();
  });
});

describe('pairErrorMessage', () => {
  it('400 + EXPIRED_CODE → pesan kedaluwarsa spesifik', () => {
    expect(pairErrorMessage(400, 'EXPIRED_CODE')).toContain('kedaluwarsa');
    expect(pairErrorMessage(400, 'EXPIRED_CODE')).not.toContain('tidak valid');
  });

  it('400 tanpa kode (INVALID_CODE) → pesan generik tidak-valid', () => {
    expect(pairErrorMessage(400)).toContain('tidak valid');
    expect(pairErrorMessage(400, 'INVALID_CODE')).toContain('tidak valid');
  });

  it('409 / 429 / fallback', () => {
    expect(pairErrorMessage(409)).toContain('perangkat lama');
    expect(pairErrorMessage(429)).toContain('Terlalu banyak');
    expect(pairErrorMessage(undefined)).toContain('Gagal pairing');
  });
});
