import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import KulonDashboardView from './KulonDashboardView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({
  getAllAssignments: vi.fn(),
getAssignments: vi.fn(),
  getCourses: vi.fn(),
  getCourseContent: vi.fn(),
  getAssignmentDetail: vi.fn().mockResolvedValue({
    assignmentId: 1, name: 'T1', descriptionHtml: '<p>x</p>', files: [],
    submission: { status: 'not_submitted', grade: null, maxGrade: null },
    kulonUrl: 'https://kulon2.undip.ac.id/mod/assign/view.php?id=1',
  }),
}));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

const now = Date.now();
const sec = 1000;
function mk(id: number, name: string, duedateSec: number, course: string, courseId: number) {
  return { id, name, module: 'assign', eventType: 'due', duedate: duedateSec, overdue: duedateSec * 1000 < now, course, courseId, assignmentId: id, courseModuleId: id + 1000 };
}

function mockStore() {
  const store = { isAuthenticated: true, checking: false, login: vi.fn().mockResolvedValue(undefined), logout: vi.fn(), user: null, fetchMe: vi.fn().mockResolvedValue('ok') };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

describe('KulonDashboardView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStore();
  });

  it('renders assignments sorted by deadline', async () => {
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'B', now + 200 * sec, 'Matkul A', 1),
      mk(2, 'A', now + 100 * sec, 'Matkul B', 2),
    ]);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    const w = mount(KulonDashboardView, { global: { plugins: [router] } });
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names[0]).toContain('A');
    expect(names[1]).toContain('B');
  });

  it('filters by search on name or course', async () => {
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'Tugas Kripto', now + 100 * sec, 'Keamanan', 1),
      mk(2, 'Tugas Numerik', now + 200 * sec, 'Metode Numerik', 2),
    ]);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    const w = mount(KulonDashboardView, { global: { plugins: [router] } });
    await flushPromises();
    await w.find('[data-test="search"]').setValue('Numerik');
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names.length).toBe(1);
    expect(names[0]).toContain('Tugas Numerik');
  });

  it('paginates when > PAGE_SIZE items', async () => {
    const items = Array.from({ length: 15 }, (_, i) => mk(i, `T${i}`, now + (i + 1) * 100 * sec, 'Matkul', 1));
    (api.getAllAssignments as any).mockResolvedValue(items);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    const w = mount(KulonDashboardView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.findAll('.assignment-card').length).toBe(10);
    await w.find('[data-test="next"]').trigger('click');
    await flushPromises();
    expect(w.findAll('.assignment-card').length).toBe(5);
  });

  it('shows empty state when no match', async () => {
    (api.getAllAssignments as any).mockResolvedValue([mk(1, 'T1', now + 100 * sec, 'Matkul', 1)]);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    const w = mount(KulonDashboardView, { global: { plugins: [router] } });
    await flushPromises();
    await w.find('[data-test="search"]').setValue('zzz');
    await flushPromises();
    expect(w.text()).toContain('Tidak ada tugas yang cocok');
  });

  it('filters by view chip to show only submitted (done)', async () => {
    const past = (now - 200 * sec) / sec; // overdue
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'A', past, 'Matkul', 1),
      { ...mk(2, 'B', past, 'Matkul', 1), submissionStatus: 'submitted' },
    ]);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/dashboard');
    const w = mount(KulonDashboardView, { global: { plugins: [router] } });
    await flushPromises();
    // click "Sudah dikerjakan"
    const chips = w.findAll('[data-test="view-filter"]');
    await chips[2].trigger('click'); // index 2 = done
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names.length).toBe(1);
    expect(names[0]).toContain('B');
  });
});