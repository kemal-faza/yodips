import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { SiapController } from './siap.controller';
import { SiapService } from './siap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionStore } from '../session/session-store';

describe('SiapController', () => {
  let controller: SiapController;
  const mockSiap = { checkSessionValid: jest.fn(), getProfile: jest.fn() };
  const mockStore = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [SiapController],
      providers: [
        { provide: SiapService, useValue: mockSiap },
        { provide: SessionStore, useValue: mockStore },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(SiapController);
  });

  it('throws 401 when no siapCookie', async () => {
    mockStore.get.mockResolvedValue({ siapCookie: '' });
    await expect(controller.getProfile({ user: { sub: 'n' } })).rejects.toBeInstanceOf(HttpException);
  });

  it('returns profile when siapCookie present', async () => {
    mockStore.get.mockResolvedValue({ siapCookie: 'ci_session_x=K' });
    mockSiap.getProfile.mockResolvedValue({ nama: 'Budi' });
    await expect(controller.getProfile({ user: { sub: 'n' } })).resolves.toEqual({ nama: 'Budi' });
  });
});