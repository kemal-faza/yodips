import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionStore } from '../session/session-store';
import { PairingStore } from './pairing-store';
import { InMemoryPairingStore } from './pairing-store';
import { PairingService } from './pairing.service';

describe('PairingService', () => {
  let service: PairingService;
  let pairingStore: InMemoryPairingStore;
  let sessionStore: Map<string, any>;
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-pair') };
  const config = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_BASE_URL' ? 'https://app.example' : undefined,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pairingStore = new InMemoryPairingStore();
    sessionStore = new Map();
    const module = await Test.createTestingModule({
      providers: [
        PairingService,
        { provide: PairingStore, useValue: pairingStore },
        { provide: SessionStore, useValue: { get: (sub: string) => Promise.resolve(sessionStore.get(sub) ?? null) } },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(PairingService);
  });

  it('requestPairing menyimpan HASH (bukan kode), mengembalikan qrUrl + kode valid', async () => {
    sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
    const spySet = jest.spyOn(pairingStore, 'set');
    const res = await service.requestPairing('NIM1');
    expect(res.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(res.qrUrl).toBe(`https://app.example/login?pair=${res.code}`);
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    const storedKey = spySet.mock.calls[0][0];
    expect(storedKey).not.toBe(res.code);
    expect(storedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(spySet.mock.calls[0][1]).toEqual({ sub: 'NIM1', expiresAt: res.expiresAt });
  });

  it('requestPairing menolak 401 SESSION_DEAD bila sesi mati', async () => {
    await expect(service.requestPairing('GHOST')).rejects.toMatchObject({
      status: 401,
      response: { code: 'SESSION_DEAD' },
    });
  });

  it('consume ternormalisasi (lowercase+dash+huruf ambigu) lalu mint JWT via=pair', async () => {
    sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: '' });
    // simpan via jalur service agar hash konsisten:
    const req = await service.requestPairing('NIM1');
    const messy = req.code.toLowerCase().slice(0, 4) + '-' + req.code.slice(4);
    const res = await service.consume(messy);
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'NIM1', via: 'pair' });
    expect(res).toEqual({ accessToken: 'jwt-pair', hasKulon: true, hasSiap: false });
  });

  it('consume single-use: panggilan kedua 400 INVALID_CODE', async () => {
    sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
    const { code } = await service.requestPairing('NIM1');
    await service.consume(code);
    await expect(service.consume(code)).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_CODE' },
    });
  });

  it('consume kode kedaluwarsa → 400 EXPIRED_CODE (dibedakan dari INVALID)', async () => {
    const prev = config.get.getMockImplementation();
    // TTL negatif → entri langsung kedaluwarsa saat dibuat.
    config.get.mockImplementation(
      (key: string) => (key === 'PAIRING_TTL_MS' ? -1 : prev?.(key)),
    );
    try {
      sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
      const { code } = await service.requestPairing('NIM1');
      await expect(service.consume(code)).rejects.toMatchObject({
        status: 400,
        response: { code: 'EXPIRED_CODE', message: 'Kode sudah kedaluwarsa. Minta kode baru.' },
      });
    } finally {
      config.get.mockImplementation(prev as any);
    }
  });

  it('consume kode sampah 400 INVALID_CODE', async () => {
    await expect(service.consume('ZZZZZZZZ')).rejects.toMatchObject({ status: 400 });
    await expect(service.consume('')).rejects.toMatchObject({ status: 400 });
  });

  it('consume kode sah tapi sesi sumber sudah mati 409 SESSION_DEAD', async () => {
    sessionStore.set('NIM2', {});
    const { code } = await service.requestPairing('NIM2');
    sessionStore.delete('NIM2'); // sesi mati setelah kode dibuat
    await expect(service.consume(code)).rejects.toMatchObject({
      status: 409,
      response: { code: 'SESSION_DEAD' },
    });
  });

  describe('statusFor (polling web: pending/consumed/invalid)', () => {
    it('pending + expiresAt utk pemilik kode yang masih hidup', async () => {
      sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
      const { code, expiresAt } = await service.requestPairing('NIM1');
      await expect(service.statusFor('NIM1', code)).resolves.toEqual({
        status: 'pending',
        expiresAt,
      });
    });

    it('consumed setelah dipakai (pemilik), tanpa expiresAt', async () => {
      sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
      const { code } = await service.requestPairing('NIM1');
      await service.consume(code);
      await expect(service.statusFor('NIM1', code)).resolves.toEqual({
        status: 'consumed',
      });
    });

    it('kode milik sub lain → invalid (tanpa bocor keberadaan)', async () => {
      sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
      const { code } = await service.requestPairing('NIM1');
      await expect(service.statusFor('NIM2', code)).resolves.toEqual({
        status: 'invalid',
      });
      // consumed oleh pemilik tetap tak terlihat sub lain:
      await service.consume(code);
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
      const prev = config.get.getMockImplementation();
      config.get.mockImplementation(
        (key: string) => (key === 'PAIRING_TTL_MS' ? -1 : prev?.(key)),
      );
      try {
        sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
        const { code } = await service.requestPairing('NIM1');
        await expect(service.statusFor('NIM1', code)).resolves.toEqual({
          status: 'invalid',
        });
      } finally {
        config.get.mockImplementation(prev as any);
      }
    });

    it('normalisasi input (lowercase/dash) diterima', async () => {
      sessionStore.set('NIM1', { kulonCookie: 'k', siapCookie: 's' });
      const { code } = await service.requestPairing('NIM1');
      const messy = code.toLowerCase().slice(0, 4) + '-' + code.slice(4);
      await expect(service.statusFor('NIM1', messy)).resolves.toMatchObject({
        status: 'pending',
      });
    });
  });
});
