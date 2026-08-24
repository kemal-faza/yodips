import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getSiapKhs = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ getSiapKhs }));

import KhsMobile from './KhsMobile.vue';

const FIX = {
  ipk: 3.65,
  semesters: [
    { semester: '1', ip: 3.5, totalSks: 21, nilai: [{ mataKuliah: 'Alprog', sks: 3, nilaiHuruf: 'A' }] },
    { semester: '2', ip: 3.8, totalSks: 22, nilai: [{ mataKuliah: 'Basdat', sks: 3, nilaiHuruf: 'AB' }] },
  ],
};

beforeEach(() => {
  getSiapKhs.mockReset().mockResolvedValue(FIX);
});

describe('KhsMobile', () => {
  it('kartu IPK dari footer tepercaya', async () => {
    const w = mount(KhsMobile);
    await flushPromises();
    expect(w.find('[data-test="ipk-value"]').text()).toBe('3.65');
    expect(w.text()).toContain('IP. Kumulatif');
  });

  it('accordion: semester pertama terbuka; klik toggles', async () => {
    // attachTo body: jsdom 26 TIDAK meng-invalidate cache getComputedStyle
    // untuk pohon DETACHED ketika v-show menghapus style.display lewat
    // CSSOM (removeProperty) — sehingga isVisible() sebelum-klik meng-cache
    // "none" dan bacaan sesudah-klik tetap stale. Pohon TER-ATTACH validasi
    // ulang dengan benar. Pola sama dengan PairingCard.test.ts.
    const w = mount(KhsMobile, { attachTo: document.body });
    await flushPromises();
    const bodies = w.findAll('[data-test="semester-body"]');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].isVisible()).toBe(true);
    expect(bodies[1].isVisible()).toBe(false);
    await w.findAll('[data-test="semester-toggle"]')[1].trigger('click');
    expect(bodies[1].isVisible()).toBe(true);
    expect(bodies[1].text()).toContain('Basdat');
    expect(bodies[1].text()).toContain('AB');
    expect(bodies[1].text()).toContain('SKS 22');
    await w.findAll('[data-test="semester-toggle"]')[1].trigger('click');
    expect(bodies[1].isVisible()).toBe(false);
    w.unmount();
    document.body.innerHTML = '';
  });

  it('error fetch menampilkan pesan generik', async () => {
    getSiapKhs.mockRejectedValue(new Error('down'));
    const w = mount(KhsMobile);
    await flushPromises();
    expect(w.text()).toContain('Gagal memuat KHS.');
  });
});
