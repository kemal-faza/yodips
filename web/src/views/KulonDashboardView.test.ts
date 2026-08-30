import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import KulonDashboardView from './KulonDashboardView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { clearCache } from '../api/cache';

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
// courseId 10 -> course "Matkul A" in active semester "2025/2026 Genap"
// courseId 11 -> course "Matkul Lama" in an older semester "2023/2024 Ganjil"
const COURSES = [
  { id: 10, fullname: 'Matkul A', shortname: 'A', idnumber: '', semester: '2025/2026 Genap', timelineStatus: 'inprogress' },
  { id: 11, fullname: 'Matkul Lama', shortname: 'L', idnumber: '', semester: '2023/2024 Ganjil', timelineStatus: 'past' },
];

function mk(id: number, name: string, duedateSec: number, courseId = 10, extra: Record<string, unknown> = {}) {
  const courseName = courseId === 10 ? 'Matkul A' : 'Matkul Lama';
  return {
    id, name, module: 'assign', eventType: 'due', duedate: duedateSec, course: courseName, courseId,
    assignmentId: id, courseModuleId: id + 1000, ...extra,
  };
}

function mockStore() {
  const store = { isAuthenticated: true, checking: false, login: vi.fn().mockResolvedValue(undefined), logout: vi.fn(), user: null, fetchMe: vi.fn().mockResolvedValue('ok') };
  (useAuthStore as any).mockReturnValue(store);
  return store;
}

async function mountView() {
  (api.getCourses as any).mockResolvedValue(COURSES);
  const router = buildRouter(createMemoryHistory());
  await router.push('/kulon/dashboard');
  const w = mount(KulonDashboardView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe('KulonDashboardView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    clearCache();
    mockStore();
  });

  it('shows current-semester, not-done, not-overdue tasks in "perlu dikerjakan" (default), sorted by nearest deadline', async () => {
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'Near', now + 200 * sec, 10, { overdue: false }),   // current sem, not due -> shown
      mk(2, 'Soon', now + 50 * sec, 10, { overdue: false }),    // current sem, nearest deadline
      mk(3, 'OldSem', now + 300 * sec, 11, { overdue: false }), // older semester -> hidden from need
      { ...mk(4, 'Overdue', now + 100 * sec, 10), overdue: true }, // overdue -> not in need
    ]);
    const w = await mountView();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    // need view: Soon (nearest) then Near
    expect(names.length).toBe(2);
    expect(names[0]).toContain('Soon');
    expect(names[1]).toContain('Near');
  });

  it('shows overdue current-semester task in "terlambat" filter', async () => {
    (api.getAllAssignments as any).mockResolvedValue([mk(4, 'Overdue', now + 100 * sec, 10, { overdue: true })]);
    const w = await mountView();
    const chips = w.findAll('[data-test="view-filter"]');
    await chips[3].trigger('click'); // index 3 = late
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names.length).toBe(1);
    expect(names[0]).toContain('Overdue');
  });

  it('filters by search on name', async () => {
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'Tugas Kripto', now + 100 * sec, 10),
      mk(2, 'Tugas Numerik', now + 200 * sec, 10),
    ]);
    const w = await mountView();
    await w.find('[data-test="search"]').setValue('Numerik');
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names.length).toBe(1);
    expect(names[0]).toContain('Tugas Numerik');
  });

  it('paginates when > PAGE_SIZE items', async () => {
    const items = Array.from({ length: 25 }, (_, i) => mk(i, `T${i}`, now + (i + 1) * 100 * sec, 10));
    (api.getAllAssignments as any).mockResolvedValue(items);
    const w = await mountView();
    expect(w.findAll('.assignment-card').length).toBe(20);
    await w.find('[data-test="next"]').trigger('click');
    await flushPromises();
    expect(w.findAll('.assignment-card').length).toBe(5);
  });

  it('shows empty state when no match', async () => {
    (api.getAllAssignments as any).mockResolvedValue([mk(1, 'T1', now + 100 * sec, 10)]);
    const w = await mountView();
    await w.find('[data-test="search"]').setValue('zzz');
    await flushPromises();
    expect(w.text()).toContain('Tidak ada tugas yang cocok');
  });

  it('"selesai" filter shows submitted tasks across semesters', async () => {
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'DoneActive', now + 100 * sec, 10, { submissionStatus: 'submitted' }),
      { ...mk(2, 'DoneOld', now + 100 * sec, 11), submissionStatus: 'graded' },
    ]);
    const w = await mountView();
    const chips = w.findAll('[data-test="view-filter"]');
    await chips[2].trigger('click'); // index 2 = done
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names.length).toBe(2);
  });

  it('hide button in "perlu dikerjakan" removes the task (persisted)', async () => {
    (api.getAllAssignments as any).mockResolvedValue([
      mk(1, 'A', now + 100 * sec, 10, { overdue: false }),
      mk(2, 'B', now + 200 * sec, 10, { overdue: false }),
    ]);
    const w = await mountView();
    // hide the first card
    await w.findAll('[data-test="hide-assignment"]')[0].trigger('click');
    await flushPromises();
    const names = w.findAll('.assignment-card').map((c) => c.text());
    expect(names.length).toBe(1);
    // persisted to localStorage
    expect(JSON.parse(localStorage.getItem('sso_hidden_assignments') || '[]')).toHaveLength(1);
    // hidden section lists it — clicking Pulihkan restores it
    expect(w.find('[data-test="unhide-assignment"]').exists()).toBe(true);
    await w.find('[data-test="unhide-assignment"]').trigger('click');
    await flushPromises();
    expect(JSON.parse(localStorage.getItem('sso_hidden_assignments') || '[]')).toHaveLength(0);
    expect(w.findAll('.assignment-card').length).toBe(2);
  });

  it('opens the Kulon quiz page directly when a quiz card is clicked', async () => {
    const quiz = { ...mk(7, 'Kuis 4', now + 100 * sec, 10), module: 'quiz', courseModuleId: 114796 };
    (api.getAllAssignments as any).mockResolvedValue([quiz]);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const w = await mountView();
    await w.find('.assignment-card').trigger('click');
    await flushPromises();
    expect(openSpy).toHaveBeenCalledWith(
      'https://kulon2.undip.ac.id/mod/quiz/view.php?id=114796',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });
});
