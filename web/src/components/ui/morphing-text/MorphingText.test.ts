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

  it('contains the active text plus a distinct next text across its stacked spans', () => {
    // Deck-shuffle guarantees the next word differs from the active one, so across
    // the sampled frames the stacked spans show the active word AND a distinct
    // (next) word. We accumulate text() across frames because only 2 words are
    // visible at any instant; sampling any single instant would be timing-flaky.
    vi.useFakeTimers();
    const w = mount(MorphingText, { props: { texts: greetings } });
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(16);
      for (const span of w.findAll('span')) {
        const t = span.text().trim();
        if (t) seen.add(t);
      }
    }
    expect(seen.has('Halo')).toBe(true); // active at mount stays until its morph completes
    expect(seen.size).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it('every language appears exactly once over a full interval (deck-shuffle)', () => {
    // A VARYING rng avoids the wrap-guard infinite-loop (a constant deck might
    // start with `current` on refill). We accumulate text() across frames because
    // only 2 words are visible at any instant, then assert all greetings appear.
    let i = 0;
    const seq = [0.1, 0.9, 0.6, 0.2, 0.8, 0.5];
    vi.stubGlobal(
      'Math',
      new Proxy(Math, {
        get(t, p) {
          return p === 'random' ? () => seq[i++ % seq.length] : t[p];
        },
      }),
    );
    vi.useFakeTimers();
    const w = mount(MorphingText, { props: { texts: greetings } });
    const seen = new Set<string>();
    for (let k = 0; k < 600; k++) {
      vi.advanceTimersByTime(16);
      for (const span of w.findAll('span')) {
        const t = span.text().trim();
        if (t) seen.add(t);
      }
    }
    for (const g of greetings) expect(seen.has(g)).toBe(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
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