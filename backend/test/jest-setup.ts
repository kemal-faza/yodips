/**
 * Jest setup: seed required backend env vars BEFORE any spec file (and its
 * static imports) is evaluated.
 *
 * Why this is needed: `configure-http.spec.ts` boots the FULL AppModule via
 * `NestFactory.create`, whose `ConfigModule.forRoot` runs `validateEnv` at
 * module-registration time. Several env fields are required with NO default
 * (SSO_BASE_URL, JWT_SECRET, MS_*, CDP_URL, ...). CI has no `.env`, so without
 * this file that suite crashed with `process.exit(1)` (Nest exceptions zone)
 * → "Jest worker encountered child process exceptions, exceeding retry limit".
 *
 * Values here are dummy/test-safe and must never be used as real credentials;
 * real secrets live in backend/.env (gitignored) / Heroku config vars.
 */

process.env.NODE_ENV = 'test';
process.env.SSO_BASE_URL = 'https://sso.undip.ac.id';
process.env.SSO_LOGIN_PATH = '/sso/auth_v2';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
process.env.JWT_EXPIRES_IN = '12h';
process.env.MS_TENANT_ID = '00000000-0000-0000-0000-000000000000';
process.env.MS_CLIENT_ID = '00000000-0000-0000-0000-000000000000';
process.env.MS_CLIENT_SECRET = 'test-client-secret';
process.env.MS_REDIRECT_URI =
  'http://localhost:3000/api/auth/microsoft/callback';
process.env.CDP_URL = 'http://127.0.0.1:9223';
process.env.SSO_DASHBOARD_URL = 'https://sso.undip.ac.id/pages/dashboard';
process.env.SSO_LOGIN_URL = 'https://sso.undip.ac.id/auth/user/login';
process.env.CHROME_PROFILE_DIR = '/tmp/sso-chrome-profile';
process.env.CORS_ORIGIN = 'http://localhost:5173';
