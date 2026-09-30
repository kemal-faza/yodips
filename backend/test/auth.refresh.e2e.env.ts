/**
 * Hermetic env for auth.refresh.e2e.spec.ts — imported BEFORE AppModule.
 *
 * Why a separate module: `ConfigModule.forRoot()` inside app.module.ts runs
 * validateEnv AT IMPORT TIME (module decorator/field evaluation), so env vars
 * assigned in the spec body are too late — ES imports hoist above them. This
 * module must stay the FIRST meaningful import of that spec.
 *
 * CI runners have no backend/.env, so an empty process.env fails validation
 * and every test in the suite dies in beforeAll. Fill ONLY missing vars (??=):
 * a developer's real .env values are never overridden. All values are inert
 * fixtures — none is a real credential.
 */
process.env.SSO_BASE_URL ??= 'https://sso.undip.ac.id';
process.env.JWT_SECRET ??= 'e2e-only-fixture-secret-not-a-real-credential'; // gitleaks:allow
process.env.MS_TENANT_ID ??= 'e2e-tenant';
process.env.MS_CLIENT_ID ??= 'e2e-client';
process.env.MS_CLIENT_SECRET ??= 'e2e-client-secret-fixture'; // gitleaks:allow
process.env.MS_REDIRECT_URI ??= 'http://127.0.0.1:3000/api/auth/microsoft/callback';
process.env.CDP_URL ??= 'http://127.0.0.1:9999';
process.env.SSO_DASHBOARD_URL ??= 'https://sso.undip.ac.id/pages/dashboard';
process.env.SSO_LOGIN_URL ??= 'https://sso.undip.ac.id/auth/user/login';
process.env.CHROME_PROFILE_DIR ??= '/tmp/sso-e2e-chrome-profile';

export {};
