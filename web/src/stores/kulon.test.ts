import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useKulonStore } from './kulon';
import * as api from '../api/client';
import { clearCache } from '../api/cache';

vi.mock('../api/client', () => ({
  getAllAssignments: vi.fn(), getAssignments: vi.fn(),
  getCourses: vi.fn(),
  getCourseContent: vi.fn(),
}));

describe('KulonStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearCache();
    vi.clearAllMocks();
  });

  it('fetches assignments lazily and caches', async () => {
    const store = useKulonStore();
    (api.getAllAssignments as any).mockResolvedValue([{ id: 1 }]);
    await store.ensureAssignments();
    await store.ensureAssignments();
    expect(api.getAllAssignments).toHaveBeenCalledTimes(1);
    expect(store.assignments).toEqual([{ id: 1 }]);
  });

  it('fetches courses lazily', async () => {
    const store = useKulonStore();
    (api.getCourses as any).mockResolvedValue([{ id: 2 }]);
    await store.ensureCourses();
    expect(api.getCourses).toHaveBeenCalledTimes(1);
  });

  it('fetches course content once (cache layer dedups)', async () => {
    const store = useKulonStore();
    (api.getCourseContent as any).mockResolvedValue({ courseId: 9, sections: [] });
    await store.ensureContent(9);
    await store.ensureContent(9);
    expect(api.getCourseContent).toHaveBeenCalledTimes(1);
  });

  it('clearCache empties the store caches', async () => {
    const store = useKulonStore();
    (api.getAllAssignments as any).mockResolvedValue([]);
    await store.ensureAssignments();
    clearCache();
    await store.ensureAssignments();
    expect(api.getAllAssignments).toHaveBeenCalledTimes(2); // cache purged → refetch
  });
});
