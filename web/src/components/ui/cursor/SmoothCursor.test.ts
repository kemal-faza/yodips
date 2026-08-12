import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SmoothCursor from './SmoothCursor.vue';

let media: ReturnType<typeof vi.fn>;

beforeEach(() => {
  media = vi.fn();
  window.matchMedia = media as unknown as typeof window.matchMedia;
  document.body.style.cursor = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeMedia(matches: boolean) {
  return {
    matches,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };
}

describe('SmoothCursor', () => {
  it('does nothing when pointer is NOT fine (native cursor kept, no render)', () => {
    media.mockReturnValue(fakeMedia(false));
    const w = mount(SmoothCursor);
    expect(document.body.style.cursor).toBe('');
    expect(w.html()).not.toContain('svg');
  });

  it('hides native cursor when pointer is fine and restores it on unmount', () => {
    media.mockReturnValue(fakeMedia(true));
    const w = mount(SmoothCursor, {
      global: { stubs: { Motion: { template: '<div data-test="motion-stub" />' } } },
    });
    expect(document.body.style.cursor).toBe('none');
    w.unmount();
    expect(document.body.style.cursor).toBe('default');
  });
});
