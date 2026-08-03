import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CourseGroup from './CourseGroup.vue';
import type { Assignment } from '../types';

const now = Date.now();
const sec = 1000;

function make(id: number, name: string, course: string, courseId: number): Assignment {
  return { id, name, module: 'assign', eventType: 'due', duedate: (now + 5 * 24 * 3600 * sec) / sec, overdue: false, course, courseId };
}

describe('CourseGroup', () => {
  it('renders course headings and assignment cards', () => {
    const assignments = [
      make(1, 'T1', 'Matkul A', 1),
      make(2, 'T2', 'Matkul A', 1),
      make(3, 'T3', 'Matkul B', 2),
    ];
    const w = mount(CourseGroup, { props: { assignments } });
    expect(w.text()).toContain('Matkul A');
    expect(w.text()).toContain('Matkul B');
    expect(w.text()).toContain('T1');
    expect(w.text()).toContain('T2');
    expect(w.text()).toContain('T3');
  });
  it('renders empty state when no assignments', () => {
    const w = mount(CourseGroup, { props: { assignments: [] } });
    expect(w.text()).toContain('Belum ada tugas');
  });
});