import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push }),
}));

const logoutFn = vi.hoisted(() => vi.fn());
vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ user: { sub: '24060120120001' }, fotoUrl: null, logout: logoutFn }),
}));

const toggleFn = vi.hoisted(() => vi.fn());
vi.mock('../../stores/theme', () => ({
  useThemeStore: () => ({ dark: false, toggle: toggleFn }),
}));

const getSiapProfile = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ getSiapProfile }));
// PairingCard dirender layar — stub agar test fokus ke profil:
vi.mock('../../components/PairingCard.vue', () => ({
  default: { name: 'PairingCard', template: '<div data-test="pairing-stub" />' },
}));

import ProfileMobile from './ProfileMobile.vue';

beforeEach(() => {
  getSiapProfile.mockReset();
  logoutFn.mockClear();
  toggleFn.mockClear();
});

describe('ProfileMobile', () => {
  it('avatar inisial dari user.sub + grup biodata render', async () => {
    getSiapProfile.mockResolvedValue({
      nama: 'Budi', nim: '240601', prodi: 'Informatika', fakultas: 'FSM',
      angkatan: '2024', emailSso: 'b@u.ac.id',
    });
    const w = mount(ProfileMobile);
    expect(w.text()).toContain('Memuat');
    await flushPromises();
    expect(w.find('[data-test="profile-initial"]').text()).toBe('2');
    expect(w.text()).toContain('Budi');
    expect(w.text()).toContain('Data Diri');
    expect(w.text()).toContain('b@u.ac.id');
  });

  it('toggle dark mode memanggil theme.toggle()', async () => {
    getSiapProfile.mockResolvedValue({ nama: 'Budi', nim: '1', prodi: 'x', fakultas: 'y', angkatan: 'z' });
    const w = mount(ProfileMobile);
    await flushPromises();
    await w.find('[data-test="dark-toggle"]').trigger('click');
    expect(toggleFn).toHaveBeenCalledTimes(1);
  });

  it('logout membersihkan sesi (LOKAL saja) + push /login', async () => {
    getSiapProfile.mockResolvedValue({ nama: 'Budi', nim: '1', prodi: 'x', fakultas: 'y', angkatan: 'z' });
    const w = mount(ProfileMobile);
    await flushPromises();
    await w.find('[data-test="profile-logout"]').trigger('click');
    expect(logoutFn).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('error fetch menampilkan pesan generik', async () => {
    getSiapProfile.mockRejectedValue(new Error('boom'));
    const w = mount(ProfileMobile);
    await flushPromises();
    expect(w.text()).toContain('Gagal memuat profil.');
  });
});
