import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import AcademicChartsAsync from './AcademicChartsAsync.vue';

const props = {
  ipTrendRows: [],
  gradeRows: [],
  sksRows: [],
  ipMax: 3,
};

const chunkState = vi.hoisted(() => ({ failNext: false }));

// Mock at the real boundary: the component's own `import('./AcademicCharts.vue')`.
vi.mock('./AcademicCharts.vue', () => {
  if (chunkState.failNext) {
    chunkState.failNext = false;
    throw new Error('chunk failed');
  }
  return {
    default: {
      name: 'ChartsStub',
      template: '<div data-test="academic-charts-loaded" />',
    },
  };
});

describe('AcademicChartsAsync', () => {
  it('shows an error and recovers when the chunk import succeeds on retry', async () => {
    chunkState.failNext = true;
    vi.resetModules();
    const wrapper = mount(AcademicChartsAsync, { props });

    await flushPromises();
    expect(wrapper.find('[data-test="academic-charts-error"]').attributes('role')).toBe('alert');

    await wrapper.get('[data-test="academic-charts-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="academic-charts-loaded"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="academic-charts-error"]').exists()).toBe(false);
  });

  it('shows the loading skeleton until the chart chunk resolves', async () => {
    const wrapper = mount(AcademicChartsAsync, { props });

    const loading = wrapper.find('[data-test="academic-charts-loading"]');
    expect(loading.exists()).toBe(true);
    expect(loading.attributes('aria-busy')).toBe('true');
    expect(loading.find('.motion-safe\\:animate-pulse').exists()).toBe(true);

    await flushPromises();
    expect(wrapper.find('[data-test="academic-charts-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="academic-charts-loaded"]').exists()).toBe(true);
  });
});
