import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { Motion } from 'motion-v';
import SmoothCursor from './SmoothCursor.vue';

// motion-v's Motion resolves to a component whose `name` is `motion.div` (not
// `Motion`), so the stub key must be `[Motion.name]` for test-utils to match.
const MotionStub = {
  [Motion.name]: { template: '<div data-test="motion-stub"><slot /></div>' },
};

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
    const w = mount(SmoothCursor, { global: { stubs: MotionStub } });
    expect(document.body.style.cursor).toBe('');
    expect(w.find('[data-test="motion-stub"]').exists()).toBe(false);
    expect(w.html()).not.toContain('svg');
  });

  it('hides native cursor when pointer is fine, renders the cursor svg, and restores on unmount', async () => {
    media.mockReturnValue(fakeMedia(true));
    const w = mount(SmoothCursor, { global: { stubs: MotionStub } });
    // `active` is set in onMounted; the Motion branch renders on the next flush.
    await nextTick();
    expect(document.body.style.cursor).toBe('none');
    expect(w.find('svg').exists()).toBe(true);
    expect(w.find('[data-test="motion-stub"]').exists()).toBe(true);
    w.unmount();
    expect(document.body.style.cursor).toBe('default');
  });
});
