import { defineStore } from 'pinia';
import type { AssignmentStatus } from '../types';

export type ViewMode = 'timeline' | 'course';
export type SortKey = 'deadlineAsc' | 'deadlineDesc' | 'name' | 'course';

const VIEW_MODE_KEY = 'sso_view_mode';

export const useFilterStore = defineStore('filter', {
  state: () => ({
    search: '',
    status: 'all' as AssignmentStatus | 'all',
    courseId: 'all' as number | 'all',
    sortBy: 'deadlineAsc' as SortKey,
    viewMode: (localStorage.getItem(VIEW_MODE_KEY) ?? 'timeline') as ViewMode,
  }),
  actions: {
    setSearch(v: string): void {
      this.search = v;
    },
    setStatus(v: AssignmentStatus | 'all'): void {
      this.status = v;
    },
    setCourseId(v: number | 'all'): void {
      this.courseId = v;
    },
    setSortBy(v: SortKey): void {
      this.sortBy = v;
    },
    setViewMode(v: ViewMode): void {
      this.viewMode = v;
      localStorage.setItem(VIEW_MODE_KEY, v);
    },
  },
});
