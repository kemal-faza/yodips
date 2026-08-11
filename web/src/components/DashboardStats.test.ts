import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DashboardStats from './DashboardStats.vue';

const base = {
  ipk: 2.73, sksKumulatif: 84, sksSemester: 23, activeCourses: 8,
  need: 0, late: 3, done: 9, loading: false, hasKulon: true,
};

describe('DashboardStats', () => {
  it('renders metrics and status chips (need/late/done)', () => {
    const w = mount(DashboardStats, { props: base });
    expect(w.text()).toContain('2.73');
    expect(w.text()).toContain('IP Kumulatif (IPK)');
    expect(w.text()).toContain('SKS Semester Ini');
    expect(w.text()).toContain('Perlu Dikerjakan');
    expect(w.text()).toContain('Terlambat');
    expect(w.text()).toContain('Selesai');
    expect(w.text()).not.toContain('Segera');
  });
  it('shows the need count as the main task number', () => {
    const w = mount(DashboardStats, { props: { ...base, need: 2 } });
    const main = w.findAll('span.text-3xl')[3];
    expect(main?.text()).toBe('2');
  });
  it('renders dashes when Kulon unavailable', () => {
    const w = mount(DashboardStats, { props: { ...base, hasKulon: false } });
    expect(w.text()).not.toContain('Terlambat');
  });
  it('shows skeleton while loading', () => {
    const w = mount(DashboardStats, { props: { ...base, loading: true } });
    expect(w.find('[data-test="stats-loading"]').exists()).toBe(true);
  });
});