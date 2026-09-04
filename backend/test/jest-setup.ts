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
 *
 * NOTE (2026-09-04, wave-3 merge): NOTIFICATIONS_ENABLED / FIREBASE_SERVICE_ACCOUNT_JSON
 * are explicitly DISABLED here so a developer's local backend/.env (which enables
 * Firebase) cannot leak into specs that boot the FULL AppModule. With Firebase
 * enabled, every booted app initializes the process-global firebase-admin app
 * "yodips-push", and specs that boot + close MULTIPLE AppModules (configure-http.spec,
 * throttler-trust-proxy.integration.spec) then call FcmService.onModuleDestroy ->
 * deleteApp() on an already-deleted app -> teardown throws "Firebase app ... has
 * already been deleted" (suite fails despite all tests passing). CI has no .env,
 * which is why the wave-3 branches stayed green there; this pin makes local runs
 * CI-equivalent. FCM-only specs construct FcmService with their own config mocks
 * and are unaffected.
 */

process.env.NODE_ENV = 'test';
process.env.NOTIFICATIONS_ENABLED = '';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.WEB_PUSH_ENABLED = '';
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
