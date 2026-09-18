import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import AcademicChartsAsync from './AcademicChartsAsync.vue';

const props = {
  ipTrendRows: [],
  gradeRows: [],
  sksRows: [],
  ipMax: 3,
};

describe('AcademicChartsAsync', () => {
  it('shows a loading state while the chart chunk is pending', async () => {
    let resolve!: (module: { default: ReturnType<typeof defineComponent> }) => void;
    const loadCharts = () => new Promise<{ default: ReturnType<typeof defineComponent> }>((done) => {
      resolve = done;
    });

    const wrapper = mount(AcademicChartsAsync, { props: { ...props, loadCharts } });

    const loading = wrapper.find('[data-test="academic-charts-loading"]');
    expect(loading.exists()).toBe(true);
    expect(loading.attributes('aria-busy')).toBe('true');
    expect(loading.find('.motion-safe\\:animate-pulse').exists()).toBe(true);
    expect(wrapper.find('[data-test="academic-charts-loaded"]').exists()).toBe(false);

    resolve({
      default: defineComponent({
        props: { ipMax: { type: Number, required: true } },
        template: '<div data-test="academic-charts-loaded">{{ ipMax }}</div>',
      }),
    });
    await flushPromises();
    expect(wrapper.find('[data-test="academic-charts-loaded"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="academic-charts-loaded"]').text()).toBe('3');
  });

  it('shows an error and retries a failed chart chunk', async () => {
    const loaded = defineComponent({ template: '<div data-test="academic-charts-loaded" />' });
    const loadCharts = vi
      .fn<() => Promise<{ default: ReturnType<typeof defineComponent> }>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ default: loaded });
    const wrapper = mount(AcademicChartsAsync, { props: { ...props, loadCharts } });

    await flushPromises();
    expect(wrapper.find('[data-test="academic-charts-error"]').attributes('role')).toBe('alert');

    await wrapper.get('[data-test="academic-charts-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="academic-charts-loaded"]').exists()).toBe(true);
    expect(loadCharts).toHaveBeenCalledTimes(2);
  });
});
