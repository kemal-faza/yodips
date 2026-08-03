import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

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

  // CORS origins (comma-separated) for the frontend
  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;
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