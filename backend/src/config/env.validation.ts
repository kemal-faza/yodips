import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
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
  @Min(60000)
  /** Absolute maximum session age (ms). Independent of the sliding TTL: a
   *  session captured longer ago than this can no longer be refreshed, even
   *  while the sliding TTL keeps its record alive. Default equals SESSION_TTL_MS
   *  (7 days). NOTE: the default is an INTENTIONAL behavior change — a session
   *  now dies hard at capturedAt + 7 days even when it is refreshed daily
   *  (previously refresh within each 7-day idle window could keep it alive
   *  indefinitely). Set shorter (e.g. 86400000 = 24h) to tighten the cap. */
  SESSION_ABSOLUTE_TTL_MS: number = 604800000; // 7 days

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

  // ---- Proxy / throttling (YD-RATE-001) ------------------------------------
  /** Selektor topologi proxy untuk Express `trust proxy` (bukan hop-count numerik
   *  mentah — lihat http/trust-proxy.ts: nilai di-map ke policy CIDR fail-closed).
   *  DEFAULT 0 = FAIL-SAFE: trust none (X-Forwarded-For diabaikan; tracker =
   *  socket IP; spoof tidak mempan). Operator WAJIB set eksplisit per topologi:
   *  1 = satu proxy lokal/privat (VPS Caddy same-origin / Heroku router saja),
   *  2 = Heroku prod `backend.crunchy.my.id` = Cloudflare + Heroku router
   *  (trust group lokal/privat + seluruh range CIDR Cloudflare resmi). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  TRUST_PROXY_HOPS: number = 0;

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

  /** Maks subscription web push per user (default 8). */
  @IsOptional()
  @Min(1)
  WEB_PUSH_MAX_SUBSCRIPTIONS: number = 8;

  /** Maks pengiriman web push GLOBAL per siklus poller (default 50; semua user/event). */
  @IsOptional()
  @Min(1)
  WEB_PUSH_CYCLE_BUDGET: number = 50;
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
