import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const back = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ back }),
}));

const postKehadiranToken = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ postKehadiranToken }));

// Stub scanner yang bisa dipicu emit decode-nya lewat findComponent.
vi.mock('../QrScanner.vue', () => ({
  default: { name: 'QrScanner', template: '<div data-test="scanner-stub" />' },
}));

import ScanMobile from './ScanMobile.vue';

function fireDecode(w: ReturnType<typeof mount>, text: string) {
  w.findComponent({ name: 'QrScanner' }).vm.$emit('decode', text);
}

beforeEach(() => {
  // toFake DIBATASI (bukan default semua-timer): flushPromises VTU memakai
  // setImmediate — kalau ikut di-fake, await flushPromises() deadlock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  postKehadiranToken.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('ScanMobile', () => {
  it('sukses: banner hijau + pesan passthrough + auto-resume ±2 detik', async () => {
    postKehadiranToken.mockResolvedValue({ status: 'success', message: 'Absensi berhasil dicatat' });
    const w = mount(ScanMobile);
    expect(w.findComponent({ name: 'QrScanner' }).exists()).toBe(true);
    fireDecode(w, 'TOKEN-QR-123');
    await flushPromises();
    expect(postKehadiranToken).toHaveBeenCalledTimes(1);
    expect(postKehadiranToken).toHaveBeenCalledWith('TOKEN-QR-123');
    expect(w.find('[data-test="scan-result"]').classes().join(' ')).toContain('success');
    expect(w.text()).toContain('Absensi berhasil dicatat');
    vi.advanceTimersByTime(2100);
    await flushPromises();
    expect(w.find('[data-test="scan-result"]').exists()).toBe(false);
    expect(w.findComponent({ name: 'QrScanner' }).exists()).toBe(true); // resume
  });

  it('single-fire: decode ganda saat proses berjalan hanya 1 POST', async () => {
    let resolvePost!: (v: unknown) => void;
    postKehadiranToken.mockReturnValue(new Promise((r) => { resolvePost = r; }));
    const w = mount(ScanMobile);
    fireDecode(w, 'T1');
    fireDecode(w, 'T2'); // didebounce
    await flushPromises();
    resolvePost({ status: 'error', message: 'Gagal: QRcode tidak valid atau sudah expired.' });
    await flushPromises();
    expect(postKehadiranToken).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('QRcode tidak valid atau sudah expired');
  });

  it('error HTTP: pesan dari envelope respons', async () => {
    postKehadiranToken.mockRejectedValue({ response: { data: { message: 'token QR wajib diisi' } } });
    const w = mount(ScanMobile);
    fireDecode(w, 'X');
    await flushPromises();
    expect(w.text()).toContain('token QR wajib diisi');
    expect(w.find('[data-test="scan-result"]').classes().join(' ')).not.toContain('success');
  });

  it('close scanner → router.back()', async () => {
    const w = mount(ScanMobile);
    w.findComponent({ name: 'QrScanner' }).vm.$emit('close');
    await flushPromises();
    expect(back).toHaveBeenCalledTimes(1);
  });
});
