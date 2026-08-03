import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TimelineGroup from './TimelineGroup.vue';
import type { Assignment } from '../types';

const NOW = new Date(2025, 6, 14, 9, 0, 0).getTime(); // Monday
const DAY = 24 * 3600 * 1000;
const sec = (msFromNow: number) => Math.floor((NOW + msFromNow) / 1000);

function mk(id: number, duedateSec: number, overdue = false): Assignment {
  return { id, name: `T${id}`, module: 'assign', eventType: 'due', duedate: duedateSec, overdue, course: 'C', courseId: 1 };
}

describe('TimelineGroup', () => {
  it('groups into periods with Indonesian labels, overdue first', () => {
    const wrapper = mount(TimelineGroup, {
      props: {
        nowMs: NOW,
        assignments: [
          mk(1, sec(15 * DAY)),       // thisMonth
          mk(2, sec(-DAY), true),     // overdue
          mk(3, sec(9 * DAY)),        // nextWeek
        ],
      },
    });
    const headings = wrapper.findAll('h2').map((h) => h.text());
    expect(headings[0]).toBe('Terlambat');
    expect(headings).toContain('Minggu Depan');
    expect(headings).toContain('Bulan Ini');
  });

  it('shows empty state when no assignments', () => {
    const wrapper = mount(TimelineGroup, { props: { assignments: [], nowMs: NOW } });
    expect(wrapper.text()).toContain('Belum ada tugas');
  });

  it('re-emits open-assignment when a card is clicked', async () => {
    const wrapper = mount(TimelineGroup, {
      props: { nowMs: NOW, assignments: [mk(1, sec(9 * DAY))] },
    });
    await wrapper.find('.assignment-card').trigger('click');
    expect(wrapper.emitted('open-assignment')?.[0]?.[0]).toMatchObject({ id: 1 });
  });
});