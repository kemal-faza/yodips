import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const pairRequest = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ pairRequest }));

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
  toCanvas: vi.fn().mockResolvedValue(undefined),
}));

import PairingCard from './PairingCard.vue';

describe('PairingCard', () => {
  beforeEach(() => {
    pairRequest.mockReset();
  });

  it('menampilkan kode ter-group + countdown setelah request sukses', async () => {
    pairRequest.mockResolvedValue({
      code: 'ABCD2345',
      qrUrl: 'https://app/login?pair=ABCD2345',
      expiresAt: Date.now() + 5 * 60_000,
    });
    const w = mount(PairingCard);
    await w.find('[data-test="pairing-request"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="pairing-code"]').text()).toBe('ABCD 2345');
    expect(w.find('[data-test="pairing-countdown"]').text()).toMatch(/^\d{2}:\d{2}$/);
    expect(pairRequest).toHaveBeenCalledTimes(1);
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
