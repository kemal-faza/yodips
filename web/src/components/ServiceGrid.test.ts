import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ServiceGrid from './ServiceGrid.vue';

describe('ServiceGrid', () => {
  it('shows the service grid heading', () => {
    const w = mount(ServiceGrid);
    expect(w.text()).toContain('Layanan');
  });
  it('emits navigate "siap" when SIAP is clicked', async () => {
    const w = mount(ServiceGrid);
    await w.find('[data-test="service-siap"]').trigger('click');
    expect(w.emitted('navigate')?.[0]).toEqual(['siap']);
  });
  it('emits navigate "kulon" when Kulon is clicked', async () => {
    const w = mount(ServiceGrid);
    await w.find('[data-test="service-kulon"]').trigger('click');
    expect(w.emitted('navigate')?.[0]).toEqual(['kulon']);
  });
  it('does NOT emit navigate for Coming Soon services', async () => {
    const w = mount(ServiceGrid);
    await w.find('[data-test="service-mandala"]').trigger('click');
    expect(w.emitted('navigate')).toBeUndefined();
    expect(w.text()).toContain('Coming Soon');
  });
});
