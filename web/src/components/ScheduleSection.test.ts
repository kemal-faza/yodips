import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ScheduleSection from './ScheduleSection.vue';
import type { ScheduleItem } from '../utils/dashboard';

const items: ScheduleItem[] = [
  { id: '1', code: 'PAIK6402', courseName: 'Kecerdasan Buatan', day: 'Senin', timeStart: '07:00', timeEnd: '09:30', room: 'A301', sks: 3, status: 'disetujui' },
  { id: '2', code: 'PAIK6499', courseName: 'Tanpa Jadwal', sks: 2, status: 'disetujui' },
];

describe('ScheduleSection', () => {
  it('renders session semester title', () => {
    const w = mount(ScheduleSection, { props: { items, semester: 'Ganjil 2025/2026', loading: false } });
    expect(w.text()).toContain('IR');
  });
  it('shows unparsable rows in the table view', async () => {
    const w = mount(ScheduleSection, { props: { items, semester: null, loading: false } });
    await w.find('[data-test="schedule-view-table"]').trigger('click');
    expect(w.text()).toContain('Tanpa Jadwal');
    expect(w.text()).toContain('PAIK6499');
  });
  it('excludes unparsable rows from the grid view', () => {
    const w = mount(ScheduleSection, { props: { items, semester: null, loading: false } });
    expect(w.find('[data-test="grid-course-PAIK6402"]').exists()).toBe(true);
    expect(w.find('[data-test="grid-course-PAIK6499"]').exists()).toBe(false);
  });
});
