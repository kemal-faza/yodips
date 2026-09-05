import { defineStore } from 'pinia';
import { getAllAssignments, getCourses, getCourseContent } from '../api/client';
import { getCached, isCacheStaleError } from '../api/cache';
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
      // Generation-stale (logout crossed the fetch) is swallowed silently:
      // the store stays wiped and no user-facing error is raised. The typed
      // rejection only ever fires on the logout path, never on backend failure.
      try {
        this.assignments = await getCached('kulon:assignments', getAllAssignments, {
          freshTtl: 3 * 60_000,
          staleTtl: 15 * 60_000,
        });
      } catch (e) {
        if (isCacheStaleError(e)) return;
        throw e;
      }
    },
    async ensureCourses(): Promise<void> {
      // Same stale-swallow as ensureAssignments (see above).
      try {
        this.courses = await getCached('kulon:courses', getCourses, {
          freshTtl: 5 * 60_000,
          staleTtl: 30 * 60_000,
        });
      } catch (e) {
        if (isCacheStaleError(e)) return;
        throw e;
      }
    },
    async ensureContent(courseId: number): Promise<KulonCourseContent> {
      // Returns data, so a stale fetch cannot be swallowed here — the typed
      // rejection propagates and views discard it silently (never render
      // pre-wipe content, never raise a banner). See KulonCourseDetailView.
      return getCached(`kulon:content:${courseId}`, () => getCourseContent(courseId), {
        freshTtl: 5 * 60_000,
        staleTtl: 30 * 60_000,
      });
    },
    isHidden(id: number): boolean {
      return this.hidden.includes(id);
    },
    /**
     * Drop server user data on logout/session wipe so a next login (possibly
     * a different account on the same device) never flashes the previous
     * user's assignments/courses. `hidden` is a local device preference
     * (localStorage-persisted IDs, no content) and is intentionally kept.
     */
    reset() {
      this.assignments = [];
      this.courses = [];
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
