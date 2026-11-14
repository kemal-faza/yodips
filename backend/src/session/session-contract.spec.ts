import 'reflect-metadata';
import {
  CLIENT_ID_RE,
  LEGACY_CLIENT_ID,
  isClientId,
  isSessionRef,
  isStoredClientId,
} from './session-contract';

const GEN = 'a'.repeat(32);

describe('clientId contract', () => {
  it('accepts UUID-like and compact IDs', () => {
    expect(isClientId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(CLIENT_ID_RE.test('abcdefgh')).toBe(true);
    expect(isClientId('A_b-1234')).toBe(false); // underscore is not allowed
  });

  it('rejects malformed IDs and the reserved legacy value from clients', () => {
    for (const value of ['', 'short', 'bad:id', 'has space', 'a'.repeat(65)]) {
      expect(isClientId(value)).toBe(false);
    }
    expect(isClientId(LEGACY_CLIENT_ID)).toBe(false);
    expect(isStoredClientId(LEGACY_CLIENT_ID)).toBe(true);
  });

  it('requires clientId in a SessionRef', () => {
    expect(isSessionRef({ sub: '24060121130000', sessionGeneration: GEN })).toBe(false);
    expect(
      isSessionRef({ sub: '24060121130000', clientId: 'abcdefgh', sessionGeneration: GEN }),
    ).toBe(true);
    expect(
      isSessionRef({ sub: '24060121130000', clientId: LEGACY_CLIENT_ID, sessionGeneration: GEN }),
    ).toBe(true);
  });
});
