import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import DashboardView from './DashboardView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({
  getAssignments: vi.fn(),
}));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

const now = Date.now();
const sec = 1000;

describe('DashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders assignments grouped by course', async () => {
    (api.getAssignments as any).mockResolvedValue([
      { id: 1, name: 'T1', module: 'assign', eventType: 'due', duedate: (now + 3600 * sec) / sec, overdue: false, course: 'Matkul A', courseId: 1 },
    ]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Matkul A');
    expect(w.text()).toContain('T1');
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
    // First load fails with 401, then relogin succeeds and reload works.
    (api.getAssignments as any)
      .mockRejectedValueOnce({ response: { status: 401, data: { message: 'Session Kulon expired' } } })
      .mockResolvedValueOnce([
        { id: 1, name: 'T1', module: 'assign', eventType: 'due', duedate: (now + 3600 * sec) / sec, overdue: false, course: 'Matkul A', courseId: 1 },
      ]);
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Login Ulang');
    await w.findAll('button').find((b) => b.text().includes('Login Ulang'))!.trigger('click');
    await flushPromises();
    expect(store.login).toHaveBeenCalled();
    expect(w.text()).toContain('Matkul A');
  });
});