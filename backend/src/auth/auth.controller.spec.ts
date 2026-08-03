import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = { login: jest.fn(), me: jest.fn(), getMicrosoftAuthUrl: jest.fn(), handleMicrosoftCallback: jest.fn(), captureSsoSession: jest.fn() };

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

  it('microsoft login returns auth url', async () => {
    authService.getMicrosoftAuthUrl.mockResolvedValue({ authUrl: 'https://login.microsoftonline.com/...' });
    const res = await controller.microsoftLogin();
    expect(res.authUrl).toContain('login.microsoftonline.com');
  });

  it('microsoft callback returns access token', async () => {
    authService.handleMicrosoftCallback.mockResolvedValue({ accessToken: 'jwt2', msSession: 'cookie' });
    const res = await controller.microsoftCallback('authcode');
    expect(res.accessToken).toBe('jwt2');
  });

  it('capture sso session returns access token', async () => {
    authService.captureSsoSession.mockResolvedValue({ accessToken: 'jwt3', hasSso: true, hasMicrosoft: true });
    const res = await controller.captureSsoSession();
    expect(res.accessToken).toBe('jwt3');
    expect(res.hasSso).toBe(true);
  });
});