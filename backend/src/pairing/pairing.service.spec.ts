import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionStore } from '../session/session-store';
import {
  LEGACY_CLIENT_ID,
  type CapturedSession,
} from '../session/session-contract';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { PairingStore } from './pairing-store';
import { InMemoryPairingStore } from './pairing-store';
import { hashPairingCode } from './pairing-code';
import { PairingService } from './pairing.service';

describe('PairingService', () => {
  let service: PairingService;
  let pairingStore: InMemoryPairingStore;
  let sessionStore: InMemorySessionStore;
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-pair') };
  const GEN = 'a'.repeat(32);
  const PAIR_CLIENT = 'pair-client';

  const sessionFor = (
    sub: string,
    clientId: string,
    generation: string = GEN,
    over: Partial<CapturedSession> = {},
  ): CapturedSession => ({
    identity: sub,
    clientId,
    ssoCookie: 'sso',
    microsoftCookie: '',
    kulonCookie: 'k',
    siapCookie: 's',
    capturedAt: Date.now(),
    sessionGeneration: generation,
    ...over,
  });

  /** The P1 default device for a user (`client-a`). */
  const liveSession = (sub: string, over: Partial<CapturedSession> = {}) =>
    sessionFor(sub, 'client-a', GEN, over);

  const refFor = (sub: string, generation: string = GEN, clientId = 'client-a') => ({
    sub,
    clientId,
    sessionGeneration: generation,
  });

  const findPaired = async (sub: string) =>
    (await sessionStore.listBySub(sub)).find((s) => s.clientId === PAIR_CLIENT);

  let legacyEnabled = true;
  const defaultConfigGet = (key: string) => {
    if (key === 'FRONTEND_BASE_URL') return 'https://app.example';
    if (key === 'SESSION_LEGACY_CLIENT_ENABLED') return legacyEnabled;
    return undefined;
  };
  const config = { get: jest.fn(defaultConfigGet) };

  beforeEach(async () => {
    jest.clearAllMocks();
    legacyEnabled = true;
    config.get.mockImplementation(defaultConfigGet);
    pairingStore = new InMemoryPairingStore();
    sessionStore = new InMemorySessionStore(60_000);
    const module = await Test.createTestingModule({
      providers: [
        PairingService,
        { provide: PairingStore, useValue: pairingStore },
        { provide: SessionStore, useValue: sessionStore },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(PairingService);
  });

  it('requestPairing menyimpan HASH (bukan kode) + clientId sumber, mengembalikan qrUrl + kode valid', async () => {
    await sessionStore.set(liveSession('NIM1'));
    const spySet = jest.spyOn(pairingStore, 'set');
    const res = await service.requestPairing(refFor('NIM1'));
    expect(res.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(res.qrUrl).toBe(`https://app.example/login?pair=${res.code}`);
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    const storedKey = spySet.mock.calls[0][0];
    expect(storedKey).not.toBe(res.code);
    expect(storedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(spySet.mock.calls[0][1]).toEqual({
      sub: 'NIM1',
      clientId: 'client-a',
      sessionGeneration: GEN,
      expiresAt: res.expiresAt,
    });
  });

  it('requestPairing menolak 401 SESSION_DEAD bila sesi mati', async () => {
    await expect(service.requestPairing(refFor('GHOST'))).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('requestPairing menolak 401 SESSION_DEAD bila generation tidak cocok dengan live record', async () => {
    await sessionStore.set(liveSession('NIM1', { sessionGeneration: 'b'.repeat(32) }));
    await expect(service.requestPairing(refFor('NIM1', 'a'.repeat(32)))).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('consume ternormalisasi (lowercase+dash+huruf ambigu) lalu mint JWT via=pair dengan clientId + generation BARU', async () => {
    const gen = 'd'.repeat(32);
    await sessionStore.set(liveSession('NIM1', { sessionGeneration: gen, siapCookie: '' }));
    // simpan via jalur service agar hash konsisten:
    const req = await service.requestPairing(refFor('NIM1', gen));
    const messy = req.code.toLowerCase().slice(0, 4) + '-' + req.code.slice(4);
    const res = await service.consume(messy, PAIR_CLIENT);
    const payload = (jwt.signAsync as jest.Mock).mock.calls[0][0];
    expect(payload).toEqual({
      sub: 'NIM1',
      clientId: PAIR_CLIENT,
      via: 'pair',
      sessionGeneration: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(payload.sessionGeneration).not.toBe(gen);
    expect(res).toEqual({ accessToken: 'jwt-pair', hasKulon: true, hasSiap: false });
  });

  it('consume after a replacement generation rejects 409 SESSION_DEAD and never mints (A)', async () => {
    const genOld = 'e'.repeat(32);
    const genNew = 'f'.repeat(32);
    await sessionStore.set(liveSession('NIM1', { sessionGeneration: genOld, siapCookie: '' }));
    const { code } = await service.requestPairing(refFor('NIM1', genOld));
    // Re-login replaces the live session before consume.
    await sessionStore.set(liveSession('NIM1', { sessionGeneration: genNew, kulonCookie: 'k-NEW', siapCookie: '' }));
    (jwt.signAsync as jest.Mock).mockClear();
    await expect(service.consume(code, PAIR_CLIENT)).rejects.toMatchObject({
      status: 409,
      response: { code: 'SESSION_DEAD' },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
    // Replacement survives (never cleared by the stale consume).
    const replacement = await sessionStore.getIfGeneration(refFor('NIM1', genNew));
    expect(replacement?.sessionGeneration).toBe(genNew);
    expect(await findPaired('NIM1')).toBeUndefined();
  });

  it('consume single-use: panggilan kedua 400 INVALID_CODE', async () => {
    await sessionStore.set(liveSession('NIM1'));
    const { code } = await service.requestPairing(refFor('NIM1'));
    await service.consume(code, PAIR_CLIENT);
    await expect(service.consume(code, PAIR_CLIENT)).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_CODE' },
    });
  });

  it('consume kode kedaluwarsa → 400 EXPIRED_CODE (dibedakan dari INVALID)', async () => {
    // TTL negatif → entri langsung kedaluwarsa saat dibuat.
    config.get.mockImplementation((key: string) =>
      key === 'PAIRING_TTL_MS' ? -1 : defaultConfigGet(key),
    );
    try {
      await sessionStore.set(liveSession('NIM1'));
      const { code } = await service.requestPairing(refFor('NIM1'));
      await expect(service.consume(code, PAIR_CLIENT)).rejects.toMatchObject({
        status: 400,
        response: { code: 'EXPIRED_CODE', message: 'Kode sudah kedaluwarsa. Minta kode baru.' },
      });
    } finally {
      config.get.mockImplementation(defaultConfigGet);
    }
  });

  it('consume kode sampah 400 INVALID_CODE', async () => {
    await expect(service.consume('ZZZZZZZZ', PAIR_CLIENT)).rejects.toMatchObject({ status: 400 });
    await expect(service.consume('', PAIR_CLIENT)).rejects.toMatchObject({ status: 400 });
  });

  it('consume kode sah tapi sesi sumber sudah mati 409 SESSION_DEAD', async () => {
    await sessionStore.set(liveSession('NIM2'));
    const { code } = await service.requestPairing(refFor('NIM2'));
    await sessionStore.clearIfGeneration(refFor('NIM2')); // sesi mati setelah kode dibuat
    await expect(service.consume(code, PAIR_CLIENT)).rejects.toMatchObject({
      status: 409,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('requestPairing menolak legacy tanpa generation dengan 401 SESSION_DEAD', async () => {
    await sessionStore.set({
      identity: 'NIM-LEGACY',
      clientId: 'client-a',
      kulonCookie: 'k',
      siapCookie: 's',
      capturedAt: Date.now(),
    } as any);
    await expect(service.requestPairing(refFor('NIM-LEGACY'))).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('consume menolak legacy tanpa generation dengan 409 SESSION_DEAD', async () => {
    await sessionStore.set(liveSession('NIM-LEGACY2'));
    const { code } = await service.requestPairing(refFor('NIM-LEGACY2'));
    // Session rotates to legacy (generation stripped) before consume.
    await sessionStore.set({
      identity: 'NIM-LEGACY2',
      clientId: 'client-a',
      ssoCookie: '',
      microsoftCookie: '',
      kulonCookie: 'k',
      siapCookie: 's',
      capturedAt: Date.now(),
    } as any);
    await expect(service.consume(code, PAIR_CLIENT)).rejects.toMatchObject({
      status: 409,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('creates an independent session for the paired device and leaves the source alive', async () => {
    const source = sessionFor('NIM1', 'source-client', 'c'.repeat(32));
    await sessionStore.set(source);
    const { code } = await service.requestPairing(
      refFor('NIM1', source.sessionGeneration, 'source-client'),
    );

    const result = await service.consume(code, PAIR_CLIENT);

    const sourceAfter = await sessionStore.getIfGeneration(
      refFor('NIM1', source.sessionGeneration, 'source-client'),
    );
    const paired = await findPaired('NIM1');
    expect(sourceAfter).toEqual(source);
    expect(paired).toEqual(
      expect.objectContaining({
        identity: 'NIM1',
        clientId: PAIR_CLIENT,
        kulonCookie: source.kulonCookie,
        siapCookie: source.siapCookie,
      }),
    );
    expect(paired!.sessionGeneration).not.toBe(source.sessionGeneration);
    expect(await sessionStore.getIfGeneration(refFor('NIM1', paired!.sessionGeneration, PAIR_CLIENT))).toEqual(paired);
    expect(result.accessToken).toBe('jwt-pair');
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'NIM1',
      clientId: PAIR_CLIENT,
      via: 'pair',
      sessionGeneration: paired!.sessionGeneration,
    });
  });

  it('evicts the oldest device when the cap is reached', async () => {
    const base = Date.now();
    for (let i = 0; i < 10; i++) {
      await sessionStore.set(
        sessionFor('NIM1', `client-${i}`, GEN, { capturedAt: base + i }),
      );
    }
    const { code } = await service.requestPairing(refFor('NIM1', GEN, 'client-9'));

    await service.consume(code, PAIR_CLIENT);

    const live = await sessionStore.listBySub('NIM1');
    expect(live).toHaveLength(10);
    expect(live.some((s) => s.clientId === 'client-0')).toBe(false);
    expect(live.some((s) => s.clientId === 'client-9')).toBe(true);
    expect(live.some((s) => s.clientId === PAIR_CLIENT)).toBe(true);
  });

  it('maps an OLD PairingRecord without clientId to the legacy device while the flag is on', async () => {
    const code = 'ABCD1234';
    await sessionStore.set(sessionFor('NIM1', LEGACY_CLIENT_ID));
    await pairingStore.set(
      hashPairingCode(code),
      {
        sub: 'NIM1',
        sessionGeneration: GEN,
        expiresAt: Date.now() + 600_000,
      } as any,
      600_000,
    );

    const res = await service.consume(code, PAIR_CLIENT);

    expect(res.accessToken).toBe('jwt-pair');
    const paired = await findPaired('NIM1');
    expect(paired).toEqual(expect.objectContaining({ clientId: PAIR_CLIENT }));
    expect(paired!.sessionGeneration).not.toBe(GEN);
  });

  it('treats the same OLD PairingRecord as PAIRING_DEAD when the legacy flag is off', async () => {
    legacyEnabled = false;
    const code = 'ABCD1234';
    await sessionStore.set(sessionFor('NIM1', LEGACY_CLIENT_ID));
    await pairingStore.set(
      hashPairingCode(code),
      {
        sub: 'NIM1',
        sessionGeneration: GEN,
        expiresAt: Date.now() + 600_000,
      } as any,
      600_000,
    );

    await expect(service.consume(code, PAIR_CLIENT)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'SESSION_DEAD',
        message:
          'Sesi di perangkat lama sudah berakhir. Login ulang di sana, lalu minta kode baru',
      },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('a malformed newClientId never consumes the code (still usable afterwards)', async () => {
    await sessionStore.set(liveSession('NIM1'));
    const { code } = await service.requestPairing(refFor('NIM1'));

    for (const bad of ['bad id', 'short', 'under_score', LEGACY_CLIENT_ID]) {
      await expect(service.consume(code, bad)).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_CLIENT_ID' },
      });
    }
    // The code was never burned by the rejected attempts.
    await expect(service.consume(code, PAIR_CLIENT)).resolves.toEqual({
      accessToken: 'jwt-pair',
      hasKulon: true,
      hasSiap: true,
    });
  });

  it('missing newClientId requires CLIENT_ID_REQUIRED when the legacy flag is off (code not burned)', async () => {
    legacyEnabled = false;
    await sessionStore.set(liveSession('NIM1'));
    const { code } = await service.requestPairing(refFor('NIM1'));

    for (const missing of [undefined, '']) {
      await expect(service.consume(code, missing)).rejects.toMatchObject({
        status: 400,
        response: { code: 'CLIENT_ID_REQUIRED' },
      });
    }
    await expect(service.consume(code, PAIR_CLIENT)).resolves.toMatchObject({
      accessToken: 'jwt-pair',
    });
  });

  it('missing newClientId falls back to the legacy device while the flag is on', async () => {
    await sessionStore.set(liveSession('NIM1'));
    const { code } = await service.requestPairing(refFor('NIM1'));

    await service.consume(code);

    const paired = (await sessionStore.listBySub('NIM1')).find(
      (s) => s.clientId === LEGACY_CLIENT_ID,
    );
    expect(paired).toBeDefined();
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'NIM1', clientId: LEGACY_CLIENT_ID, via: 'pair' }),
    );
  });

  describe('statusFor (polling web: pending/consumed/invalid)', () => {
    it('pending + expiresAt utk pemilik kode yang masih hidup', async () => {
      await sessionStore.set(liveSession('NIM1'));
      const { code, expiresAt } = await service.requestPairing(refFor('NIM1'));
      await expect(service.statusFor('NIM1', code)).resolves.toEqual({
        status: 'pending',
        expiresAt,
      });
    });

    it('consumed setelah dipakai (pemilik), tanpa expiresAt', async () => {
      await sessionStore.set(liveSession('NIM1'));
      const { code } = await service.requestPairing(refFor('NIM1'));
      await service.consume(code, PAIR_CLIENT);
      await expect(service.statusFor('NIM1', code)).resolves.toEqual({
        status: 'consumed',
      });
    });

    it('kode milik sub lain → invalid (tanpa bocor keberadaan)', async () => {
      await sessionStore.set(liveSession('NIM1'));
      const { code } = await service.requestPairing(refFor('NIM1'));
      await expect(service.statusFor('NIM2', code)).resolves.toEqual({
        status: 'invalid',
      });
      // consumed oleh pemilik tetap tak terlihat sub lain:
      await service.consume(code, PAIR_CLIENT);
      await expect(service.statusFor('NIM2', code)).resolves.toEqual({
        status: 'invalid',
      });
    });

    it('input kosong/sampah → invalid tanpa error', async () => {
      await expect(service.statusFor('NIM1', '')).resolves.toEqual({
        status: 'invalid',
      });
      await expect(service.statusFor('NIM1', 'ZZZZZZZZ')).resolves.toEqual({
        status: 'invalid',
      });
    });

    it('kode kedaluwarsa tanpa consume → invalid (bukan pending)', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'PAIRING_TTL_MS' ? -1 : defaultConfigGet(key),
      );
      try {
        await sessionStore.set(liveSession('NIM1'));
        const { code } = await service.requestPairing(refFor('NIM1'));
        await expect(service.statusFor('NIM1', code)).resolves.toEqual({
          status: 'invalid',
        });
      } finally {
        config.get.mockImplementation(defaultConfigGet);
      }
    });

    it('normalisasi input (lowercase/dash) diterima', async () => {
      await sessionStore.set(liveSession('NIM1'));
      const { code } = await service.requestPairing(refFor('NIM1'));
      const messy = code.toLowerCase().slice(0, 4) + '-' + code.slice(4);
      await expect(service.statusFor('NIM1', messy)).resolves.toMatchObject({
        status: 'pending',
      });
    });
  });
});
