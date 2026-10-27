import { describe, expect, it } from 'vitest';
import { describeError, ERROR_COPY } from './error-copy';

const ctx = { fallback: 'Gagal memuat data. Coba lagi.' };

function http(status: number, data?: unknown): unknown {
  return { response: { status, data } };
}

describe('describeError', () => {
  it('maps a missing response to the connectivity copy', () => {
    expect(describeError(new Error('Network Error'), ctx)).toBe(ERROR_COPY.NETWORK);
    expect(describeError({ message: 'timeout of 10000ms exceeded' }, ctx)).toBe(ERROR_COPY.NETWORK);
  });

  it('never echoes the axios message for a 5xx', () => {
    const message = describeError(
      { message: 'Request failed with status code 500', response: { status: 500, data: { message: 'Internal server error' } } },
      ctx,
    );
    expect(message).toBe(ERROR_COPY.SERVER);
    expect(message).not.toContain('Request failed');
  });

  it('replaces a validation array with human copy', () => {
    const message = describeError(
      http(400, { message: ['notificationId must be a string'], error: 'Bad Request', statusCode: 400 }),
      ctx,
    );
    expect(message).toBe(ERROR_COPY.VALIDATION);
    expect(message).not.toContain('notificationId');
  });

  it('uses the contract code for a dead session', () => {
    expect(describeError(http(401, { message: 'Sesi berakhir', code: 'SESSION_DEAD' }), ctx)).toBe(
      ERROR_COPY.SESSION_ENDED,
    );
    expect(describeError(http(401, { code: 'INVALID_TOKEN' }), ctx)).toBe(ERROR_COPY.SESSION_ENDED);
  });

  it('gives each status its own actionable sentence', () => {
    expect(describeError(http(403), ctx)).toBe(ERROR_COPY.FORBIDDEN);
    expect(describeError(http(404), ctx)).toBe(ERROR_COPY.NOT_FOUND);
    expect(describeError(http(409), ctx)).toBe(ERROR_COPY.CONFLICT);
    expect(describeError(http(422), ctx)).toBe(ERROR_COPY.UNPROCESSABLE);
    expect(describeError(http(429), ctx)).toBe(ERROR_COPY.THROTTLED);
    expect(describeError(http(502), ctx)).toBe(ERROR_COPY.UPSTREAM_DOWN);
  });

  it('keeps the caller fallback only for statuses without shared meaning', () => {
    expect(describeError(http(418), ctx)).toBe(ctx.fallback);
    // Test doubles sometimes omit the status: treat as "this surface's" error.
    expect(describeError({ response: { data: { message: 'SIAP down' } } }, ctx)).toBe(ctx.fallback);
  });

  it('every copy is a plain, jargon-free sentence', () => {
    for (const message of Object.values(ERROR_COPY)) {
      expect(message).not.toMatch(/[{}]|statusCode|Exception|HTTP \d|undefined/);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});
