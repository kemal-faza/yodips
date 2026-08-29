import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export enum Env {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvConfig {
  @IsEnum(Env)
  NODE_ENV: Env = Env.Development;

  @IsString()
  @IsNotEmpty()
  SSO_BASE_URL: string;

  @IsString()
  @IsNotEmpty()
  SSO_LOGIN_PATH: string = '/sso/auth_v2';

  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string = '12h';

  @IsOptional()
  @Min(1)
  PORT: number = 3000;

  // Microsoft Entra (for Kulon OIDC)
  @IsString()
  @IsNotEmpty()
  MS_TENANT_ID: string;

  @IsString()
  @IsNotEmpty()
  MS_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  MS_CLIENT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  MS_REDIRECT_URI: string;

  // Playwright (browser automation for SSO session capture)
  @IsString()
  @IsNotEmpty()
  CDP_URL: string;

  @IsString()
  @IsNotEmpty()
  SSO_DASHBOARD_URL: string;

  // Interactive login (headed browser)
  @IsString()
  @IsNotEmpty()
  SSO_LOGIN_URL: string;

  @IsString()
  @IsNotEmpty()
  CHROME_PROFILE_DIR: string;

  // Browser binary for the interactive login window (optional — code defaults
  // to Google Chrome). Declared here or `whitelist` strips it → fallback Chrome.
  @IsOptional()
  @IsString()
  CHROME_PATH?: string;

  // How long the interactive capture waits for a valid Kulon session (ms).
  @IsOptional()
  @Min(1000)
  SSO_CAPTURE_TIMEOUT_MS: number = 180000;

  @IsOptional()
  @IsBoolean()
  /** Allow the deprecated single-session auto-reuse path in POST /api/auth/sso/capture.
   *  Default OFF — do NOT enable in production (an unauthenticated caller with a
   *  single-session store could otherwise receive another user's session+JWT). */
  CAPTURE_REUSE_ENABLED?: boolean;

  // ---- Device pairing -------------------------------------------------------
  /** Origin frontend utk URL absolut (qrUrl pairing). Opsional; kosong = qrUrl relatif (dev). */
  @IsOptional()
  @IsString()
  FRONTEND_BASE_URL?: string;

  /** Umur kode pairing (ms). Default 5 menit. */
  @IsOptional()
  @Min(30_000)
  PAIRING_TTL_MS: number = 300_000;

  // Session store persistence
  @IsIn(['memory', 'redis'])
  SESSION_BACKEND: 'memory' | 'redis' = 'memory';

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsOptional()
  @Min(60000)
  SESSION_TTL_MS: number = 604800000; // 7 days

  @IsOptional()
  @Min(1000)
  CACHE_TTL_MS: number = 300000;

  // ---- SIAP official API (api.siap.undip.ac.id/index.php) ------------------
  /** Version-code app resmi SIAP (VERSION_CODE). Version-gate wajib per request. */
  @IsOptional()
  @IsString()
  SIAP_APP_VER: string = '24';

  /** Base URL API resmi SIAP (tanpa trailing slash). */
  @IsOptional()
  @IsString()
  SIAP_API_BASE: string = 'https://api.siap.undip.ac.id/index.php';

  @IsOptional()
  @IsString()
  @MinLength(32)
  SESSION_ENC_KEY?: string;

  // CORS origins (comma-separated) for the frontend
  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  // ---- Push notifications (FCM) -------------------------------------------
  // Scheduler hanya hidup bila enabled DAN kredensial Firebase ada;
  // endpoint registrasi device tetap hidup walau scheduler off.
  @IsOptional()
  @IsBoolean()
  NOTIFICATIONS_ENABLED?: boolean;

  /** Service-account key JSON, base64-encoded (ramah config-var Heroku). */
  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;

  /** Ekspresi cron polling notifikasi. */
  @IsOptional()
  @IsString()
  NOTIF_POLL_CRON?: string;

  // ---- Web Push (VAPID) ----------------------------------------------------
  @IsOptional()
  @IsBoolean()
  WEB_PUSH_ENABLED?: boolean;

  @IsOptional()
  @IsString()
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;

  @IsOptional()
  @IsString()
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  WEB_PUSH_SUBJECT?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const validated = plainToInstance(EnvConfig, config, {
    enableImplicitConversion: true,
  });
  // NOTE: NestJS passes the entire process.env to validate(), so we must NOT
  // use forbidNonWhitelisted (it would reject unrelated OS env vars). whitelist
  // strips unknown keys so only our declared fields are kept.
  const errors = validateSync(validated, {
    whitelist: true,
  });
  if (errors.length > 0) {
    throw new Error(
      errors.map((e) => JSON.stringify(e.constraints)).join(', '),
    );
  }
  return validated;
}
