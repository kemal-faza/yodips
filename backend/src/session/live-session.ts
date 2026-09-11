import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '../common/error-codes';
import { isSessionRef, type CapturedSession } from './session-contract';
import type { SessionStore } from './session-store';

/** The canonical SESSION_DEAD message (Indonesian; unchanged user-facing copy). */
export const SESSION_DEAD_MESSAGE = 'Sesi berakhir. Silakan login ulang';

export interface SessionDeadOptions {
  /** Override the user-facing copy (e.g. pairing's device-specific conflict). */
  message?: string;
  /** Override the HTTP status (defaults to 401). */
  status?: number;
}

/**
 * The ONE SESSION_DEAD factory. Every guarded boundary that finds no live
 * session throws this instead of rebuilding the `{ message, code }` block, so
 * the message/format can never drift. `sessionDead()` with no arguments is the
 * canonical 401; a boundary may override the copy/status while the code stays
 * `ERROR_CODES.SESSION_DEAD`.
 */
export function sessionDead(options: SessionDeadOptions = {}): HttpException {
  return new HttpException(
    {
      message: options.message ?? SESSION_DEAD_MESSAGE,
      code: ERROR_CODES.SESSION_DEAD,
    },
    options.status ?? HttpStatus.UNAUTHORIZED,
  );
}

/**
 * The ONE guarded read: return the live session record qualified by `ref`'s
 * exact generation, or null when the ref is malformed or no live record
 * carries that generation (absent, expired, absolute-dead, legacy, replaced).
 *
 * `SessionStore.getIfGeneration` already guarantees null-on-mismatch, so there
 * is deliberately NO second generation compare here — every consumer of this
 * seam inherits that single rule. Pure with respect to NestJS: it takes the
 * store and returns a value; the caller maps null to `sessionDead()`.
 */
export async function readLiveSession(
  store: SessionStore,
  ref: unknown,
): Promise<CapturedSession | null> {
  if (!isSessionRef(ref)) return null;
  return store.getIfGeneration(ref.sub, ref.sessionGeneration);
}
