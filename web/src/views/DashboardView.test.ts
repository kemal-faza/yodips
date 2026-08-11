import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, type Router } from 'vue-router';
import { buildRouter } from '../router';
import DashboardView from './DashboardView.vue';
import * as api from '../api/client';
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

function watchPush(router: Router): { awaitPush: () => Promise<void> } {
  let pending: Promise<unknown> | null = null;
  const orig = router.push.bind(router);
  router.push = ((...args: unknown[]) => { pending = orig(...(args as Parameters<Router['push']>)); return pending; }) as Router['push'];
  return { awaitPush: async () => { if (pending) await pending; await flushPromises(); } };
}

describe('DashboardView (academic dashboard)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
    mockStore();
    healthyApi();
  });

  it('renders the academic dashboard after load', async () => {
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    expect(w.text()).toContain('Halo, Anindita');
    expect(w.text()).toContain('3.71');       // IPK
    expect(w.text()).toContain('Layanan');    // ServiceGrid below
  });

  it('renders service navigation to /siap', async () => {
    const router = buildRouter(createMemoryHistory());
    const { awaitPush } = watchPush(router);
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    await w.find('[data-test="service-siap"]').trigger('click');
    await awaitPush();
    expect(router.currentRoute.value.path).toBe('/siap');
  });

  it('renders service navigation to /kulon/dashboard', async () => {
    const router = buildRouter(createMemoryHistory());
    const { awaitPush } = watchPush(router);
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    await w.find('[data-test="service-kulon"]').trigger('click');
    await awaitPush();
    expect(router.currentRoute.value.path).toBe('/kulon/dashboard');
  });

  it('shows a SIAP error banner while keeping Kulon visible', async () => {
    mockApi.getSiapProfile.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'SIAP down' } } }));
    const router = buildRouter(createMemoryHistory());
    const w = mount(DashboardView, { global: { plugins: [router], stubs } });
    await flushPromises();
    expect(w.text()).toContain('SIAP down');
    expect(w.text()).toContain('Halo, Pengguna'); // header fallback still renders
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
});
