import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import DashboardView from './DashboardView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({
  getAssignments: vi.fn(),
  getCourses: vi.fn(),
  getAssignmentDetail: vi.fn().mockResolvedValue({
    assignmentId: 1,
    name: 'T1',
    descriptionHtml: '<p>x</p>',
    files: [],
    submission: { status: 'not_submitted', grade: null, maxGrade: null },
    kulonUrl: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=1',
  }),
  getSiapProfile: vi.fn(),
  getSiapIrs: vi.fn(),
  getSiapKhs: vi.fn(),
}));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

const now = Date.now();
const sec = 1000;

function mkAssignment(id: number, name: string, duedateSec: number, overdue: boolean, course: string, courseId: number) {
  return {
    id, name, module: 'assign', eventType: 'due', duedate: duedateSec, overdue, course, courseId,
    assignmentId: id, courseModuleId: id + 1000,
  };
}

function mockStore(overrides: Record<string, unknown> = {}) {
  const store = {
    isAuthenticated: true,
    logout: vi.fn(),
    user: null,
    checking: false,
    login: vi.fn().mockResolvedValue(undefined),
    hasSiap: true,
    ...overrides,
  };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

describe('DashboardView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStore();
    (api.getCourses as any).mockResolvedValue([{ id: 1, fullname: 'Matkul A', shortname: 'A', idnumber: '' }]);
    (api.getSiapProfile as any).mockResolvedValue({
      nama: 'ANONIM UJI',
      nim: '24060121130000',
      prodi: 'Informatika S1',
      fakultas: 'SAINS DAN MATEMATIKA',
      angkatan: '2024',
      status: 'AKTIF',
      semesterBerjalan: '2026/2027 Ganjil',
    });
  });

  it('shows the SSO dashboard by default', async () => {
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Selamat datang di Undip SSO');
    expect(w.text()).toContain('Layanan');
  });

  it('navigates to SIAP view and shows the profile banner', async () => {
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('[data-test="service-siap"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('ANONIM UJI');
    expect(w.text()).toContain('24060121130000');
  });

  it('switches to the Biodata tab and shows detail fields', async () => {
    (api.getSiapProfile as any).mockResolvedValue({
      nama: 'ANONIM UJI',
      nim: '24060121130000',
      prodi: 'Informatika S1',
      fakultas: 'SAINS DAN MATEMATIKA',
      angkatan: '2024',
      status: 'AKTIF',
      semesterBerjalan: '2026/2027 Ganjil',
      tempatLahir: 'KOTA UJI',
      tanggalLahir: '01 Januari 2000',
      nik: '000000 000000 0000',
      namaIbu: 'IBU UJI',
    });
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('[data-test="service-siap"]').trigger('click');
    await w.findAll('button').find((b) => b.text().includes('Biodata'))!.trigger('mousedown');
    await flushPromises();
    expect(w.text()).toContain('KOTA UJI');
    expect(w.text()).toContain('000000 000000 0000');
  });

  it('renders assignments in the Tugas view (timeline headings)', async () => {
    (api.getAssignments as any).mockResolvedValue([
      mkAssignment(1, 'T1', (now - 3600 * sec) / sec, true, 'Matkul A', 1),
      mkAssignment(2, 'T2', (now + 3600 * sec) / sec, false, 'Matkul A', 1),
    ]);
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('[data-test="service-kulon"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Terlambat');
    expect(w.text()).toContain('Minggu Ini');
    expect(w.text()).toContain('T1');
    expect(w.text()).toContain('T2');
  });

  it('back button returns to the SSO dashboard', async () => {
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('[data-test="service-kulon"]').trigger('click');
    await flushPromises();
    await w.findAll('button').find((b) => b.text().includes('Kembali'))!.trigger('click');
    expect(w.text()).toContain('Selamat datang di Undip SSO');
  });

  it('shows a re-login prompt when the Kulon session expired (401)', async () => {
    (api.getAssignments as any).mockRejectedValue({
      response: { status: 401, data: { message: 'Session Kulon expired — silakan login ulang via SSO' } },
    });
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('[data-test="service-kulon"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Login Ulang');
    expect(w.text()).toContain('Session Kulon expired');
  });

  it('renders empty state in Tugas when no assignments', async () => {
    (api.getAssignments as any).mockResolvedValue([]);
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('[data-test="service-kulon"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Belum ada tugas');
  });
});
