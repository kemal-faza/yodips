import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { buildRouter } from '../router';
import KulonCoursesView from './KulonCoursesView.vue';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { clearCache } from '../api/cache';

vi.mock('../api/client', () => ({ getCourses: vi.fn(), getCourseContent: vi.fn(), getAssignments: vi.fn(), getAllAssignments: vi.fn() }));
vi.mock('../stores/auth', () => ({ useAuthStore: vi.fn() }));

function mockStore() {
  const store = { isAuthenticated: true, checking: false, login: vi.fn(), logout: vi.fn(), user: null, fetchMe: vi.fn().mockResolvedValue('ok') };
  (useAuthStore as any).mockReturnValue(store);
}

function course(id: number, fullname: string, timelineStatus: 'inprogress' | 'past', semester: string | null = null) {
  return { id, fullname, shortname: fullname[0], idnumber: '', semester, timelineStatus };
}

async function mountView(courses: unknown[]) {
  (api.getCourses as any).mockResolvedValue(courses);
  const router = buildRouter(createMemoryHistory());
  await router.push('/kulon/matakuliah');
  const w = mount(KulonCoursesView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe('KulonCoursesView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    clearCache();
    mockStore();
  });

  it('menampilkan section aktif berjudul "Aktif" + subtitle semester tanpa badge pil', async () => {
    const w = await mountView([
      course(1, 'Matkul Baru', 'inprogress', '2025/2026 Genap'),
      course(2, 'Matkul Baru Lagi', 'inprogress', '2025/2026 Genap'),
    ]);
    const section = w.get('section');
    expect(section.find('h2').text()).toBe('Aktif');
    expect(section.text()).toContain('2025/2026 Genap');
    expect(w.findAll('[data-test="course-card"]').length).toBe(2);
    expect(w.findAll('span').filter((s) => s.classes().includes('rounded-full') && s.text() === 'Aktif')).toHaveLength(0);
  });

  it('menyembunyikan semester lama di satu collapse "Mata Kuliah Sebelumnya"', async () => {
    const w = await mountView([
      course(1, 'Matkul Baru', 'inprogress', '2025/2026 Genap'),
      course(2, 'Matkul Lama', 'past', '2024/2025 Ganjil'),
    ]);
    expect(w.findAll('[data-test="course-card"]').length).toBe(1);
    const btn = w.get('[data-test="expand-past"]');
    expect(btn.text()).toContain('Mata Kuliah Sebelumnya');
    expect(btn.text()).toContain('(1 mata kuliah)');
    expect(w.text()).not.toContain('Semester 2024/2025 Ganjil');
    await btn.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Semester 2024/2025 Ganjil');
    expect(w.findAll('[data-test="course-card"]').length).toBe(2);
  });

  it('melabeli matkul previous tanpa semester sebagai "Tanpa semester" tanpa kata "Lainnya"', async () => {
    const w = await mountView([
      course(1, 'Matkul Baru', 'inprogress', '2025/2026 Genap'),
      course(2, 'Matkul Anomali', 'past'),
    ]);
    await w.get('[data-test="expand-past"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Tanpa semester');
    expect(w.text()).not.toContain('Lainnya');
  });

  it('tidak merender collapse saat semua matkul ada di semester aktif', async () => {
    const w = await mountView([
      course(1, 'Matkul Baru', 'inprogress', '2025/2026 Genap'),
      course(2, 'Matkul Aktif Lagi', 'inprogress'),
    ]);
    expect(w.find('[data-test="expand-past"]').exists()).toBe(false);
    expect(w.findAll('[data-test="course-card"]').length).toBe(2);
  });

  it('tidak menampilkan subtitle semester saat semester aktif tidak terdeteksi', async () => {
    const w = await mountView([
      course(1, 'Matkul Tanpa Semester', 'inprogress'),
      course(2, 'Matkul Tanpa Semester Lagi', 'inprogress'),
    ]);
    const section = w.get('section');
    expect(section.find('h2').text()).toBe('Aktif');
    expect(section.text()).not.toContain('Lainnya');
    expect(w.findAll('[data-test="course-card"]').length).toBe(2);
  });

  it('menampilkan pesan aktif kosong + semua matkul di collapse saat tidak ada yang inprogress', async () => {
    const w = await mountView([
      course(1, 'Matkul Lama 1', 'past', '2024/2025 Ganjil'),
      course(2, 'Matkul Lama 2', 'past'),
    ]);
    const section = w.get('section');
    expect(section.text()).toContain('Belum ada mata kuliah aktif di semester ini.');
    expect(section.findAll('[data-test="course-card"]').length).toBe(0);
    expect(w.get('[data-test="expand-past"]').text()).toContain('(2 mata kuliah)');
  });

  it('menampilkan empty state saat tidak ada mata kuliah', async () => {
    const w = await mountView([]);
    expect(w.text()).toContain('Belum ada mata kuliah yang diambil');
  });
});