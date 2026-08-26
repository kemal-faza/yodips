import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const pairRequest = vi.hoisted(() => vi.fn());
const pairStatus = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ pairRequest, pairStatus }));

// Satu ref bersama agar test bisa meng-assert pemanggilan toCanvas:
const toCanvas = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('qrcode', () => ({
  default: { toCanvas },
  toCanvas,
}));

import PairingCard from './PairingCard.vue';

describe('PairingCard', () => {
  beforeEach(() => {
    pairRequest.mockReset();
    pairStatus.mockReset();
    toCanvas.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('menampilkan kode ter-group + countdown + MENGGAMBAR QR setelah request sukses', async () => {
    pairRequest.mockResolvedValue({
      code: 'ABCD2345',
      qrUrl: 'https://app/login?pair=ABCD2345',
      expiresAt: Date.now() + 5 * 60_000,
    });
    // attachTo body agar document.getElementById('pair-qr') menemukan canvas.
    const w = mount(PairingCard, { attachTo: document.body });
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="pairing-code"]').text()).toBe('ABCD 2345');
    expect(w.find('[data-test="pairing-countdown"]').text()).toMatch(/^\d{2}:\d{2}$/);
    expect(pairRequest).toHaveBeenCalledTimes(1);
    // QR digambar ke canvas yang BENAR-BENAR ada di DOM (bukan dilewati diam-diam):
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect(toCanvas.mock.calls[0][0]).toBe(w.find('canvas').element);
    expect(toCanvas.mock.calls[0][1]).toBe('https://app/login?pair=ABCD2345');
    w.unmount();
    document.body.innerHTML = '';
  });

  it('error 401 menampilkan pesan sesi berakhir', async () => {
    pairRequest.mockRejectedValue({ response: { status: 401 } });
    const w = mount(PairingCard);
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="pairing-error"]').text()).toContain('login ulang');
  });

  it('error lain menampilkan pesan generik', async () => {
    pairRequest.mockRejectedValue(new Error('boom'));
    const w = mount(PairingCard);
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="pairing-error"]').text()).toContain('Gagal membuat kode');
  });

  it('menampilkan peringatan kode berlaku sekali saat kode tampil', async () => {
    pairRequest.mockResolvedValue({
      code: 'ABCD2345',
      qrUrl: 'https://app/login?pair=ABCD2345',
      expiresAt: Date.now() + 5 * 60_000,
    });
    const w = mount(PairingCard, { attachTo: document.body });
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="pairing-once"]').text()).toContain('sekali');
    w.unmount();
    document.body.innerHTML = '';
  });

  it('polling: kode consumed → banner terhubung lalu auto-request kode baru', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    pairRequest.mockResolvedValue({
      code: 'ABCD2345',
      qrUrl: 'https://app/login?pair=ABCD2345',
      expiresAt: Date.now() + 5 * 60_000,
    });
    pairStatus.mockResolvedValue({ status: 'pending' });
    const w = mount(PairingCard, { attachTo: document.body });
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    expect(pairRequest).toHaveBeenCalledTimes(1);

    // Tick polling pertama → masih pending, tidak ada refresh.
    await vi.advanceTimersByTimeAsync(4_500);
    await flushPromises();
    expect(pairStatus).toHaveBeenCalledWith('ABCD2345');
    expect(pairRequest).toHaveBeenCalledTimes(1);

    // Tick berikutnya → consumed: banner muncul, lalu kode baru otomatis.
    pairStatus.mockResolvedValue({ status: 'consumed' });
    await vi.advanceTimersByTimeAsync(4_500);
    await flushPromises();
    expect(w.find('[data-test="pairing-consumed"]').exists()).toBe(true);
    // Jeda "biar user lihat banner" 1.5s sebelum request baru:
    await vi.advanceTimersByTimeAsync(1_600);
    await flushPromises();
    expect(pairRequest).toHaveBeenCalledTimes(2);
    w.unmount();
    document.body.innerHTML = '';
  });

  it('polling berhenti saat komponen unmount (tidak ada request liar)', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    pairRequest.mockResolvedValue({
      code: 'ABCD2345',
      qrUrl: 'https://app/login?pair=ABCD2345',
      expiresAt: Date.now() + 5 * 60_000,
    });
    pairStatus.mockResolvedValue({ status: 'pending' });
    const w = mount(PairingCard, { attachTo: document.body });
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    w.unmount();
    document.body.innerHTML = '';
    await vi.advanceTimersByTimeAsync(20_000);
    await flushPromises();
    expect(pairStatus).not.toHaveBeenCalled();
    expect(pairRequest).toHaveBeenCalledTimes(1);
  });
});
