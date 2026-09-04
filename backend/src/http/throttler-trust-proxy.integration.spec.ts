import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { configureHttp } from './configure-http';

/**
 * End-to-end-ish throttler integration: boots the REAL AppModule (whose global
 * APP_GUARD is the STOCK @nestjs/throttler ThrottlerGuard — no custom guard, no
 * hand-parsed header approximation) and drives real HTTP requests through a live
 * listener. The stock guard's documented tracker path is `getTracker(req) =>
 * req.ip`; these tests prove the bucket keying follows the req.ip derived from
 * the CIDR trust-proxy policy configured in configureHttp.
 *
 * `/api/auth/me` is JWT-guarded (fast 401 without a token, no upstream call) and
 * sits under the global 30/min ThrottlerModule bucket, so hammering it isolates
 * pure throttler behavior: 401 = passed the throttle, 429 = bucket exhausted.
 */
describe('ThrottlerGuard keys on the derived req.ip (trust-proxy integration)', () => {
  async function boot(hops: number): Promise<{ app: INestApplication; port: number }> {
    const app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app, hops);
    await app.init();
    const listener = app.getHttpServer().listen(0);
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    return { app, port: (listener.address() as any).port };
  }

  async function hit(
    port: number,
    xff?: string,
  ): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: xff === undefined ? {} : { 'X-Forwarded-For': xff },
    });
    return res.status;
  }

  const count = (codes: number[], target: number) =>
    codes.filter((c) => c === target).length;
  const countNot = (codes: number[], excluded: number) =>
    codes.filter((c) => c !== excluded).length;

  it('default 0 (fail-safe): spoofed XFF cannot split the socket bucket', async () => {
    const { app, port } = await boot(0);
    try {
      // 45 rapid requests alternating TWO spoofed XFF values. With trust none,
      // req.ip = socket for every request → one shared 30/min bucket → exactly
      // 30 non-429 (401) then 15× 429. Spoofing must NOT yield extra buckets.
      const codes: number[] = [];
      for (let i = 0; i < 45; i++) {
        codes.push(await hit(port, i % 2 === 0 ? '203.0.113.9' : '198.51.100.7'));
      }
      expect(count(codes, 429)).toBe(15);
      expect(countNot(codes, 429)).toBe(30);
    } finally {
      await app.close();
    }
  });

  it('policy 2: per-client buckets behind a trusted Cloudflare→Heroku chain', async () => {
    const { app, port } = await boot(2);
    try {
      // 40 requests all presenting the SAME real client behind a genuine CF
      // edge: req.ip = the real client → its 30/min bucket exhausts.
      const clientACodes: number[] = [];
      for (let i = 0; i < 40; i++) {
        clientACodes.push(await hit(port, '114.10.44.242, 172.71.82.47'));
      }
      expect(count(clientACodes, 429)).toBe(10);
      expect(count(clientACodes, 401)).toBe(30);

      // A DIFFERENT real client right after still has a fresh bucket.
      const clientBCodes: number[] = [];
      for (let i = 0; i < 5; i++) {
        clientBCodes.push(await hit(port, '198.51.100.7, 104.22.176.19'));
      }
      expect(count(clientBCodes, 429)).toBe(0);
      expect(count(clientBCodes, 401)).toBe(5);
    } finally {
      await app.close();
    }
  });

  it('policy 2 closes the shortened-path evasion: rotating attacker fake cannot dodge the bucket (direct-Heroku chain)', async () => {
    const { app, port } = await boot(2);
    try {
      // Direct-to-Heroku (no CF): attacker sends XFF [fake_i, real-client] with
      // a ROTATING fake. The numeric trust=2 bug derived req.ip = the attacker
      // fake → every request a fresh bucket → never throttled. The CIDR policy
      // stops at the rightmost non-vetted entry (the constant real client) →
      // all 40 share one bucket → 30× 401 then 10× 429 regardless of the fake.
      const codes: number[] = [];
      for (let i = 0; i < 40; i++) {
        const fake = `203.0.113.${(i % 250) + 1}`;
        codes.push(await hit(port, `${fake}, 198.51.100.7`));
      }
      expect(count(codes, 429)).toBe(10);
      expect(count(codes, 401)).toBe(30);
    } finally {
      await app.close();
    }
  });

  it('policy 1: a CF-looking XFF entry is NOT trusted over a single local hop (bucket stays on the peer)', async () => {
    const { app, port } = await boot(1);
    try {
      // Policy 1 trusts only local/private hops. An attacker over the trusted
      // local hop (loopback socket in tests) appending a CF-range entry must not
      // get it consumed: req.ip = the CF-looking entry itself (rightmost
      // untrusted) — constant per spoof value, so hammering one value exhausts
      // its bucket (proving no transparent CF trust at policy 1).
      const codes: number[] = [];
      for (let i = 0; i < 40; i++) {
        codes.push(await hit(port, '203.0.113.9, 172.71.82.47'));
      }
      expect(count(codes, 429)).toBe(10);
      expect(count(codes, 401)).toBe(30);
    } finally {
      await app.close();
    }
  });
});
