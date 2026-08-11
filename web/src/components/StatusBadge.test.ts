import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusBadge from './StatusBadge.vue';

describe('StatusBadge', () => {
  it('renders the label', () => {
    const w = mount(StatusBadge, { props: { label: 'Terlambat, belum dikumpulkan', tone: 'danger' } });
    expect(w.text()).toContain('Terlambat, belum dikumpulkan');
  });
  it('applies danger tone for danger', () => {
    const w = mount(StatusBadge, { props: { label: 'X', tone: 'danger' } });
    expect(w.classes()).toContain('bg-danger/10');
    expect(w.classes()).toContain('text-danger');
  });
  it('applies success tone for success', () => {
    const w = mount(StatusBadge, { props: { label: 'Selesai', tone: 'success' } });
    expect(w.classes()).toContain('bg-success/10');
  });
  it('applies muted tone by default', () => {
    const w = mount(StatusBadge, { props: { label: 'Belum dikumpulkan', tone: 'muted' } });
    expect(w.classes()).toContain('bg-foreground/5');
    expect(w.classes()).toContain('text-muted-foreground');
  });
});
