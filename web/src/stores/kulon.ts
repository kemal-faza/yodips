import { defineStore } from 'pinia';
import { getAllAssignments, getCourses, getCourseContent } from '../api/client';
import { getCached } from '../api/cache';
import type { Assignment, Course, KulonCourseContent } from '../types';

const HIDDEN_KEY = 'sso_hidden_assignments';

function loadHidden(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export const useKulonStore = defineStore('kulon', {
  state: () => ({
    assignments: [] as Assignment[],
    courses: [] as Course[],
    hidden: loadHidden() as number[],
  }),
  actions: {
    async ensureAssignments(): Promise<void> {
      this.assignments = await getCached('kulon:assignments', getAllAssignments, {
        freshTtl: 3 * 60_000,
        staleTtl: 15 * 60_000,
      });
    },
    async ensureCourses(): Promise<void> {
      this.courses = await getCached('kulon:courses', getCourses, {
        freshTtl: 5 * 60_000,
        staleTtl: 30 * 60_000,
      });
    },
    async ensureContent(courseId: number): Promise<KulonCourseContent> {
      return getCached(`kulon:content:${courseId}`, () => getCourseContent(courseId), {
        freshTtl: 5 * 60_000,
        staleTtl: 30 * 60_000,
      });
    },
    isHidden(id: number): boolean {
      return this.hidden.includes(id);
    },
    hide(id: number): void {
      if (this.hidden.includes(id)) return;
      this.hidden.push(id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(this.hidden));
    },
    unhide(id: number): void {
      this.hidden = this.hidden.filter((h) => h !== id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(this.hidden));
    },
  },
});
