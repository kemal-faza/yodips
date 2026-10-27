import 'reflect-metadata';
import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { USER_MESSAGES } from '../common/user-messages';

function hostFor() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const request = { method: 'GET', originalUrl: '/api/demo' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function bodyOf(json: jest.Mock): Record<string, unknown> {
  expect(json).toHaveBeenCalledTimes(1);
  return json.mock.calls[0][0] as Record<string, unknown>;
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('preserves a service-owned body and its canonical code', () => {
    const { host, status, json } = hostFor();
    new AllExceptionsFilter().catch(
      new HttpException(
        { message: 'Kode sudah kedaluwarsa. Minta kode baru.', code: 'EXPIRED_CODE' },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(bodyOf(json)).toEqual({
      message: 'Kode sudah kedaluwarsa. Minta kode baru.',
      code: 'EXPIRED_CODE',
      statusCode: 400,
    });
  });

  it('replaces a validation array with human copy', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(
      new BadRequestException({ message: ['notificationId must be a string'] }),
      host,
    );
    const body = bodyOf(json);
    expect(body.message).toBe(USER_MESSAGES.VALIDATION);
    expect(JSON.stringify(body)).not.toContain('notificationId');
  });

  it('replaces the throttler dump on 429', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(
      new HttpException('ThrottlerException: Too Many Requests', 429),
      host,
    );
    expect(bodyOf(json).message).toBe(USER_MESSAGES.THROTTLED);
  });

  it('replaces the framework 404 sentinel but keeps a domain 404 message', () => {
    const routed = hostFor();
    new AllExceptionsFilter().catch(new NotFoundException(), routed.host);
    expect(bodyOf(routed.json).message).toBe(USER_MESSAGES.NOT_FOUND);

    const unmatched = hostFor();
    new AllExceptionsFilter().catch(
      new HttpException('Cannot GET /api/nope', HttpStatus.NOT_FOUND),
      unmatched.host,
    );
    expect(bodyOf(unmatched.json).message).toBe(USER_MESSAGES.ROUTE_NOT_FOUND);

    const domain = hostFor();
    new AllExceptionsFilter().catch(
      new HttpException(
        { message: 'Detail tugas tidak ditemukan' },
        HttpStatus.NOT_FOUND,
      ),
      domain.host,
    );
    expect(bodyOf(domain.json).message).toBe('Detail tugas tidak ditemukan');
  });

  it('replaces the bare Unauthorized default', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(new UnauthorizedException(), host);
    expect(bodyOf(json).message).toBe(USER_MESSAGES.SESSION_ENDED);
  });

  it('keeps an explicit business 502 message', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(
      new HttpException(
        { message: 'Detail nilai komponen belum tersedia di SIAP untuk mata kuliah ini' },
        HttpStatus.BAD_GATEWAY,
      ),
      host,
    );
    expect(bodyOf(json).message).toBe(
      'Detail nilai komponen belum tersedia di SIAP untuk mata kuliah ini',
    );
  });

  it('turns an unknown throwable into a generic 500 and logs the stack', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = hostFor();
    new AllExceptionsFilter().catch(new Error('internal secret'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(bodyOf(json)).toEqual({
      statusCode: 500,
      message: USER_MESSAGES.SERVER,
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('internal secret');
    expect(errorSpy).toHaveBeenCalled();
  });
});

@Controller('demo')
class DemoController {
  @Get('boom')
  boom(): never {
    throw new Error('internal secret');
  }

  @Get('invalid')
  invalid(): never {
    throw new BadRequestException({ message: ['deviceToken must be a string'] });
  }
}

describe('AllExceptionsFilter over HTTP', () => {
  let app: { init: () => Promise<void>; close: () => Promise<void>; getHttpServer: () => unknown };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('returns a generic 500 body without the thrown detail', async () => {
    const res = await request(app.getHttpServer()).get('/demo/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: USER_MESSAGES.SERVER });
    expect(JSON.stringify(res.body)).not.toContain('internal secret');
  });

  it('returns human copy for a validation array', async () => {
    const res = await request(app.getHttpServer()).get('/demo/invalid');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(USER_MESSAGES.VALIDATION);
    expect(JSON.stringify(res.body)).not.toContain('deviceToken');
  });
});
