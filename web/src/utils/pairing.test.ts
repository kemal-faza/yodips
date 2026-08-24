import { describe, expect, it } from 'vitest';
import { extractPairCode, normalizePairingInput } from './pairing';

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

  it('menerima kode polos (dinormalisasi)', () => {
    expect(extractPairCode('abcd-2345')).toBe('ABCD2345');
  });

  it('null bila bukan kode 8-char valid', () => {
    expect(extractPairCode('https://contoh.com/lain?x=1')).toBeNull();
    expect(extractPairCode('SHORT')).toBeNull();
    expect(extractPairCode('')).toBeNull();
  });
});
