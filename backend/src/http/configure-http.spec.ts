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
});
