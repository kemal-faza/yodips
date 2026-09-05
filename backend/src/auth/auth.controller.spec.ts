import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = { login: jest.fn(), me: jest.fn(), getMicrosoftAuthUrl: jest.fn(), handleMicrosoftCallback: jest.fn(), captureSsoSession: jest.fn(), refresh: jest.fn(), logout: jest.fn() };

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

  it('session handoff delegates to service', async () => {
    authService.handleSessionHandoff = jest.fn().mockResolvedValue({
      accessToken: 'jwt4', capturedAt: 0, reused: false, hasSso: true, hasMicrosoft: true, hasKulon: true,
    });
    const res = await controller.sessionHandoff({ kulonCookie: 'MoodleSession=K' } as any);
    expect(res.accessToken).toBe('jwt4');
    expect(authService.handleSessionHandoff).toHaveBeenCalled();
  });

  it('refresh extracts the Bearer token and delegates to the service', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'new-jwt' });
    const res = await controller.refresh({
      headers: { authorization: 'Bearer abc.def.ghi' },
    } as any);
    expect(res.accessToken).toBe('new-jwt');
    expect(authService.refresh).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('refresh rejects a missing Authorization header', async () => {
    await expect(controller.refresh({ headers: {} } as any)).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
  });

  it('logout extracts the Bearer token and delegates to the service', async () => {
    authService.logout.mockResolvedValue({ ok: true });
    const res = await controller.logout({
      headers: { authorization: 'Bearer abc.def.ghi' },
    } as any);
    expect(res).toEqual({ ok: true });
    expect(authService.logout).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('logout rejects a missing Authorization header with INVALID_TOKEN', async () => {
    await expect(controller.logout({ headers: {} } as any)).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
  });
});