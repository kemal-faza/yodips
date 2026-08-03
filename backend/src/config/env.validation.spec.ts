import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('returns validated config when all required vars present', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: 'test-secret',
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      PORT: '3000',
    });
    expect(cfg.SSO_BASE_URL).toBe('https://sso.undip.ac.id');
    expect(cfg.PORT).toBe(3000);
  });

  it('applies defaults for optional fields', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: 'test-secret',
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
    });
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.JWT_EXPIRES_IN).toBe('12h');
    expect(cfg.SSO_LOGIN_PATH).toBe('/sso/auth_v2');
  });
});