import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBadge from './StatusBadge.vue';

describe('StatusBadge', () => {
  it('renders Terlambat for overdue', () => {
    const w = mount(StatusBadge, { props: { status: 'overdue' } });
    expect(w.text()).toContain('Terlambat');
  });
  it('renders Segera for dueSoon', () => {
    const w = mount(StatusBadge, { props: { status: 'dueSoon' } });
    expect(w.text()).toContain('Segera');
  });
  it('renders On track for onTrack', () => {
    const w = mount(StatusBadge, { props: { status: 'onTrack' } });
    expect(w.text()).toContain('On track');
  });
});