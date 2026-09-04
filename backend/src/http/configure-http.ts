import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { trustProxyPolicyForHops } from './trust-proxy';

/**
 * Apply HTTP bootstrap configuration.
 *
 * @param app the initialized Nest application
 * @param trustProxyHops the env-VALIDATED TRUST_PROXY_HOPS selector (0..2),
 *   resolved in main.ts from Nest `ConfigService` (never raw `process.env`).
 *   Passed explicitly so the policy mapping is a pure function of the validated
 *   value and is trivially testable.
 */
export function configureHttp(
  app: INestApplication,
  trustProxyHops: number,
): void {
  const adapter = app.getHttpAdapter().getInstance();
  adapter.set('etag', false);
  // Trust proxies by VETTED CIDR policy, never by numeric hop count: numeric
  // trust consumes the first N addresses regardless of who they are, so a
  // shorter reachable proxy path (e.g. direct-to-Heroku bypassing Cloudflare)
  // lets attacker-supplied X-Forwarded-For entries occupy the trusted window
  // and forge req.ip (throttle-bucket evasion). The policy below (mapped from
  // TRUST_PROXY_HOPS — 0 default/fail-safe = trust none, 1 = local/private
  // single hop, 2 = + complete Cloudflare ranges) trusts each hop ONLY when its
  // address is in a vetted CIDR set; the walk stops at the first untrusted
  // address, which is reported as the client. ThrottlerGuard's default
  // getTracker(req) returns req.ip, so rate-limit buckets key on the real client
  // behind the trusted proxy — no custom guard, no manual header parsing.
  adapter.set('trust proxy', trustProxyPolicyForHops(trustProxyHops));
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    const api = path === '/api' || path.startsWith('/api/');
    if (api) {
      const auth = path === '/api/auth' || path.startsWith('/api/auth/');
      res.setHeader(
        'Cache-Control',
        auth || req.method !== 'GET' ? 'private, no-store' : 'private',
      );
    }
    next();
  });
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
}
