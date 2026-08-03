import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import DashboardView from './DashboardView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({
  getAssignments: vi.fn(),
  getCourses: vi.fn(),
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
    (api.getCourses as any).mockResolvedValue([]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Matkul A');
    expect(w.text()).toContain('T1');
  });

  it('renders empty state when no assignments', async () => {
    (api.getAssignments as any).mockResolvedValue([]);
    (api.getCourses as any).mockResolvedValue([]);
    (useAuthStore as any).mockReturnValue({ isAuthenticated: true, logout: vi.fn(), user: null });
    const w = mount(DashboardView);
    await flushPromises();
    expect(w.text()).toContain('Belum ada tugas');
  });
});