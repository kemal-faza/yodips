import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ChartGradeDistribution from './ChartGradeDistribution.vue';

// jsdom can't measure SVG bars, but the legend colors ARE testable: the legend
// renders from the same `config` object as the bars, and the palette is a plain
// data literal. This guards the "black B" regression (var(--chart-1) is an HSL
// triplet, not a valid color) AND the reference palette.
const data = [
  { semester: '1', A: 4, AB: 2, B: 1, BC: 0, C: 0, D: 0, E: 1 },
];

describe('ChartGradeDistribution palette', () => {
  it('renders the legend with the reference colors (B is blue, never black)', () => {
    const w = mount(ChartGradeDistribution, { props: { data } });
    // jsdom normalizes inline hex to rgb(): #3b82f6 → rgb(59, 130, 246).
    expect(w.html()).toContain('rgb(59, 130, 246)'); // B = blue
    expect(w.html()).not.toContain('var(--chart-1)'); // no invalid HSL token
    expect(w.html()).toContain('rgb(22, 163, 74)'); // A #16a34a
    expect(w.html()).toContain('rgb(220, 38, 38)'); // E #dc2626
  });
});
