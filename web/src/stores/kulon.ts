import { defineStore } from 'pinia';
import { getAllAssignments, getCourses, getCourseContent } from '../api/client';
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
    assignmentsLoaded: false,
    courses: [] as Course[],
    coursesLoaded: false,
    contents: new Map<number, KulonCourseContent>(),
    hidden: loadHidden() as number[],
  }),
  actions: {
    async ensureAssignments(): Promise<void> {
      if (this.assignmentsLoaded) return;
      this.assignments = await getAllAssignments();
      this.assignmentsLoaded = true;
    },
    async ensureCourses(): Promise<void> {
      if (this.coursesLoaded) return;
      this.courses = await getCourses();
      this.coursesLoaded = true;
    },
    async ensureContent(courseId: number): Promise<void> {
      if (this.contents.has(courseId)) return;
      const content = await getCourseContent(courseId);
      this.contents.set(courseId, content);
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
    reset(): void {
      this.assignments = [];
      this.assignmentsLoaded = false;
      this.courses = [];
      this.coursesLoaded = false;
      this.contents.clear();
    },
  },
});
