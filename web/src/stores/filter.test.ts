import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFilterStore } from './filter';

describe('filter store', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('has sensible defaults', () => {
    const store = useFilterStore();
    expect(store.search).toBe('');
    expect(store.status).toBe('all');
    expect(store.courseId).toBe('all');
    expect(store.sortBy).toBe('deadlineAsc');
    expect(store.viewMode).toBe('timeline');
  });

  it('setSearch updates search', () => {
    const store = useFilterStore();
    store.setSearch('uts');
    expect(store.search).toBe('uts');
  });

  it('setStatus updates status', () => {
    const store = useFilterStore();
    store.setStatus('overdue');
    expect(store.status).toBe('overdue');
  });

  it('setCourseId updates courseId', () => {
    const store = useFilterStore();
    store.setCourseId(3);
    expect(store.courseId).toBe(3);
  });

  it('setSortBy updates sortBy', () => {
    const store = useFilterStore();
    store.setSortBy('name');
    expect(store.sortBy).toBe('name');
  });

  it('setViewMode updates viewMode and persists to localStorage', () => {
    const store = useFilterStore();
    store.setViewMode('course');
    expect(store.viewMode).toBe('course');
    expect(localStorage.getItem('sso_view_mode')).toBe('course');
  });

  it('restores persisted viewMode from localStorage on init', () => {
    localStorage.setItem('sso_view_mode', 'course');
    const store = useFilterStore();
    expect(store.viewMode).toBe('course');
  });
});
