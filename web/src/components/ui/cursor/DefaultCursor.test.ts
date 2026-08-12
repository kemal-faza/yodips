import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DefaultCursor from './DefaultCursor.vue';

describe('DefaultCursor', () => {
  it('renders a 32x32 svg pointer icon', () => {
    const w = mount(DefaultCursor);
    const svg = w.get('svg');
    expect(svg.attributes('width')).toBe('32');
    expect(svg.attributes('height')).toBe('32');
    expect(svg.text()).toBe('');
  });
});
