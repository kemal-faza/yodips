import { describe, expect, it } from 'vitest';
import { QR_HTTPS_MESSAGE, qrCameraErrorMessage } from './qr-camera-error';

describe('qrCameraErrorMessage', () => {
  it('insecure context → pesan HTTPS (prioritas tertinggi, abaikan nama error)', () => {
    expect(
      qrCameraErrorMessage({ secureContext: false, mediaDevicesAvailable: false, errorName: 'NotAllowedError' }),
    ).toBe(QR_HTTPS_MESSAGE);
  });

  it('secure tapi mediaDevices tidak ada → pesan HTTPS', () => {
    expect(qrCameraErrorMessage({ secureContext: true, mediaDevicesAvailable: false })).toBe(QR_HTTPS_MESSAGE);
  });

  it('secure + mediaDevices ada tanpa error → pesan generik', () => {
    expect(
      qrCameraErrorMessage({ secureContext: true, mediaDevicesAvailable: true, errorName: null }),
    ).toBe('Kamera tidak tersedia. Coba lagi.');
  });

  it('NotAllowedError → pesan izin Safari/PWA', () => {
    expect(
      qrCameraErrorMessage({ secureContext: true, mediaDevicesAvailable: true, errorName: 'NotAllowedError' }),
    ).toBe('Kamera tidak diizinkan. Izinkan akses kamera di pengaturan Safari/PWA, lalu coba lagi.');
  });

  it('NotFoundError → pesan tidak punya kamera', () => {
    expect(
      qrCameraErrorMessage({ secureContext: true, mediaDevicesAvailable: true, errorName: 'NotFoundError' }),
    ).toBe('Perangkat tidak memiliki kamera.');
  });

  it('error tak dikenal → fallback generik', () => {
    expect(
      qrCameraErrorMessage({ secureContext: true, mediaDevicesAvailable: true, errorName: 'AbortError' }),
    ).toBe('Kamera tidak tersedia. Coba lagi.');
  });

  it('errorName hilang (undefined) → fallback generik', () => {
    expect(qrCameraErrorMessage({ secureContext: true, mediaDevicesAvailable: true })).toBe(
      'Kamera tidak tersedia. Coba lagi.',
    );
  });
});
