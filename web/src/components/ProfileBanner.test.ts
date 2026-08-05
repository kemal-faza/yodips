import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ProfileBanner from './ProfileBanner.vue';

const baseProfile = {
  nama: 'ANONIM UJI',
  nim: '24060121130000',
  prodi: 'Informatika S1',
  fakultas: 'SAINS DAN MATEMATIKA',
  angkatan: '2024',
  status: 'AKTIF',
  semesterBerjalan: '2026/2027 Ganjil',
};

describe('ProfileBanner', () => {
  it('renders name, NIM, prodi and photo', () => {
    const w = mount(ProfileBanner, {
      props: {
        profile: { ...baseProfile, fotoUrl: 'https://disk.undip.ac.id/ktm.jpg' },
        activeTab: 'dasbor',
      },
    });
    expect(w.text()).toContain('ANONIM UJI');
    expect(w.text()).toContain('24060121130000');
    expect(w.find('img').attributes('src')).toContain('disk.undip.ac.id');
  });

  it('shows initials fallback without foto and emits change-tab', async () => {
    const w = mount(ProfileBanner, { props: { profile: baseProfile, activeTab: 'dasbor' } });
    expect(w.text()).toContain('MK');
    await w.findAll('button').find((b) => b.text().includes('Biodata'))!.trigger('mousedown');
    expect(w.emitted('change-tab')?.[0]).toEqual(['biodata']);
  });

  it('highlights the active tab', () => {
    const w = mount(ProfileBanner, { props: { profile: baseProfile, activeTab: 'notifikasi' } });
    expect(w.findAll('button').some((b) => b.text() === 'Notifikasi')).toBe(true);
  });
});
