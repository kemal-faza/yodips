/**
 * Canonical user-facing copy for transport failures.
 *
 * RULE: this file holds the ONLY strings the backend may send to a client for
 * an unexpected/transport failure. Status codes, response bodies, exception
 * messages, field names and upstream text belong in logs, never in `message`.
 * Business copy that is genuinely actionable (e.g. "Detail nilai komponen
 * belum tersedia di SIAP untuk mata kuliah ini") may still be passed as an
 * explicit exception message by the throwing service.
 *
 * Voice: informal "kamu" (the product voice), short sentences, no jargon.
 */

export const USER_MESSAGES = {
  /** Upstream/own 5xx — the server is at fault, the request may be retried. */
  SERVER: 'Server sedang bermasalah. Coba lagi sebentar lagi.',
  /** Global rate limit. */
  THROTTLED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  /** ValidationPipe rejected the payload. */
  VALIDATION: 'Data yang kamu kirim tidak valid.',
  /** No such resource. */
  NOT_FOUND: 'Data yang kamu minta tidak ditemukan.',
  /** No route matches the URL (framework 404, not a domain 404). */
  ROUTE_NOT_FOUND: 'Alamat yang diminta tidak ditemukan.',
  /** Authenticated but not allowed. */
  FORBIDDEN: 'Akunmu tidak punya akses ke data ini.',
  /** State changed elsewhere (pairing/renewal conflict). */
  CONFLICT: 'Data berubah di perangkat lain. Muat ulang lalu coba lagi.',
  /** Session gone — only a re-login helps. */
  SESSION_ENDED: 'Sesi kamu sudah berakhir. Silakan login ulang.',
  /** Request semantically rejected but not by validation. */
  UNPROCESSABLE: 'Permintaan tidak dapat diproses. Coba lagi.',
  /** Fallback for anything else. */
  UNEXPECTED: 'Terjadi kesalahan. Coba lagi.',
} as const;

/** Status-only fallback used when an exception carries no usable message. */
export function messageForStatus(status: number): string {
  if (status === 400) return USER_MESSAGES.VALIDATION;
  if (status === 401) return USER_MESSAGES.SESSION_ENDED;
  if (status === 403) return USER_MESSAGES.FORBIDDEN;
  if (status === 404) return USER_MESSAGES.NOT_FOUND;
  if (status === 409) return USER_MESSAGES.CONFLICT;
  if (status === 422) return USER_MESSAGES.UNPROCESSABLE;
  if (status === 429) return USER_MESSAGES.THROTTLED;
  if (status >= 500) return USER_MESSAGES.SERVER;
  return USER_MESSAGES.UNEXPECTED;
}
