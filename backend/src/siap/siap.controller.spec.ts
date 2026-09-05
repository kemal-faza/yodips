import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SiapController } from './siap.controller';
import { SiapService } from './siap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * After the generation-qualified consolidation the controller is a thin router:
 * it builds the exact SessionRef (sub + sessionGeneration), validates input,
 * and delegates. A missing generation never drops to sub-only — it is
 * 401 SESSION_DEAD. Session resolution + stale behaviour live in
 * siap.service / siap-upstream specs.
 */
describe('SiapController', () => {
  let controller: SiapController;
  const GEN = 'a'.repeat(32);
  const REF = { sub: 'u1', sessionGeneration: GEN };
  const user = { sub: 'u1', sessionGeneration: GEN };
  const mockSiap = {
    checkSessionValid: jest.fn(),
    getProfile: jest.fn(),
    getLecturers: jest.fn(),
    getJadwal: jest.fn(),
    getKehadiran: jest.fn(),
    markKehadiran: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [SiapController],
      providers: [{ provide: SiapService, useValue: mockSiap }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(SiapController);
  });

  it('routes profile by SessionRef', async () => {
    mockSiap.getProfile.mockResolvedValue({ nama: 'Budi' });
    await expect(
      controller.getProfile({ user } as any),
    ).resolves.toEqual({ nama: 'Budi' });
    expect(mockSiap.getProfile).toHaveBeenCalledWith(REF);
  });

  it('routes lecturers by SessionRef', async () => {
    mockSiap.getLecturers.mockResolvedValue([
      { kode: 'MIK1624105', dosen: 'Dr. X' },
    ]);
    await expect(
      controller.getLecturers({ user } as any),
    ).resolves.toEqual([{ kode: 'MIK1624105', dosen: 'Dr. X' }]);
  });

  it('routes jadwal by SessionRef', async () => {
    mockSiap.getJadwal.mockResolvedValue([
      {
        kode: 'MIK1624503',
        hari: 'senin',
        matakuliah: 'Sistem Informasi',
        ruang: 'A301',
        waktu: '09:40:00 s/d 12:10:00',
        sks: 3,
      },
    ]);
    await expect(
      controller.getJadwal({ user } as any),
    ).resolves.toHaveLength(1);
  });

  it('rejects 401 SESSION_DEAD without a generation (never drops to sub-only)', async () => {
    await expect(
      controller.getProfile({ user: { sub: 'u1' } } as any),
    ).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_DEAD' } });
    expect(mockSiap.getProfile).not.toHaveBeenCalled();
  });

  it('validates kehadiran id (numeric only) and routes by SessionRef', async () => {
    await expect(
      controller.getKehadiran('bukan-angka', { user } as any),
    ).rejects.toMatchObject({ status: 400 });
    mockSiap.getKehadiran.mockResolvedValue({ pertemuanId: '3747941' });
    await expect(
      controller.getKehadiran('3747941', { user } as any),
    ).resolves.toMatchObject({ pertemuanId: '3747941' });
    expect(mockSiap.getKehadiran).toHaveBeenCalledWith(REF, '3747941');
  });

  it('proxies a QR token to markKehadiran when present', async () => {
    mockSiap.markKehadiran.mockResolvedValue({
      status: 'success',
      message: 'ok',
    });
    await expect(
      controller.markKehadiran({ user } as any, { token: 'qrcode123' }),
    ).resolves.toEqual({ status: 'success', message: 'ok' });
    expect(mockSiap.markKehadiran).toHaveBeenCalledWith(REF, 'qrcode123');
  });

  it('throws 400 when token QR missing', async () => {
    await expect(
      controller.markKehadiran({ user } as any, {} as any),
    ).rejects.toMatchObject({ status: 400 });
  });
});
