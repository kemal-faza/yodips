import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MorphingText from './MorphingText.vue';

const greetings = ['Halo', 'Hello', 'こんにちは'];

describe('MorphingText', () => {
  beforeEach(() => vi.useRealTimers());

  it('renders the first text initially', () => {
    const w = mount(MorphingText, { props: { texts: greetings } });
    expect(w.text()).toContain('Halo');
  });

  it('contains all texts across its two stacked spans', () => {
    const w = mount(MorphingText, { props: { texts: greetings } });
    const spans = w.findAll('span');
    const combined = spans.map((s) => s.text()).join(' ');
    // The component stacks two spans; combined they cover the active + next text.
    expect(combined).toContain('Halo');
    expect(combined).toContain('Hello');
  });

  it('merges the class prop onto the wrapper', () => {
    const w = mount(MorphingText, {
      props: { texts: greetings, class: 'inline-block' },
    });
    const wrapper = w.find('div');
    expect(wrapper.classes()).toContain('inline-block');
  });

  it('does not force a fixed box or font size on the wrapper', () => {
    const w = mount(MorphingText, { props: { texts: greetings } });
    const wrapper = w.find('div');
    const cls = wrapper.classes().join(' ');
    expect(cls).not.toMatch(/h-|min-h-|text-\d|text-\[/);
    expect(cls).not.toMatch(/p-\d/);
  });

  it('cleans up on unmount (no error)', () => {
    const w = mount(MorphingText, { props: { texts: greetings } });
    expect(() => w.unmount()).not.toThrow();
  });

  it('cycles to the next text after advancing frames', () => {
    vi.useFakeTimers();
    const w = mount(MorphingText, { props: { texts: ['Halo', 'Hello'] } });
    // Fast-forward well past morphTime (1.5s) + cooldown via rAF frames.
    for (let i = 0; i < 300; i++) vi.advanceTimersByTime(16);
    expect(w.text()).toContain('Hello');
    vi.useRealTimers();
  });

  it('cancels the animation frame on unmount', () => {
    const cancelSpy = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);
    const w = mount(MorphingText, { props: { texts: greetings } });
    w.unmount();
    expect(cancelSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});