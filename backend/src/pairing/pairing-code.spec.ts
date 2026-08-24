import {
  PAIRING_CODE_LENGTH,
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
} from './pairing-code';

describe('PairingCode', () => {
  it('menghasilkan 8 char dari alfabet Crockford (tanpa I/L/O/U)', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/);
  });

  it('menghasilkan kode unik lintas 1000 draw', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generatePairingCode()));
    expect(set.size).toBe(1000);
  });

  it.each([
    ['abcd-1234', 'ABCD1234'],
    ['ab cd ef gh', 'ABCDEFGH'],
    ['oi1l0', '01110'],
  ])('normalisasi %s -> %s', (raw, expected) => {
    expect(normalizePairingCode(raw)).toBe(expected);
  });

  it('hash deterministik, hex 64, dan bukan plaintext', () => {
    expect(hashPairingCode('ABCD1234')).toBe(hashPairingCode('ABCD1234'));
    expect(hashPairingCode('ABCD1234')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode('ABCD1234')).not.toContain('ABCD');
  });
});
