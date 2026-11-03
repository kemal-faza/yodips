import { describe, expect, it } from 'vitest';
import { extractPairCode, normalizePairCode, pairErrorMessage } from './pair-code';

describe('normalizePairCode', () => {
  it('uppercases, strips separators and maps confusables', () => {
    expect(normalizePairCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizePairCode('o0i1l')).toBe('00111');
  });

  it('drops characters outside the Crockford alphabet and truncates to 8', () => {
    expect(normalizePairCode('ab!cd@23456')).toBe('ABCD2345');
    expect(normalizePairCode('ABCD2345XYZ')).toBe('ABCD2345');
  });

  it('returns empty for an empty input', () => {
    expect(normalizePairCode('')).toBe('');
  });
});

describe('extractPairCode', () => {
  it('accepts a raw code', () => {
    expect(extractPairCode('abcd-2345')).toBe('ABCD2345');
  });

  it('extracts from an absolute and a relative URL', () => {
    expect(extractPairCode('https://sso.crunchy.my.id/login?pair=ABCD2345')).toBe('ABCD2345');
    expect(extractPairCode('/login?pair=abcd2345&utm=x')).toBe('ABCD2345');
  });

  it('rejects a URL without a pair parameter', () => {
    expect(extractPairCode('https://sso.crunchy.my.id/login')).toBeNull();
  });

  it('rejects a code with the wrong length', () => {
    expect(extractPairCode('ABCD')).toBeNull();
  });
});

describe('pairErrorMessage', () => {
  it('maps the pairing error codes and statuses', () => {
    expect(pairErrorMessage({ response: { data: { code: 'INVALID_CODE' } } })).toContain('tidak valid');
    expect(pairErrorMessage({ response: { data: { code: 'EXPIRED_CODE' } } })).toContain('kedaluwarsa');
    expect(pairErrorMessage({ response: { status: 409 } })).toContain('perangkat sumber');
    expect(pairErrorMessage({ response: { status: 429 } })).toContain('Tunggu');
    expect(pairErrorMessage(new Error('boom'))).toContain('Tidak bisa menghubungi server');
  });
});
