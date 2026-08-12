import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CourseCard from './CourseCard.vue';
import type { Course } from '../types';

const base = (partial: Partial<Course>): Course => ({
  id: 1,
  fullname: 'Kecerdasan Buatan',
  shortname: 'PAIK6402',
  idnumber: '439385',
  semester: 'Ganjil 2025/2026',
  timelineStatus: 'inprogress',
  ...partial,
});

describe('CourseCard', () => {
  it('renders shortname code and omits idnumber', () => {
    const w = mount(CourseCard, { props: { course: base({}) } });
    expect(w.text()).toContain('PAIK6402');
    expect(w.text()).not.toContain('439385');
  });
  it('renders fullname and semester sublabel when present', () => {
    const w = mount(CourseCard, { props: { course: base({}) } });
    expect(w.text()).toContain('Kecerdasan Buatan');
    expect(w.text()).toContain('Ganjil 2025/2026');
  });
  it('hides semester sublabel when absent', () => {
    const w = mount(CourseCard, { props: { course: base({ semester: null }) } });
    expect(w.text()).not.toContain('Semester');
  });
  it('shows Aktif chip for inprogress course', () => {
    const w = mount(CourseCard, { props: { course: base({ timelineStatus: 'inprogress' }) } });
    expect(w.text()).toContain('Aktif');
    expect(w.text()).not.toContain('Selesai');
  });
  it('shows Selesai chip for past course', () => {
    const w = mount(CourseCard, { props: { course: base({ timelineStatus: 'past' }) } });
    expect(w.text()).toContain('Selesai');
    expect(w.text()).not.toContain('Aktif');
  });
  it('emits open on click and on Enter key', async () => {
    const w = mount(CourseCard, { props: { course: base({}) } });
    await w.trigger('click');
    expect(w.emitted('open')).toBeTruthy();
    await w.trigger('keydown.enter');
    expect(w.emitted('open')).toHaveLength(2);
  });
  it('renders lecturer line only when present', () => {
    const w = mount(CourseCard, { props: { course: base({ lecturer: 'Dr. Retno' }) } });
    expect(w.text()).toContain('Dr. Retno');
  });
  it('hides lecturer line when absent', () => {
    const w = mount(CourseCard, { props: { course: base({}) } });
    expect(w.find('[data-test="course-lecturer"]').exists()).toBe(false);
  });
  it('renders progress bar and % when progress present', () => {
    const w = mount(CourseCard, { props: { course: base({ progress: 50 }) } });
    expect(w.text()).toContain('50%');
    expect(w.find('[data-test="course-progress"]').exists()).toBe(true);
  });
  it('hides progress bar when progress absent', () => {
    const w = mount(CourseCard, { props: { course: base({}) } });
    expect(w.find('[data-test="course-progress"]').exists()).toBe(false);
  });
});
