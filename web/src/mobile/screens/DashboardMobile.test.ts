import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const push = vi.hoisted(() => vi.fn());
const dash = vi.hoisted(() => ({
  siapLoading: { value: false },
  siapError: { value: null as string | null },
  siap: {
    value: {
      profile: { nama: 'MUHAMAD', nim: '24060120120001', prodi: 'Informatika S1', ipk: 3.65, sksLulus: 98 },
      khs: { ipk: 3.65, semesters: [] },
      irs: null,
      jadwal: [
        { hari: 'Senin', matakuliah: 'Pemrograman Web', waktu: '09:40:00 s/d 12:10:00', sks: 3, tanggal: '2026-08-24' },
      ],
    },
  },
  kulonLoading: { value: false },
  kulonError: { value: null as string | null },
  kulon: {
    value: {
      courses: [{ id: 1, fullname: 'PW', shortname: 'PW', idnumber: '', timelineStatus: 'inprogress' }],
      assignments: [
        { id: 1, name: 'Tugas A', module: 'assign', eventType: 'due', duedate: 1756000000, overdue: false, course: 'PW', courseId: 1 },
        { id: 2, name: 'Tugas B', module: 'assign', eventType: 'due', duedate: 1756100000, overdue: false, course: 'PW', courseId: 1 },
        { id: 3, name: 'Tugas C', module: 'assign', eventType: 'due', duedate: 1756200000, overdue: false, course: 'PW', courseId: 1, submissionStatus: 'submitted' },
      ],
    },
  },
  load: () => {},
}));

vi.mock('../../composables/useDashboard', () => ({ useDashboard: () => dash }));
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push }),
}));

import DashboardMobile from './DashboardMobile.vue';

// push dipakai lintas-test (mock module-level) — bersihkan agar
// toHaveBeenNthCalledWith tidak melihat panggilan test sebelumnya.
beforeEach(() => {
  push.mockClear();
});

describe('DashboardMobile', () => {
  it('kartu sapaan: nama/prodi/NIM', () => {
    const w = mount(DashboardMobile);
    expect(w.find('[data-test="greeting"]').text()).toContain('MUHAMAD');
    expect(w.find('[data-test="greeting"]').text()).toContain('Informatika S1');
    expect(w.find('[data-test="greeting"]').text()).toContain('24060120120001');
  });

  it('chip statistik: IPK/SKS/perlu/terlambat', () => {
    const w = mount(DashboardMobile);
    expect(w.find('[data-test="stat-ipk"]').text()).toBe('3.65');
    expect(w.find('[data-test="stat-sks"]').text()).toBe('98');
    expect(w.find('[data-test="stat-need"]').text()).toBe('2');
    expect(w.find('[data-test="stat-late"]').text()).toBe('0');
  });

  it('tugas terdekat buang selesai; tombol lihat-semua navigasi', async () => {
    const w = mount(DashboardMobile);
    expect(w.findAll('[data-test="upcoming-row"]')).toHaveLength(2);
    await w.find('[data-test="upcoming-all"]').trigger('click');
    expect(push).toHaveBeenCalledWith('/kulon/dashboard');
  });

  it('pintasan IRS/KHS/Presensi navigasi', async () => {
    const w = mount(DashboardMobile);
    await w.find('[data-test="quick-irs"]').trigger('click');
    await w.find('[data-test="quick-khs"]').trigger('click');
    await w.find('[data-test="quick-presensi"]').trigger('click');
    expect(push).toHaveBeenNthCalledWith(1, '/irs');
    expect(push).toHaveBeenNthCalledWith(2, '/khs');
    expect(push).toHaveBeenNthCalledWith(3, '/presensi');
  });

  it('jadwal hari ini dirender dengan waktu emdash', async () => {
    // toFake DIBATASI: flushPromises VTU memakai setImmediate — kalau ikut
    // di-fake, await-nya deadlock (lihat preceden stores/auth.test.ts).
    vi.useFakeTimers({ now: new Date(2026, 7, 24, 8, 0, 0), toFake: ['setTimeout', 'clearTimeout', 'Date'] }); // 2026-08-24
    try {
      const w = mount(DashboardMobile);
      await flushPromises();
      expect(w.find('[data-test="today-row"]').text()).toContain('Pemrograman Web');
      expect(w.find('[data-test="today-row"]').text()).toContain('09:40 — 12:10');
    } finally {
      vi.useRealTimers();
    }
  });
});
