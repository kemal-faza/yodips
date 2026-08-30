import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { buildRouter } from '../router';
import DashboardView from './DashboardView.vue';
import * as api from '../api/client';
import { clearCache } from '../api/cache';
import { useAuthStore } from '../stores/auth';

vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));
vi.mock('../api/client', () => ({
  getCourses: vi.fn(), getAllAssignments: vi.fn(),
  getSiapProfile: vi.fn(), getSiapIrs: vi.fn(), getSiapKhs: vi.fn(), getSiapJadwal: vi.fn(),
}));

const mockApi = api as unknown as {
  getCourses: ReturnType<typeof vi.fn>; getAllAssignments: ReturnType<typeof vi.fn>;
  getSiapProfile: ReturnType<typeof vi.fn>; getSiapIrs: ReturnType<typeof vi.fn>; getSiapKhs: ReturnType<typeof vi.fn>;
  getSiapJadwal: ReturnType<typeof vi.fn>;
};

const stubs = {
  ChartIpTrend: true,
  ChartGradeDistribution: true,
  ChartSksCumulative: true,
  MorphingText: true,
};

function healthyApi() {
  mockApi.getCourses.mockResolvedValue([{ id: 1, fullname: 'Kecerdasan Buatan', shortname: 'PAIK6402', idnumber: '', semester: 'Ganjil 2025/2026', timelineStatus: 'inprogress' }]);
  mockApi.getAllAssignments.mockResolvedValue([{ id: 1, name: 'Tugas 1', module: 'assign', eventType: '', duedate: 999999999, overdue: false, course: 'Kecerdasan Buatan', courseId: 1, submissionStatus: 'not_submitted' }]);
  mockApi.getSiapProfile.mockResolvedValue({ nama: 'Anindita Rahmawati', nim: '24010122130001', prodi: 'S1 Informatika', fakultas: 'FSM', angkatan: '2022', ipk: 3.71, sksLulus: 108, status: 'AKTIF' });
  mockApi.getSiapKhs.mockResolvedValue({ ipk: 3.71, semesters: [{ semester: 'Gasal 22/23', ip: 3.52, totalSks: 20, nilai: [] }] });
  mockApi.getSiapIrs.mockResolvedValue({ semester: 'Ganjil 2025/2026', totalSks: 18, mataKuliah: [] });
  mockApi.getSiapJadwal.mockResolvedValue([]);
}

function mockStore() {
  const store = { isAuthenticated: true, logout: vi.fn(), user: null, checking: false, login: vi.fn().mockResolvedValue(undefined), hasSiap: true, fetchMe: vi.fn().mockResolvedValue('ok') };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

describe('DashboardView (academic dashboard)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
    setActivePinia(createPinia());
    clearCache();
    mockStore();
    healthyApi();
  });

  it('renders the academic dashboard after load', async () => {
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    expect(w.text()).toContain('Anindita Rahmawati');
    expect(w.text()).toContain('!');
    expect(w.text()).toContain('3.71');       // IPK
    expect(w.text()).toContain('Tugas dengan Deadline Terdekat');
    expect(w.text()).not.toContain('Layanan');
  });

  it('shows a SIAP error banner while keeping Kulon visible', async () => {
    mockApi.getSiapProfile.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'SIAP down' } } }));
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    expect(w.text()).toContain('SIAP down');
    expect(w.text()).toContain('Pengguna'); // header fallback still renders
  });

  it('renders chart paths without NaN coordinates (numeric-x regression guard)', async () => {
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    const paths = w.findAll('path');
    const nanPaths = paths.filter((p) => (p.attributes('d') ?? '').includes('NaN'));
    expect(nanPaths.length).toBe(0);
  });

  it('prefers KHS-computed IPK over the fragile profile IPK', async () => {
    mockApi.getSiapKhs.mockResolvedValue({ ipk: 3.78, semesters: [] });
    mockApi.getSiapProfile.mockResolvedValue({ nama: 'Aplin Nasution', nim: 'x', prodi: 'S1', fakultas: 'FSM', angkatan: '2024', ipk: 1, sksLulus: 108, status: 'AKTIF' });
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    expect(w.text()).toContain('3.78');
    expect(w.text()).not.toContain('1.00');
  });

  it('shows only "Perlu Dikerjakan" tasks with the new label', async () => {
    mockApi.getCourses.mockResolvedValue([
      { id: 1, fullname: 'Kecerdasan Buatan', shortname: 'PAIK6402', idnumber: '', semester: 'Ganjil 2025/2026', timelineStatus: 'inprogress' },
      { id: 2, fullname: 'Aplikasi Web', shortname: 'LBWEB001', idnumber: '', semester: 'Ganjil 2024/2025', timelineStatus: 'past' },
    ]);
    const base = { id: 0, name: '', module: 'assign', eventType: '', duedate: 0, overdue: false, course: '', courseId: 0, submissionStatus: 'not_submitted' as const };
    mockApi.getAllAssignments.mockResolvedValue([
      { ...base, id: 1, name: 'Aktif Belum', duedate: 100, course: 'Kecerdasan Buatan', courseId: 1 },
      { ...base, id: 2, name: 'Sudah Dikerjakan', duedate: 200, course: 'Kecerdasan Buatan', courseId: 1, submissionStatus: 'submitted' },
      { ...base, id: 3, name: 'Terlambat', duedate: 300, overdue: true, course: 'Kecerdasan Buatan', courseId: 1 },
      { ...base, id: 4, name: 'Kursus Nonaktif', duedate: 400, course: 'Aplikasi Web', courseId: 2 },
      { ...base, id: 5, name: 'Lima', duedate: 400, course: 'Kecerdasan Buatan', courseId: 1 },
      { ...base, id: 6, name: 'Enam', duedate: 500, course: 'Kecerdasan Buatan', courseId: 1 },
      { ...base, id: 7, name: 'Tujuh', duedate: 200, course: 'Kecerdasan Buatan', courseId: 1 },
      { ...base, id: 8, name: 'Delapan', duedate: 300, course: 'Kecerdasan Buatan', courseId: 1 },
    ]);
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    expect(w.find('[data-test="deadline-section"]').text()).toContain('Tugas dengan Deadline Terdekat');
    const section = w.find('[data-test="deadline-section"]').find('.assignment-card');
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain('Aktif Belum');
    expect(section.text()).not.toContain('Sudah Dikerjakan');
    expect(section.text()).not.toContain('Terlambat');
    expect(section.text()).not.toContain('Kursus Nonaktif');
    const cards = w.find('[data-test="deadline-section"]').findAll('.assignment-card');
    expect(cards.length).toBe(4);
    expect(cards.at(0)?.text()).toContain('Aktif Belum'); // nearest deadline (duedate 100)
    expect(cards.at(3)?.text()).toContain('Lima');        // 4th nearest (duedate 400)
    expect(w.find('[data-test="deadline-section"]').text()).not.toContain('Enam'); // 5th nearest → excluded
  });

  it('renders the empty state when no assignment matches the "need" predicate', async () => {
    mockApi.getCourses.mockResolvedValue([
      { id: 1, fullname: 'Kecerdasan Buatan', shortname: 'PAIK6402', idnumber: '', semester: 'Ganjil 2025/2026', timelineStatus: 'inprogress' },
    ]);
    const base = { id: 0, name: '', module: 'assign', eventType: '', duedate: 0, overdue: false, course: '', courseId: 0, submissionStatus: 'not_submitted' as const };
    mockApi.getAllAssignments.mockResolvedValue([
      { ...base, id: 1, name: 'Sudah Dikerjakan', duedate: 100, course: 'Kecerdasan Buatan', courseId: 1, submissionStatus: 'submitted' },
    ]);
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    const section = w.find('[data-test="deadline-section"]');
    expect(section.text()).toContain('Tidak ada tugas yang perlu dikerjakan.');
    expect(section.findAll('.assignment-card').length).toBe(0);
  });

  it('clips horizontal overflow and renders the full name in the greeting', async () => {
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    const root = w.find('div.space-y-8');
    expect(root.classes()).toContain('overflow-x-clip');
    const greeting = w.find('[data-test="greeting"]');
    expect(greeting.exists()).toBe(true);
    expect(greeting.text()).toContain('Anindita Rahmawati');
  });
});
