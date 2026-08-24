import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const pairRequest = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ pairRequest }));

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
    toCanvas.mockClear();
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
});
