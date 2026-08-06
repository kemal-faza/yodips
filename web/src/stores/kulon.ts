import { defineStore } from 'pinia';
import { getAllAssignments, getCourses, getCourseContent } from '../api/client';
import type { Assignment, Course, KulonCourseContent } from '../types';

export const useKulonStore = defineStore('kulon', {
  state: () => ({
    assignments: [] as Assignment[],
    assignmentsLoaded: false,
    courses: [] as Course[],
    coursesLoaded: false,
    contents: new Map<number, KulonCourseContent>(),
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
    reset(): void {
      this.assignments = [];
      this.assignmentsLoaded = false;
      this.courses = [];
      this.coursesLoaded = false;
      this.contents.clear();
    },
  },
});
