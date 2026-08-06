import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import KulonCoursesView from './KulonCoursesView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';

vi.mock('../api/client', () => ({ getCourses: vi.fn(), getCourseContent: vi.fn(), getAssignments: vi.fn(), getAllAssignments: vi.fn() }));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

function mockStore() {
  const store = { isAuthenticated: true, checking: false, login: vi.fn(), logout: vi.fn(), user: null, fetchMe: vi.fn().mockResolvedValue('ok') };
  (useAuthStore as any).mockReturnValue(store);
}

describe('KulonCoursesView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockStore();
  });

  it('shows current semester grid and hides past behind collapse', async () => {
    (api.getCourses as any).mockResolvedValue([
      { id: 1, fullname: 'Matkul Baru', shortname: 'B', idnumber: '', semester: '2025/2026 Genap' },
      { id: 2, fullname: 'Matkul Lama', shortname: 'L', idnumber: '', semester: '2024/2025 Ganjil' },
    ]);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/matakuliah');
    const w = mount(KulonCoursesView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.findAll('[data-test="course-card"]').length).toBe(1); // hanya semester aktif
    expect(w.text()).toContain('Semester 2024/2025 Ganjil');
    // expand past
    await w.find('[data-test="expand-past"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-test="course-card"]').length).toBe(2);
  });

  it('shows empty state when no courses', async () => {
    (api.getCourses as any).mockResolvedValue([]);
    const router = buildRouter(createMemoryHistory());
    await router.push('/kulon/matakuliah');
    const w = mount(KulonCoursesView, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain('Belum ada mata kuliah yang diambil');
  });
});