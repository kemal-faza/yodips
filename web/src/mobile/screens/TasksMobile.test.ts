import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

// Store mock deterministik (bentuk minimal yang dipakai layar).
const storeState = vi.hoisted(() => ({
  assignments: [] as any[],
  courses: [] as any[],
}));
vi.mock('../../stores/kulon', () => ({
  useKulonStore: vi.fn(() => ({
    ...storeState,
    ensureAssignments: vi.fn(async () => {}),
    ensureCourses: vi.fn(async () => {}),
  })),
}));

const session = vi.hoisted(() => ({
  sessionExpired: { value: false },
  error: { value: null as string | null },
  extract: vi.fn(() => ''),
  relogin: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('../../composables/useKulonSession', () => ({ useKulonSession: () => session }));

import TasksMobile from './TasksMobile.vue';

const course = { id: 1, fullname: 'PW', shortname: 'PW', idnumber: '', timelineStatus: 'inprogress' };
function task(id: number, over: Partial<any> = {}) {
  return {
    id, name: 'Tugas ' + id, module: 'assign', eventType: 'due', duedate: 1000 + id,
    overdue: false, course: 'PW', courseId: 1, ...over,
  };
}

beforeEach(() => {
  storeState.assignments = [];
  storeState.courses = [];
  session.sessionExpired.value = false;
  session.error.value = null;
});

describe('TasksMobile', () => {
  it('default filter "need": hanya aktif-semester, belum selesai, tak telat', async () => {
    storeState.assignments = [
      task(1),
      task(2, { submissionStatus: 'submitted' }), // done
      task(3, { overdue: true }), // late
      task(4, { courseId: 99 }), // non-aktif → hanya di "Semua"
    ];
    storeState.courses = [course];
    const w = mount(TasksMobile);
    await flushPromises();
    const rows = w.findAll('[data-test="task-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('Tugas 1');
  });

  it('chip Semua menampilkan semua + pill bucket benar', async () => {
    storeState.assignments = [task(1), task(2, { submissionStatus: 'graded' }), task(3, { overdue: true })];
    storeState.courses = [course];
    const w = mount(TasksMobile);
    await flushPromises();
    await w.find('[data-test="chip-all"]').trigger('click');
    expect(w.findAll('[data-test="task-row"]')).toHaveLength(3);
    expect(w.find('[data-test="pill-done"]').exists()).toBe(true);
    expect(w.find('[data-test="pill-late"]').exists()).toBe(true);
  });

  it('search memfilter nama/course case-insensitive', async () => {
    storeState.assignments = [task(1)];
    storeState.assignments[0].name = 'Laporan Khusus';
    storeState.courses = [course];
    const w = mount(TasksMobile);
    await flushPromises();
    await w.find('[data-test="chip-all"]').trigger('click');
    await w.find('[data-test="task-search"]').setValue('laporan');
    expect(w.findAll('[data-test="task-row"]')).toHaveLength(1);
    expect(w.text()).toContain('Laporan Khusus');
    await w.find('[data-test="task-search"]').setValue('zzz-tidak-ada');
    expect(w.findAll('[data-test="task-row"]')).toHaveLength(0);
  });

  it('paginasi 15/halaman + footer muat-lebih-banyak menambah halaman', async () => {
    storeState.assignments = Array.from({ length: 18 }, (_, i) => task(i + 1));
    storeState.courses = [course];
    const w = mount(TasksMobile);
    await flushPromises();
    await w.find('[data-test="chip-all"]').trigger('click');
    expect(w.findAll('[data-test="task-row"]')).toHaveLength(15);
    expect(w.find('[data-test="load-more"]').text()).toContain('(3 lagi)');
    await w.find('[data-test="load-more"]').trigger('click');
    expect(w.findAll('[data-test="task-row"]')).toHaveLength(18);
    expect(w.find('[data-test="load-more"]').exists()).toBe(false);
  });

  it('sesi kedaluwarsa menampilkan kartu relogin', async () => {
    session.sessionExpired.value = true;
    const w = mount(TasksMobile);
    await flushPromises();
    expect(w.find('[data-test="session-expired"]').exists()).toBe(true);
  });
});
