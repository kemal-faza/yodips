import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useKulonStore } from './kulon';
import * as api from '../api/client';
import { clearCache, CacheStaleError } from '../api/cache';

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

  it('reset() clears user data but keeps device preferences', () => {
    const store = useKulonStore();
    store.assignments = [{ id: 1 } as any];
    store.courses = [{ id: 2 } as any];
    store.hide(7);
    store.reset();
    expect(store.assignments).toEqual([]);
    expect(store.courses).toEqual([]);
    expect(store.isHidden(7)).toBe(true); // local device preference, not server user data
  });
});

describe('KulonStore generation-stale consumer (CRITICAL)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearCache();
    vi.clearAllMocks();
  });

  it('deferred A completion after clearCache never writes the Pinia store', async () => {
    // Real cache layer + real Pinia store: the A-era fetch is in flight when
    // logout wipes the cache. The stale completion must neither populate the
    // store with logged-out-user data nor surface a user-facing error — the
    // waiter is cancelled silently and B refetches fresh.
    const store = useKulonStore();
    let resolveA!: (v: unknown) => void;
    (api.getAllAssignments as any).mockImplementation(
      () => new Promise((res) => { resolveA = res; }),
    );
    const pA = store.ensureAssignments(); // A-era, pending
    clearCache(); // logout wipe crosses the in-flight fetch
    resolveA([{ id: 1 }]); // A-era data arrives late
    await pA; // swallowed silently — never rejects to the view, never writes
    expect(store.assignments).toEqual([]); // no logged-out-user data in the store
    // B-era refetch after the wipe gets fresh data, never A data.
    (api.getAllAssignments as any).mockResolvedValue([{ id: 2 }]);
    await store.ensureAssignments();
    expect(store.assignments).toEqual([{ id: 2 }]);
  });

  it('deferred A courses completion after clearCache never writes the Pinia store', async () => {
    const store = useKulonStore();
    let resolveA!: (v: unknown) => void;
    (api.getCourses as any).mockImplementation(
      () => new Promise((res) => { resolveA = res; }),
    );
    const pA = store.ensureCourses();
    clearCache();
    resolveA([{ id: 9 }]);
    await pA;
    expect(store.courses).toEqual([]);
    (api.getCourses as any).mockResolvedValue([{ id: 10 }]);
    await store.ensureCourses();
    expect(store.courses).toEqual([{ id: 10 }]);
  });

  it('deferred A content completion after clearCache rejects typed (views swallow, never render stale)', async () => {
    const store = useKulonStore();
    let resolveA!: (v: unknown) => void;
    (api.getCourseContent as any).mockImplementation(
      () => new Promise((res) => { resolveA = res; }),
    );
    const pA = store.ensureContent(9);
    void pA.catch(() => {}); // typed stale rejection asserted below, never unhandled
    clearCache();
    resolveA({ courseId: 9, sections: [] });
    await expect(pA).rejects.toBeInstanceOf(CacheStaleError);
  });
});
