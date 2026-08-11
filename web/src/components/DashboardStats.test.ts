import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DashboardStats from './DashboardStats.vue';

const base = {
  ipk: 3.71, sksKumulatif: 108, sksSemester: 18, activeCourses: 6,
  notSubmitted: 3, overdue: 1, dueSoon: 1, submitted: 6, loading: false, hasKulon: true,
};

describe('DashboardStats', () => {
  it('renders metrics and status chips', () => {
    const w = mount(DashboardStats, { props: base });
    expect(w.text()).toContain('3.71');
    expect(w.text()).toContain('IPK');
    expect(w.text()).toContain('SKS Semester Ini');
    expect(w.text()).toContain('Terlambat');
    expect(w.text()).toContain('Segera');
    expect(w.text()).toContain('Selesai');
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
