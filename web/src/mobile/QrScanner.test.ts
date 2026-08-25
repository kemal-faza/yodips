import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

const jsQR = vi.hoisted(() => vi.fn((): { data: string } | null => null));
vi.mock('jsqr', () => ({ default: jsQR }));

import QrScanner from './QrScanner.vue';

const mockTrack = { stop: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom tak punya secure-context flag — set eksplisit agar guard F0 lolos di test lama.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [mockTrack],
      }),
    },
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

describe('QrScanner', () => {
  // Teleport merender ke body di luar wrapper — stub agar find() bekerja.
  const mountScanner = () => mount(QrScanner, { global: { stubs: { teleport: true } } });

  it('merender overlay + video dan meminta kamera environment', async () => {
    const w = mountScanner();
    await vi.waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: 'environment' },
        audio: false,
      });
    });
    expect(w.find('[data-test="qr-scanner"]').exists()).toBe(true);
    w.unmount();
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it('izin kamera ditolak: pesan instruksi tampil', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    const w = mountScanner();
    await vi.waitFor(() => {
      expect(w.text()).toContain('Kamera tidak diizinkan');
    });
  });

  it('emit decode saat jsQR menemukan teks', async () => {
    jsQR.mockReturnValue({ data: 'https://app/login?pair=ABCD2345' });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 2 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 2 });
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, value: 4 });
    const w = mountScanner();
    await vi.waitFor(() => {
      expect(w.emitted('decode')).toBeTruthy();
    });
    expect(w.emitted('decode')![0][0]).toBe('https://app/login?pair=ABCD2345');
  });
});

describe('QrScanner secure-context guard & retry (spec F0)', () => {
  const mountScanner = () => mount(QrScanner, { global: { stubs: { teleport: true } } });

  // File-level beforeEach sudah set window.isSecureContext=true.
  // Tiap test insecure meng-override eksplisit; afterEach memulihkan.
  const setSecureContext = (v: boolean) =>
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: v });

  afterEach(() => setSecureContext(true));

  it('HTTP non-local: pesan HTTPS tampil, getUserMedia TIDAK dipanggil, ada tombol coba lagi', async () => {
    setSecureContext(false);
    const w = mountScanner();
    await w.vm.$nextTick();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(w.find('[data-test="qr-scanner-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Kamera hanya tersedia lewat HTTPS');
    expect(w.find('[data-test="qr-retry"]').exists()).toBe(true);
    w.unmount();
  });

  it('NotFoundError → pesan tidak punya kamera', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(
      Object.assign(new Error('none'), { name: 'NotFoundError' }),
    );
    const w = mountScanner();
    await vi.waitFor(() => {
      expect(w.text()).toContain('Perangkat tidak memiliki kamera.');
    });
    w.unmount();
  });

  it('klik Coba lagi memanggil ulang getUserMedia dan membersihkan error saat berhasil', async () => {
    const gUM = navigator.mediaDevices.getUserMedia as any;
    gUM.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const w = mountScanner();
    await vi.waitFor(() => {
      expect(w.text()).toContain('Kamera tidak diizinkan');
    });
    await w.find('[data-test="qr-retry"]').trigger('click');
    await vi.waitFor(() => {
      expect(gUM).toHaveBeenCalledTimes(2);
      expect(w.find('[data-test="qr-scanner-error"]').exists()).toBe(false);
      expect(w.text()).toContain('Arahkan QR ke dalam kotak');
    });
    w.unmount();
  });
});
