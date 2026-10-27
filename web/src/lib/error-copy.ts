import { BACKEND_ERROR_CODES, parseErrorEnvelope } from '../api/contract';

/**
 * User-facing copy for a failed request.
 *
 * THE RULE: a screen may show what happened and what to do next; it may never
 * echo `error.message`, a response body, a status code or a validation array.
 * Axios messages ("Network Error", "Request failed with status code 500"),
 * Nest defaults ("Internal server error") and upstream dumps are transport
 * facts, not sentences.
 *
 * Mirror of `backend/src/common/user-messages.ts` and
 * `mobile/.../core/network/UserMessages.kt`. Voice: informal "kamu".
 */
export const ERROR_COPY = {
  NETWORK: 'Tidak dapat terhubung ke server. Periksa koneksimu lalu coba lagi.',
  SERVER: 'Server sedang bermasalah. Coba lagi sebentar lagi.',
  THROTTLED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  VALIDATION: 'Data yang kamu kirim tidak valid.',
  NOT_FOUND: 'Data yang kamu minta tidak ditemukan.',
  FORBIDDEN: 'Akunmu tidak punya akses ke data ini.',
  CONFLICT: 'Data berubah di perangkat lain. Muat ulang lalu coba lagi.',
  SESSION_ENDED: 'Sesi kamu sudah berakhir. Silakan login ulang.',
  UPSTREAM_DOWN: 'Layanan Undip sedang tidak bisa diakses. Coba lagi nanti.',
  UNPROCESSABLE: 'Permintaan tidak dapat diproses. Coba lagi.',
} as const;

export interface ErrorCopyContext {
  /** Shown when the status carries no specific meaning for this surface. */
  fallback: string;
}

interface ErrorLike {
  response?: { status?: number; data?: unknown };
}

/**
 * Map any thrown value (normally an axios error) to one sentence.
 *
 * `fallback` is the caller's context ("Gagal memuat profil SIAP"), used only
 * when the status is present but has no shared meaning.
 */
export function describeError(error: unknown, ctx: ErrorCopyContext): string {
  const candidate = error as ErrorLike | null | undefined;
  const response = candidate?.response;

  // No HTTP response at all: offline, DNS, timeout, connection reset.
  if (!response) return ERROR_COPY.NETWORK;

  const status = response.status;
  if (typeof status !== 'number') return ctx.fallback;

  const { code } = parseErrorEnvelope(response.data);
  if (code === BACKEND_ERROR_CODES.SESSION_DEAD || code === BACKEND_ERROR_CODES.INVALID_TOKEN) {
    return ERROR_COPY.SESSION_ENDED;
  }
  if (code === BACKEND_ERROR_CODES.KULON_STALE || code === BACKEND_ERROR_CODES.SIAP_STALE) {
    return ERROR_COPY.SESSION_ENDED;
  }

  if (status === 400) return ERROR_COPY.VALIDATION;
  if (status === 401) return ERROR_COPY.SESSION_ENDED;
  if (status === 403) return ERROR_COPY.FORBIDDEN;
  if (status === 404) return ERROR_COPY.NOT_FOUND;
  if (status === 409) return ERROR_COPY.CONFLICT;
  if (status === 422) return ERROR_COPY.UNPROCESSABLE;
  if (status === 429) return ERROR_COPY.THROTTLED;
  if (status === 502) return ERROR_COPY.UPSTREAM_DOWN;
  if (status >= 500) return ERROR_COPY.SERVER;
  return ctx.fallback;
}
