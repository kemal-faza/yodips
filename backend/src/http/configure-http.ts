import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

export function configureHttp(app: INestApplication): void {
  const adapter = app.getHttpAdapter().getInstance();
  adapter.set('etag', false);
  // Trust EXACTLY N proxy hops (never blanket `true`), and NEVER trust any hop
  // by default: TRUST_PROXY_HOPS unset/0 → socket IP only, X-Forwarded-For
  // ignored (fail-safe for direct/dev deployments). Only when an operator
  // explicitly sets 1 (Heroku router / Caddy) does Express derive req.ip as the
  // right-most UNTRUSTED X-Forwarded-For entry; ThrottlerGuard's default
  // getTracker(req) returns req.ip, so rate-limit buckets then key on the real
  // client behind the trusted proxy. Validated 0..2 in env.validation.ts.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  adapter.set('trust proxy', hops);
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
