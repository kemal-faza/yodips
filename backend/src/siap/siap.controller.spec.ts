import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SiapController } from './siap.controller';
import { SiapService } from './siap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * After the upstream-session consolidation the controller is a thin router:
 * it resolves nothing but `sub`, validates input, and delegates. Session
 * resolution + stale behaviour live in siap.service / siap-upstream specs.
 */
describe('SiapController', () => {
  let controller: SiapController;
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

  it('routes profile by sub only', async () => {
    mockSiap.getProfile.mockResolvedValue({ nama: 'Budi' });
    await expect(
      controller.getProfile({ user: { sub: 'u1' } }),
    ).resolves.toEqual({ nama: 'Budi' });
    expect(mockSiap.getProfile).toHaveBeenCalledWith('u1');
  });

  it('routes lecturers by sub only', async () => {
    mockSiap.getLecturers.mockResolvedValue([
      { kode: 'MIK1624105', dosen: 'Dr. X' },
    ]);
    await expect(
      controller.getLecturers({ user: { sub: 'u1' } }),
    ).resolves.toEqual([{ kode: 'MIK1624105', dosen: 'Dr. X' }]);
  });

  it('routes jadwal by sub only', async () => {
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
      controller.getJadwal({ user: { sub: 'u1' } }),
    ).resolves.toHaveLength(1);
  });

  it('validates kehadiran id (numeric only) and routes by sub', async () => {
    await expect(
      controller.getKehadiran('bukan-angka', { user: { sub: 'u1' } }),
    ).rejects.toMatchObject({ status: 400 });
    mockSiap.getKehadiran.mockResolvedValue({ pertemuanId: '3747941' });
    await expect(
      controller.getKehadiran('3747941', { user: { sub: 'u1' } }),
    ).resolves.toMatchObject({ pertemuanId: '3747941' });
    expect(mockSiap.getKehadiran).toHaveBeenCalledWith('u1', '3747941');
  });

  it('proxies a QR token to markKehadiran when present', async () => {
    mockSiap.markKehadiran.mockResolvedValue({
      status: 'success',
      message: 'ok',
    });
    await expect(
      controller.markKehadiran({ user: { sub: 'u1' } }, { token: 'qrcode123' }),
    ).resolves.toEqual({ status: 'success', message: 'ok' });
    expect(mockSiap.markKehadiran).toHaveBeenCalledWith('u1', 'qrcode123');
  });

  it('throws 400 when token QR missing', async () => {
    await expect(
      controller.markKehadiran({ user: { sub: 'u1' } }, {}),
    ).rejects.toMatchObject({ status: 400 });
  });
});
