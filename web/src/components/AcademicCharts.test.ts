import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AcademicCharts from './AcademicCharts.vue';

describe('AcademicCharts', () => {
  it('preserves the empty-KHS state for all chart panels', async () => {
    const wrapper = mount(AcademicCharts, {
      props: { ipTrendRows: [], gradeRows: [], sksRows: [], ipMax: 3 },
      global: {
        stubs: {
          ChartIpTrend: { template: '<div data-test="chart-empty">Tidak ada data</div>' },
          ChartGradeDistribution: { template: '<div data-test="chart-empty">Tidak ada data</div>' },
          ChartSksCumulative: { template: '<div data-test="chart-empty">Tidak ada data</div>' },
        },
      },
    });

    await flushPromises();
    expect(wrapper.findAll('[data-test="chart-empty"]')).toHaveLength(2);
    await wrapper.get('[data-test="tab-grade-dist"]').trigger('click');
    expect(wrapper.findAll('[data-test="chart-empty"]')).toHaveLength(2);
  });
});
