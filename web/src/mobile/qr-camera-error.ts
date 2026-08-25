/** Kondisi lingkungan + error yang menentukan pesan kamera QR (spec F0 §5.1). */
export interface QrCameraContext {
  secureContext: boolean;
  mediaDevicesAvailable: boolean;
  errorName?: string | null;
}

export const QR_HTTPS_MESSAGE =
  'Kamera hanya tersedia lewat HTTPS. Buka app lewat https://sso.crunchy.my.id atau gunakan server HTTPS.';

/**
 * Urutan prioritas: secure-context DULU (akar masalah sesungguhnya — browser
 * mematikan seluruh API media di origin non-HTTPS), baru nama error DOMException.
 */
export function qrCameraErrorMessage(ctx: QrCameraContext): string {
  if (!ctx.secureContext || !ctx.mediaDevicesAvailable) return QR_HTTPS_MESSAGE;
  switch (ctx.errorName) {
    case 'NotAllowedError':
      return 'Kamera tidak diizinkan. Izinkan akses kamera di pengaturan Safari/PWA, lalu coba lagi.';
    case 'NotFoundError':
      return 'Perangkat tidak memiliki kamera.';
    default:
      return 'Kamera tidak tersedia. Coba lagi.';
  }
}
