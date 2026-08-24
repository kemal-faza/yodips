import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

const jsQR = vi.hoisted(() => vi.fn(() => null));
vi.mock('jsqr', () => ({ default: jsQR }));

import QrScanner from './QrScanner.vue';

const mockTrack = { stop: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
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
