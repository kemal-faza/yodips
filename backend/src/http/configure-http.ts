import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

export function configureHttp(app: INestApplication): void {
  const adapter = app.getHttpAdapter().getInstance();
  adapter.set('etag', false);
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
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
}
