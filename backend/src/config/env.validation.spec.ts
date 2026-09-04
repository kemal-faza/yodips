import 'reflect-metadata';
import { validateEnv } from './env.validation';

// Test fixture only — never a real credential. The inline allow keeps gitleaks
// from flagging the literal (same convention as SESSION_ENC_KEY below).
const TEST_JWT_SECRET = '0123456789abcdef0123456789abcdef'; // gitleaks:allow

describe('validateEnv', () => {
  it('returns validated config when all required vars present', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      PORT: '3000',
    });
    expect(cfg.SSO_BASE_URL).toBe('https://sso.undip.ac.id');
    expect(cfg.PORT).toBe(3000);
  });

  it('applies defaults for optional fields', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
    });
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.JWT_EXPIRES_IN).toBe('12h');
    expect(cfg.SSO_LOGIN_PATH).toBe('/sso/auth_v2');
  });

  it('defaults SSO_CAPTURE_TIMEOUT_MS to 180000 when absent', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
    });
    expect(cfg.SSO_CAPTURE_TIMEOUT_MS).toBe(180000);
  });

  it('throws when required env vars are missing', () => {
    expect(() =>
      validateEnv({
        SSO_BASE_URL: 'https://sso.undip.ac.id',
      }),
    ).toThrow();
  });

  it('defaults SESSION_BACKEND to memory and SESSION_TTL_MS to 604800000', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
    });
    expect(cfg.SESSION_BACKEND).toBe('memory');
    expect(cfg.SESSION_TTL_MS).toBe(604800000);
  });

  it('accepts SESSION_BACKEND=redis with optional prod vars', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      SESSION_BACKEND: 'redis',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SESSION_ENC_KEY: 'iam-a-32-byte-secret-key-1234567890', // gitleaks:allow test fixture
      SESSION_TTL_MS: '86400000',
    });
    expect(cfg.SESSION_BACKEND).toBe('redis');
    expect(cfg.SESSION_TTL_MS).toBe(86400000);
  });

  it('rejects an invalid SESSION_BACKEND value', () => {
    expect(() =>
      validateEnv({
        SSO_BASE_URL: 'https://sso.undip.ac.id',
        JWT_SECRET: TEST_JWT_SECRET,
        MS_TENANT_ID: 'tenant',
        MS_CLIENT_ID: 'client',
        MS_CLIENT_SECRET: 'secret',
        MS_REDIRECT_URI: 'http://localhost:3000/callback',
        CDP_URL: 'http://127.0.0.1:9223',
        SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
        SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
        CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
        SESSION_BACKEND: 'postgres',
      }),
    ).toThrow();
  });

  it('defaults SESSION_ABSOLUTE_TTL_MS to 7 days (604800000)', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
    });
    expect(cfg.SESSION_ABSOLUTE_TTL_MS).toBe(604800000);
  });

  it('accepts an explicit SESSION_ABSOLUTE_TTL_MS', () => {
    const cfg = validateEnv({
      SSO_BASE_URL: 'https://sso.undip.ac.id',
      JWT_SECRET: TEST_JWT_SECRET,
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_REDIRECT_URI: 'http://localhost:3000/callback',
      CDP_URL: 'http://127.0.0.1:9223',
      SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
      SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
      CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
      SESSION_ABSOLUTE_TTL_MS: '86400000',
    });
    expect(cfg.SESSION_ABSOLUTE_TTL_MS).toBe(86400000);
  });

  it('rejects SESSION_ABSOLUTE_TTL_MS below 1 minute', () => {
    expect(() =>
      validateEnv({
        SSO_BASE_URL: 'https://sso.undip.ac.id',
        JWT_SECRET: TEST_JWT_SECRET,
        MS_TENANT_ID: 'tenant',
        MS_CLIENT_ID: 'client',
        MS_CLIENT_SECRET: 'secret',
        MS_REDIRECT_URI: 'http://localhost:3000/callback',
        CDP_URL: 'http://127.0.0.1:9223',
        SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/pages/dashboard',
        SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
        CHROME_PROFILE_DIR: '/tmp/sso-chrome-profile',
        SESSION_ABSOLUTE_TTL_MS: '1000',
      }),
    ).toThrow();
  });
});

describe('validateEnv - notification vars', () => {
  const base = {
    SSO_BASE_URL: 'https://sso.undip.ac.id',
    JWT_SECRET: TEST_JWT_SECRET,
    MS_TENANT_ID: 't',
    MS_CLIENT_ID: 'c',
    MS_CLIENT_SECRET: 's',
    MS_REDIRECT_URI: 'https://r',
    CDP_URL: 'http://127.0.0.1:9999',
    SSO_DASHBOARD_URL: 'https://sso.undip.ac.id/',
    SSO_LOGIN_URL: 'https://sso.undip.ac.id/auth/user/login',
    CHROME_PROFILE_DIR: '/tmp/chrome-sso-profile',
  };

  it('default: notifikasi off, tanpa kredensial', () => {
    const cfg = validateEnv(base);
    expect(cfg.NOTIFICATIONS_ENABLED).toBeFalsy();
    expect(cfg.FIREBASE_SERVICE_ACCOUNT_JSON).toBeUndefined();
    expect(cfg.NOTIF_POLL_CRON).toBeUndefined();
  });

  it('menerima nilai eksplisit', () => {
    const cfg = validateEnv({
      ...base,
      NOTIFICATIONS_ENABLED: 'true',
      NOTIF_POLL_CRON: '*/5 * * * *',
      FIREBASE_SERVICE_ACCOUNT_JSON: 'e30=',
    });
    expect(cfg.NOTIFICATIONS_ENABLED).toBe(true);
    expect(cfg.NOTIF_POLL_CRON).toBe('*/5 * * * *');
    expect(cfg.FIREBASE_SERVICE_ACCOUNT_JSON).toBe('e30=');
  });
});
