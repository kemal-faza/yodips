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

  // Synthetic-socket regression (reviewer-requested): a real HTTP listener can
  // only bind loopback, so it cannot prove that a PUBLIC non-CF peer is
  // untrusted. This helper drives the REAL Express `req.ip` getter (the same
  // code path ThrottlerGuard's getTracker uses) with a synthetic
  // `req.socket.remoteAddress` of our choosing. It reuses the booted app's own
  // Express instance (`app.getHttpAdapter().getInstance()`) — `app.request` is
  // the real request prototype and its `ip` getter reads the app's compiled
  // `trust proxy fn` + the actual `forwarded` chain (X-Forwarded-For parsing is
  // done by Express/proxy-addr/forwarded internals — nothing hand-parsed here,
  // no new package imported).
  async function syntheticReqIp(
    hops: number,
    socketAddr: string,
    xff?: string,
  ): Promise<string> {
    let req: any;
    try {
      // Boot with the hops value passed EXPLICITLY: ConfigModule.forRoot caches
      // the validated env per process, so per-test env mutation cannot re-drive
      // ConfigService (same constraint documented in the mapping tests above).
      app = await NestFactory.create(AppModule, { logger: false });
      configureHttp(app, hops);
      await app.init();
      const expressApp: any = (app as any).getHttpAdapter().getInstance();
      req = Object.create(expressApp.request);
      req.app = expressApp;
      req.socket = { remoteAddress: socketAddr };
      req.headers = xff === undefined ? {} : { 'x-forwarded-for': xff };
      return req.ip;
    } finally {
      await app.close();
    }
  }

  it('regression: a synthetic PUBLIC non-CF socket is never trusted under policy 1 or 2 — all XFF ignored, req.ip = the socket', async () => {
    // Direct public peer (no proxy): regardless of spoofed X-Forwarded-For
    // (including CF-range and local-looking values), the peer itself is not in
    // any vetted group → the walk stops at the socket → req.ip = the public
    // peer. This is the fail-closed property a loopback-bound listener cannot
    // exercise.
    expect(await syntheticReqIp(1, '203.0.113.9', '198.51.100.7, 10.0.0.5')).toBe('203.0.113.9');
    expect(await syntheticReqIp(1, '203.0.113.9', '172.71.82.47')).toBe('203.0.113.9');
    expect(await syntheticReqIp(2, '203.0.113.9', '198.51.100.7, 172.71.82.47')).toBe('203.0.113.9');
    expect(await syntheticReqIp(2, '203.0.113.9', '172.71.82.47, 104.22.176.19')).toBe('203.0.113.9');
    expect(await syntheticReqIp(2, '198.51.100.7', '172.71.82.47')).toBe('198.51.100.7');
    expect(await syntheticReqIp(0, '203.0.113.9', '172.71.82.47, 1.2.3.4')).toBe('203.0.113.9');
  });

  it('regression: a synthetic CF socket under policy 2 consumes only CF XFF entries and stops at the first non-CF value', async () => {
    // Legit Cloudflare→Heroku: socket = CF edge, Heroku appended the real client
    // → req.ip = the real client. But a non-CF value adjacent to a CF one must
    // terminate the walk (never transparently skipped).
    expect(await syntheticReqIp(2, '172.71.82.47', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '2606:4700::1', '114.10.44.242')).toBe('114.10.44.242');
    // [public, cf-edge] over a CF socket: cf-edge consumed, public reported.
    expect(await syntheticReqIp(2, '104.22.176.19', '203.0.113.9, 172.71.82.47')).toBe('203.0.113.9');
  });

  it('regression: adjacent-but-outside (non-Cloudflare) addresses are never consumed under policy 2', async () => {
    // Boundary probes just OUTSIDE the authoritative CF ranges must not be
    // treated as trusted proxy hops — whether as the socket peer or as an XFF
    // entry behind a trusted socket.
    expect(await syntheticReqIp(2, '104.28.0.1', '1.2.3.4')).toBe('104.28.0.1'); // above 104.24.0.0/14
    expect(await syntheticReqIp(2, '172.72.0.1', '1.2.3.4')).toBe('172.72.0.1'); // above 172.64.0.0/13
    expect(await syntheticReqIp(2, '162.160.0.1', '1.2.3.4')).toBe('162.160.0.1'); // above 162.158.0.0/15
    expect(await syntheticReqIp(2, '198.42.0.1', '1.2.3.4')).toBe('198.42.0.1'); // above 198.41.128.0/17
    expect(await syntheticReqIp(2, '2606:4701::1', '1.2.3.4')).toBe('2606:4701::1'); // above 2606:4700::/32
    // As an XFF entry behind a trusted local socket: the adjacent address must
    // terminate the walk (reported as client), not be consumed.
    expect(await syntheticReqIp(2, '127.0.0.1', '172.72.0.1, 172.71.82.47')).toBe('172.72.0.1');
  });

  it('regression: a synthetic trusted PRIVATE/loopback hop under policy 1 consumes exactly one XFF entry (the appended client)', async () => {
    // Caddy/Heroku-router single-hop: socket is private/local (trusted), so the
    // rightmost XFF entry (the one the trusted proxy appended) is the client.
    // XFF "[a, b]" = client a reached via proxy b; with ONE trusted hop the walk
    // consumes the socket then stops at b (rightmost) — deeper entries (a) are
    // never consumed by policy 1 (a non-vetted value terminates the walk).
    expect(await syntheticReqIp(1, '10.0.0.5', '203.0.113.9')).toBe('203.0.113.9');
    expect(await syntheticReqIp(1, '127.0.0.1', '198.51.100.7, 203.0.113.9')).toBe('203.0.113.9');
    expect(await syntheticReqIp(1, '192.168.1.10', '114.10.44.242')).toBe('114.10.44.242');
  });

  it('regression: policy 1 trusts the full local/private group breadth (loopback v4/v6, linklocal, ULA)', async () => {
    // Every proxy-addr local group member, as the socket peer behind a single
    // trusted hop, must be consumed so the appended client is derived.
    expect(await syntheticReqIp(1, '::1', '203.0.113.9')).toBe('203.0.113.9'); // loopback v6
    expect(await syntheticReqIp(1, '::ffff:127.0.0.1', '203.0.113.9')).toBe('203.0.113.9'); // v4-mapped loopback
    expect(await syntheticReqIp(1, '169.254.1.1', '203.0.113.9')).toBe('203.0.113.9'); // linklocal
    expect(await syntheticReqIp(1, 'fe80::1', '203.0.113.9')).toBe('203.0.113.9'); // linklocal v6
    expect(await syntheticReqIp(1, 'fc00::1', '203.0.113.9')).toBe('203.0.113.9'); // ULA v6
    expect(await syntheticReqIp(1, '172.16.0.4', '203.0.113.9')).toBe('203.0.113.9'); // uniquelocal
  });

  it('regression: policy 2 trusts representative live Cloudflare IPv4+IPv6 socket peers', async () => {
    // The actual CF edges observed in production router logs / DNS (2026-09-04),
    // each as the socket peer with a real client appended by Heroku.
    expect(await syntheticReqIp(2, '172.71.82.47', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '104.22.176.19', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '162.158.162.140', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '172.70.142.205', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '104.21.25.219', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '2606:4700::1', '114.10.44.242')).toBe('114.10.44.242');
    expect(await syntheticReqIp(2, '2400:cb00::1', '114.10.44.242')).toBe('114.10.44.242');
  });
});
