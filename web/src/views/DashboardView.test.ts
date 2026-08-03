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
}));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

const now = Date.now();
const sec = 1000;
const mkAssignment = (id: number, name: string, duedateSec: number, overdue: boolean, course: string, courseId: number) => ({
  id, name, module: 'assign', eventType: 'due', duedate: duedateSec, overdue, course, courseId,
  assignmentId: id, courseModuleId: id + 1000,
});

describe('DashboardView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (api.getCourses as any).mockResolvedValue([
      { id: 1, fullname: 'Matkul A', shortname: 'A', idnumber: '' },
    ]);
  });

  it('renders assignments in timeline (period headings) by default', async () => {
    (api.getAssignments as any).mockResolvedValue([
      mkAssignment(1, 'T1', (now - 3600 * sec) / sec, true, 'Matkul A', 1),
      // +1h is always within the current week regardless of which day it is
      // today (never crosses the next-Monday boundary), deterministic any day.
      mkAssignment(2, 'T2', (now + 3600 * sec) / sec, false, 'Matkul A', 1),
    ]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Terlambat');
    expect(w.text()).toContain('Minggu Ini');
    expect(w.text()).toContain('T1');
    expect(w.text()).toContain('T2');
  });

  it('switches to course grouping when Per Mata Kuliah clicked', async () => {
    (api.getAssignments as any).mockResolvedValue([
      mkAssignment(1, 'T1', (now + 2 * 86400 * sec) / sec, false, 'Matkul A', 1),
    ]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Per Mata Kuliah'))!;
    await btn.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Matkul A');
  });

  it('filters by status select', async () => {
    (api.getAssignments as any).mockResolvedValue([
      mkAssignment(1, 'OverdueT', (now - 3600 * sec) / sec, true, 'Matkul A', 1),
      mkAssignment(2, 'TrackT', (now + 100 * 86400 * sec) / sec, false, 'Matkul A', 1),
    ]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('select[data-test="status"]').setValue('overdue');
    await flushPromises();
    expect(w.text()).toContain('OverdueT');
    expect(w.text()).not.toContain('TrackT');
  });

  it('opens DetailPanel when an assignment card is clicked', async () => {
    (api.getAssignments as any).mockResolvedValue([
      mkAssignment(1, 'T1', (now + 2 * 86400 * sec) / sec, false, 'Matkul A', 1),
    ]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    await w.find('.assignment-card').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Buka di Kulon');
    expect(document.body.textContent).toContain('Deskripsi');
  });

  it('renders empty state when no assignments', async () => {
    (api.getAssignments as any).mockResolvedValue([]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Belum ada tugas');
  });

  it('shows re-login prompt when session expired (401)', async () => {
    (api.getAssignments as any).mockRejectedValue({
      response: { status: 401, data: { message: 'Session Kulon expired — silakan login ulang via SSO' } },
    });
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null, checking: false });
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Login Ulang');
    expect(w.text()).toContain('Session Kulon expired');
  });

  it('relogin re-captures and reloads assignments', async () => {
    const store = {
      isAuthenticated: true,
      logout: vi.fn(),
      user: null,
      checking: false,
      login: vi.fn().mockResolvedValue(undefined),
    };
    (useAuthStore as any).mockReturnValue(store);
    (api.getAssignments as any)
      .mockRejectedValueOnce({ response: { status: 401, data: { message: 'Session Kulon expired' } } })
      .mockResolvedValueOnce([
        mkAssignment(1, 'T1', (now + 2 * 86400 * sec) / sec, false, 'Matkul A', 1),
      ]);
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Login Ulang');
    await w.findAll('button').find((b) => b.text().includes('Login Ulang'))!.trigger('click');
    await flushPromises();
    expect(store.login).toHaveBeenCalled();
    expect(w.text()).toContain('T1');
  });
});