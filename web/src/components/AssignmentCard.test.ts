import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AssignmentCard from './AssignmentCard.vue';
import type { Assignment } from '../types';

const now = Date.now();
const sec = 1000;

function make(due: number, overdue = false): Assignment {
  return { id: 1, name: 'Tugas Besar', module: 'assign', eventType: 'due', duedate: due / sec, overdue, course: 'Matkul', courseId: 1 };
}

describe('AssignmentCard', () => {
  it('shows assignment name', () => {
    const w = mount(AssignmentCard, { props: { assignment: make(now + 5 * 24 * 3600 * sec) } });
    expect(w.text()).toContain('Tugas Besar');
  });
  it('shows overdue badge for overdue assignment', () => {
    const w = mount(AssignmentCard, { props: { assignment: make(now - 1000, true) } });
    expect(w.text()).toContain('Terlambat');
  });
  it('shows overdue badge for past deadline', () => {
    const w = mount(AssignmentCard, { props: { assignment: make(now - 1000) } });
    expect(w.text()).toContain('Terlambat');
  });
});