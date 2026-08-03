import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = { login: jest.fn(), me: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AuthController);
  });

  it('login returns access token', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'jwt',
      ssoSession: 'cookie',
      redirectUrl: '/dashboard',
    });
    const res = await controller.login({
      identity: 'n2m',
      password: 'x',
    } as any);
    expect(res.accessToken).toBe('jwt');
  });

  it('me returns authenticated user', async () => {
    authService.me.mockResolvedValue({ sub: 'n2m', authenticated: true });
    const res = await controller.me({ user: { sub: 'n2m' } } as any);
    expect(res.authenticated).toBe(true);
  });
});