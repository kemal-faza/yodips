import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AuroraBackground from './AuroraBackground.vue';

describe('AuroraBackground', () => {
  it('renders slot content', () => {
    const w = mount(AuroraBackground, { slots: { default: '<p>Hello</p>' } });
    expect(w.text()).toContain('Hello');
  });

  it('applies the teal aurora gradient variable', () => {
    const w = mount(AuroraBackground);
    const root = w.findAll('div')[0]; // root element carries the :style gradient vars
    const style = (root.attributes('style') || '').replace(/\s+/g, ' ');
    expect(style).toContain('#01637e');
  });

  it('adds the radial mask class when radialGradient is true', () => {
    const w = mount(AuroraBackground, { props: { radialGradient: true } });
    const layer = w.findAll('div')[2]; // the blurred aurora layer
    const cls = layer.classes().join(' ');
    expect(cls).toContain('mask-');
  });

  it('omits the radial mask class when radialGradient is false', () => {
    const w = mount(AuroraBackground, { props: { radialGradient: false } });
    const layer = w.findAll('div')[2];
    expect(layer.classes().join(' ')).not.toContain('mask-');
  });
});