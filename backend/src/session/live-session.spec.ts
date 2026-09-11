import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '../common/error-codes';
import { readLiveSession, sessionDead } from './live-session';
import type { CapturedSession } from './session-contract';
import type { SessionStore } from './session-store';

const GEN_A = 'a'.repeat(32);
const GEN_B = 'b'.repeat(32);

function session(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return {
    identity: 'U1',
    ssoCookie: 'ci_session_sso=SSO',
    microsoftCookie: '',
    kulonCookie: 'MoodleSession=A',
    siapCookie: '',
    capturedAt: 1_000,
    sessionGeneration: GEN_A,
    ...overrides,
  };
}

function fakeStore(getIfGeneration: jest.Mock): SessionStore {
  return { getIfGeneration } as unknown as SessionStore;
}

describe('readLiveSession (one guarded read seam)', () => {
  it('returns null for a malformed ref without touching the store', async () => {
    const getIfGeneration = jest.fn();
    const store = fakeStore(getIfGeneration);
    for (const bad of [
      null,
      undefined,
      { sub: 'U1', sessionGeneration: 'not-hex' },
      { sub: '', sessionGeneration: GEN_A },
      { sub: 'U1' },
    ]) {
      await expect(readLiveSession(store, bad)).resolves.toBeNull();
    }
    expect(getIfGeneration).not.toHaveBeenCalled();
  });

  it('reads the exact-generation record and returns the live session', async () => {
    const live = session();
    const getIfGeneration = jest.fn().mockResolvedValue(live);
    const store = fakeStore(getIfGeneration);
    await expect(
      readLiveSession(store, { sub: 'U1', sessionGeneration: GEN_A }),
    ).resolves.toBe(live);
    expect(getIfGeneration).toHaveBeenCalledWith('U1', GEN_A);
  });

  it('returns null when the store has no live record for that generation', async () => {
    const getIfGeneration = jest.fn().mockResolvedValue(null);
    await expect(
      readLiveSession(fakeStore(getIfGeneration), { sub: 'U1', sessionGeneration: GEN_A }),
    ).resolves.toBeNull();
  });

  it('trusts getIfGeneration as the generation authority (no second compare)', async () => {
    // The store port guarantees null-on-mismatch. A reader must NOT rebuild the
    // compare: whatever a conforming store returns is the live session.
    const record = session({ sessionGeneration: GEN_B });
    const getIfGeneration = jest.fn().mockResolvedValue(record);
    await expect(
      readLiveSession(fakeStore(getIfGeneration), { sub: 'U1', sessionGeneration: GEN_A }),
    ).resolves.toBe(record);
  });
});

describe('sessionDead (one SESSION_DEAD factory)', () => {
  it('builds the canonical 401 with the existing message and ERROR_CODES.SESSION_DEAD', () => {
    const err = sessionDead();
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(err.getResponse()).toEqual({
      message: 'Sesi berakhir. Silakan login ulang',
      code: ERROR_CODES.SESSION_DEAD,
    });
  });

  it('allows a boundary to override the message/status while keeping the code', () => {
    const err = sessionDead({
      status: HttpStatus.CONFLICT,
      message: 'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru',
    });
    expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(err.getResponse()).toEqual({
      message: 'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru',
      code: ERROR_CODES.SESSION_DEAD,
    });
  });
});
