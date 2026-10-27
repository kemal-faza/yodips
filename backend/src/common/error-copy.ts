import { USER_MESSAGES, messageForStatus } from './user-messages';

/**
 * Safe projection of an HttpException response for the wire.
 *
 * The filter and the dashboard aggregator both need the same decision:
 * what may a client see for this failure? Keeping it here (pure, no Nest
 * runtime) makes the rule testable and stops the two paths from drifting.
 */
export interface ErrorCopy {
  /** Human copy. Never a body dump, field list or exception class. */
  message: string;
  /** Machine code when the exception already carried a canonical one. */
  code?: string;
  /** Server-side detail (validation fields, raw upstream text) for logs only. */
  detail?: string;
}

const NEST_ROUTE_404 = /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;
const THROTTLE_DEFAULT = /^ThrottlerException/;

/** Framework defaults that must never reach a user. */
const FRAMEWORK_DEFAULTS = new Set([
  'Unauthorized',
  'Forbidden resource',
  'Bad Request',
  'Not Found',
  'Internal server error',
]);

function asCode(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Project `status` + `HttpException.getResponse()` onto user copy.
 *
 * Business messages written by services (Indonesian, actionable) survive;
 * framework defaults, validation arrays and throttle dumps do not.
 */
export function errorCopy(status: number, response: unknown): ErrorCopy {
  if (typeof response === 'string') {
    const text = response.trim();
    if (status === 429 || THROTTLE_DEFAULT.test(text)) {
      return { message: USER_MESSAGES.THROTTLED, detail: text };
    }
    if (status === 404 && NEST_ROUTE_404.test(text)) {
      return { message: USER_MESSAGES.ROUTE_NOT_FOUND, detail: text };
    }
    if (FRAMEWORK_DEFAULTS.has(text)) {
      return { message: messageForStatus(status), detail: text };
    }
    return { message: text.length > 0 ? text : messageForStatus(status) };
  }

  if (response !== null && typeof response === 'object') {
    const body = response as Record<string, unknown>;
    const code = asCode(body.code);
    const raw = body.message;

    if (Array.isArray(raw)) {
      return {
        message: USER_MESSAGES.VALIDATION,
        ...(code === undefined ? {} : { code }),
        detail: raw.map((item) => String(item)).join('; '),
      };
    }

    if (typeof raw === 'string') {
      const text = raw.trim();
      if (status === 429) {
        return { message: USER_MESSAGES.THROTTLED, ...(code === undefined ? {} : { code }), detail: text };
      }
      if (status === 404 && NEST_ROUTE_404.test(text)) {
        return { message: USER_MESSAGES.ROUTE_NOT_FOUND, ...(code === undefined ? {} : { code }), detail: text };
      }
      if (FRAMEWORK_DEFAULTS.has(text)) {
        return { message: messageForStatus(status), ...(code === undefined ? {} : { code }), detail: text };
      }
      if (text.length > 0) {
        return { message: text, ...(code === undefined ? {} : { code }) };
      }
    }

    return { message: messageForStatus(status), ...(code === undefined ? {} : { code }) };
  }

  return { message: messageForStatus(status) };
}
