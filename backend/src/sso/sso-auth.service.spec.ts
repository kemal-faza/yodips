import 'reflect-metadata';
import { SSOAuthService } from './sso-auth.service';
import { SSOTicketService } from './ticket.service';

describe('SSOAuthService', () => {
  let svc: SSOAuthService;
  const baseUrl = 'https://sso.undip.ac.id';

  beforeEach(() => {
    svc = new SSOAuthService(new SSOTicketService());
    global.fetch = jest.fn();
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('extracts csrf token from login page', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () =>
        `<input type="hidden" name="csrf_sso" value="abc123">`,
    });
    const token = await svc.getCsrfToken(baseUrl);
    expect(token).toBe('abc123');
  });

  it('returns session cookie + redirect url from login', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<input type="hidden" name="csrf_sso" value="csrf123">`,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: new Headers({
          'set-cookie': 'ci_session_sso=xyz; Path=/',
          location: '/pages/dashboard',
        }),
        text: async () => '',
      });
    const { cookie, redirectUrl } = await svc.login(baseUrl, 'n2m', 'pass');
    expect(cookie).toContain('ci_session_sso=xyz');
    expect(redirectUrl).toContain('dashboard');
  });

  it('throws when login returns no session cookie', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<input type="hidden" name="csrf_sso" value="abc">`,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ location: '/auth/user/login' }),
        text: async () => '',
      });
    await expect(svc.login(baseUrl, 'n2m', 'wrong')).rejects.toThrow(
      'Login failed',
    );
  });

  it('generates a new ticket via ticket service', () => {
    const t = svc.newTicket();
    expect(Buffer.from(t, 'base64').toString()).toMatch(/^\d+$/);
  });
});