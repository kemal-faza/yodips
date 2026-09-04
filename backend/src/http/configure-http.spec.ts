import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureHttp } from './configure-http';
import { CLOUDFLARE_IPV4_CIDRS, CLOUDFLARE_IPV6_CIDRS } from './trust-proxy';

describe('configureHttp', () => {
  let app: INestApplication;
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  // Mirrors bootstrap (main.ts): resolve the env-VALIDATED TRUST_PROXY_HOPS
  // through Nest ConfigService (never raw process.env at configure time) and
  // pass it explicitly to configureHttp.
  async function bootWithHops(): Promise<void> {
    app = await NestFactory.create(AppModule, { logger: false });
    const hops = app.get(ConfigService).get<number>('TRUST_PROXY_HOPS', 0) as number;
    configureHttp(app, hops);
    await app.init();
  }

  beforeAll(async () => {
    process.env.CORS_ORIGIN = 'https://allowed.example,https://also-allowed.example';
    await bootWithHops();
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
    expect(express.get('trust proxy')).toBe(false);
  });

  it('maps TRUST_PROXY_HOPS=1 to the fail-closed local/private CIDR policy', async () => {
    // NOTE: ConfigModule.forRoot caches the validated env per process, so a
    // per-test process.env mutation cannot re-drive ConfigService. The bootstrap
    // contract is the EXPLICIT validated value passed to configureHttp (as
    // main.ts does from ConfigService); the pure hops→policy mapping itself is
    // unit-tested in trust-proxy.spec.ts. Boot a fresh app and pass 1 directly.
    app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app, 1);
    await app.init();
    try {
      const express = (app as any).getHttpAdapter().getInstance();
      expect(express.get('trust proxy')).toEqual([
        'loopback',
        'linklocal',
        'uniquelocal',
      ]);
    } finally {
      await app.close();
    }
  });

  it('maps TRUST_PROXY_HOPS=2 to local/private + the complete Cloudflare CIDR policy', async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app, 2);
    await app.init();
    try {
      const express = (app as any).getHttpAdapter().getInstance();
      const policy = express.get('trust proxy');
      expect(Array.isArray(policy)).toBe(true);
      expect(policy).toEqual([
        'loopback',
        'linklocal',
        'uniquelocal',
        ...CLOUDFLARE_IPV4_CIDRS,
        ...CLOUDFLARE_IPV6_CIDRS,
      ]);
    } finally {
      await app.close();
    }
  });

  it('boots with the validated ConfigService value (default 0 → trust none), mirroring main.ts', async () => {
    // Fresh boot resolves the value from ConfigService (default 0 with no
    // TRUST_PROXY_HOPS set) and passes it to configureHttp — proving the
    // bootstrap path (as in main.ts) wires end-to-end.
    const fresh = await NestFactory.create(AppModule, { logger: false });
    try {
      const hops = fresh.get(ConfigService).get<number>('TRUST_PROXY_HOPS', 0) as number;
      configureHttp(fresh, hops);
      await fresh.init();
      const express = (fresh as any).getHttpAdapter().getInstance();
      expect(express.get('trust proxy')).toBe(false);
    } finally {
      await fresh.close();
    }
  });

  // Boots the app once per trust mode and reflects req.ip on a raw Express
  // route REGISTERED AFTER configureHttp — proving the *effective* request IP
  // (what ThrottlerGuard's default getTracker sees) through the real HTTP
  // stack. No production route or header is touched. The hops value is passed
  // explicitly (the bootstrap contract); the ConfigService resolution of that
  // value is covered by the beforeAll boot + main.ts.
  async function reflectIp(hops: number | undefined, xff?: string): Promise<string> {
    const value = hops ?? 0;
    let listener;
    try {
      app = await NestFactory.create(AppModule, { logger: false });
      configureHttp(app, value);
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
    }
  }

  it('keys on the socket IP and ignores a spoofed XFF at the fail-safe default (direct mode)', async () => {
    // Socket peer is the loopback listener (IPv4-mapped form on this host);
    // a spoofed XFF must have ZERO effect when no proxy hop is trusted.
    expect(await reflectIp(undefined, '203.0.113.9')).toBe('::ffff:127.0.0.1');
    expect(await reflectIp(0, '203.0.113.9, 198.51.100.7')).toBe('::ffff:127.0.0.1');
  });

  it('RED-fixed: numeric trust must not let attacker XFF win on a shortened path (policy 2)', async () => {
    // Direct-Heroku chain: the socket (loopback, trusted local hop) is followed
    // by attacker-supplied XFF [fake, real-client]. The OLD numeric trust=2
    // consumed both the socket AND the real rightmost entry and derived the
    // attacker's fake. The CIDR policy must STOP at the rightmost entry that is
    // NOT a vetted proxy (the real client) and must never surface the fake.
    expect(await reflectIp(2, '203.0.113.9, 198.51.100.7')).toBe('198.51.100.7');
    expect(await reflectIp(2, '6.6.6.6, 198.51.100.7')).toBe('198.51.100.7');
    // policy 1: single trusted local hop; an extra public XFF entry must not be
    // consumed as a trusted proxy either.
    expect(await reflectIp(1, '203.0.113.9, 198.51.100.7')).toBe('198.51.100.7');
  });

  it('derives the real client for a genuine Cloudflare→Heroku chain (policy 2)', async () => {
    // XFF = [real-client, cf-edge] as appended by the Heroku router when the
    // socket peer is a Cloudflare edge. Both the local socket and the CF edge
    // are trusted → client = the leftmost real client.
    expect(await reflectIp(2, '114.10.44.242, 172.71.82.47')).toBe('114.10.44.242');
    expect(await reflectIp(2, '114.10.44.242, 2606:4700::1')).toBe('114.10.44.242');
    // Single CF-edge hop (Heroku router alone in front): still derives client.
    expect(await reflectIp(2, '198.51.100.7, 104.22.176.19')).toBe('198.51.100.7');
  });

  it('consumes only vetted hops: a CF-range XFF entry is trusted, the public value beyond it is the client (policy 2)', async () => {
    // Local test socket is loopback (a trusted local hop). XFF [public, cf-edge]:
    // the CF edge (rightmost, appended by the trusted proxy) is consumed, then
    // the walk stops at the public value → it is reported as the client rather
    // than being skipped over (a non-CF address is never transparently trusted).
    expect(await reflectIp(2, '203.0.113.9, 172.71.82.47')).toBe('203.0.113.9');
    // Policy 1 (local-only): a CF-looking entry must NOT be trusted at all —
    // the walk stops at the rightmost non-local entry.
    expect(await reflectIp(1, '203.0.113.9, 172.71.82.47')).toBe('172.71.82.47');
  });
});
