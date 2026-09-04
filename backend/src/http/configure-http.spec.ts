import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureHttp } from './configure-http';

describe('configureHttp', () => {
  let app: INestApplication;
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = 'https://allowed.example,https://also-allowed.example';
    app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }
  });

  it('marks API GET responses private and leaves non-API responses untouched', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard')
      .expect('Cache-Control', 'private');

    const root = await request(app.getHttpServer()).get('/');
    expect(root.headers['cache-control']).toBeUndefined();
  });

  it('marks exact API auth paths and descendants private without storage', async () => {
    for (const path of ['/api/auth', '/api/auth/', '/api/auth?next=home', '/api/auth/me']) {
      await request(app.getHttpServer())
        .get(path)
        .expect('Cache-Control', 'private, no-store');
    }
  });

  it('keeps API path boundaries exact', async () => {
    await request(app.getHttpServer())
      .get('/api/authz')
      .expect('Cache-Control', 'private');

    await request(app.getHttpServer())
      .get('/apix')
      .expect((res) => {
        expect(res.headers['cache-control']).toBeUndefined();
      });
  });

  it('marks the exact API root GET private and all non-GET API requests private without storage', async () => {
    await request(app.getHttpServer())
      .get('/api')
      .expect('Cache-Control', 'private');

    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await request(app.getHttpServer())
        [method]('/api')
        .expect('Cache-Control', 'private, no-store');
    }
  });

  it('does not cache the auth refresh response', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ token: 'bad' })
      .expect('Cache-Control', 'private, no-store');
  });

  it('retains Helmet security headers', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect('X-Content-Type-Options', 'nosniff');
  });

  it('allows configured CORS origins and rejects unlisted response exposure', async () => {
    await request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://allowed.example')
      .expect('Access-Control-Allow-Origin', 'https://allowed.example')
      .expect('Access-Control-Allow-Credentials', 'true');

    await request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://not-allowed.example')
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });
  });

  it('marks allowed API preflight responses private without storage', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/dashboard')
      .set('Origin', 'https://allowed.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'https://allowed.example')
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect('Cache-Control', 'private, no-store');

    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('retains DTO validation for API input', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identity: 'student', unexpected: 'removed' })
      .expect(400)
      .expect('Cache-Control', 'private, no-store');
  });

  it('disables ETag and returns a normal response for If-None-Match', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .set('If-None-Match', '"stale-etag"')
      .expect(200);

    expect(response.text).toBe('Hello World!');
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('does not trust forwarded headers by default (fail-safe TRUST_PROXY_HOPS=0)', async () => {
    const express = (app as any).getHttpAdapter().getInstance();
    expect(express.get('trust proxy')).toBe(0);
  });

  it('trusts exactly one proxy when TRUST_PROXY_HOPS=1 is set explicitly', async () => {
    const original = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = '1';
    try {
      app = await NestFactory.create(AppModule, { logger: false });
      configureHttp(app);
      await app.init();
      const express = (app as any).getHttpAdapter().getInstance();
      expect(express.get('trust proxy')).toBe(1);
    } finally {
      await app.close();
      if (original === undefined) {
        delete process.env.TRUST_PROXY_HOPS;
      } else {
        process.env.TRUST_PROXY_HOPS = original;
      }
    }
  });

  // Boots the app once per trust mode and reflects req.ip on a raw Express
  // route REGISTERED AFTER configureHttp — proving the *effective* request IP
  // (what ThrottlerGuard's default getTracker sees) through the real HTTP
  // stack. No production route or header is touched.
  async function reflectIp(hops: number | undefined, xff?: string): Promise<string> {
    const original = process.env.TRUST_PROXY_HOPS;
    if (hops === undefined) {
      delete process.env.TRUST_PROXY_HOPS;
    } else {
      process.env.TRUST_PROXY_HOPS = String(hops);
    }
    let listener;
    try {
      app = await NestFactory.create(AppModule, { logger: false });
      configureHttp(app);
      (app as any).getHttpAdapter().getInstance().use(
        '/__test/reflect-ip',
        (req: any, res: any) => res.json({ ip: req.ip }),
      );
      await app.init();
      listener = app.getHttpServer().listen(0);
      await new Promise<void>((resolve) => listener.once('listening', resolve));
      const port = (listener.address() as any).port;
      const res = await fetch(`http://127.0.0.1:${port}/__test/reflect-ip`, {
        headers: xff === undefined ? {} : { 'X-Forwarded-For': xff },
      });
      const body = (await res.json()) as { ip: string };
      return body.ip;
    } finally {
      await app.close();
      if (listener) {
        await new Promise<void>((resolve) => listener.close(() => resolve()));
      }
      if (original === undefined) {
        delete process.env.TRUST_PROXY_HOPS;
      } else {
        process.env.TRUST_PROXY_HOPS = original;
      }
    }
  }

  it('keys on the socket IP and ignores a spoofed XFF at the fail-safe default (direct mode)', async () => {
    // Socket peer is the loopback listener (IPv4-mapped form on this host);
    // a spoofed XFF must have ZERO effect when no proxy hop is trusted.
    expect(await reflectIp(undefined, '203.0.113.9')).toBe('::ffff:127.0.0.1');
    expect(await reflectIp(0, '203.0.113.9, 198.51.100.7')).toBe('::ffff:127.0.0.1');
  });

  it('derives req.ip from the trusted proxy chain only when TRUST_PROXY_HOPS=1 (spoofed multi-value XFF → rightmost untrusted entry)', async () => {
    // trust=1: the app's socket peer (127.0.0.1) is the trusted hop, so
    // req.ip = rightmost *untrusted* XFF entry = 198.51.100.7. A spoofed
    // single-value XFF must NOT win: the trusted proxy is the one appending.
    expect(await reflectIp(1, '203.0.113.9, 198.51.100.7')).toBe('198.51.100.7');
    expect(await reflectIp(1, '203.0.113.9')).toBe('203.0.113.9');
  });
});
