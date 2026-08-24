import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, type Component } from 'vue';
import { adaptiveRoute } from './adaptive-route';
import { isMobileDevice } from '../config/extension';

const Desktop = defineComponent({ template: '<p data-test="surface">desktop</p>' });
const Mobile = defineComponent({ template: '<p data-test="surface">mobile</p>' });

// VTU 2.4.x cannot mount a defineAsyncComponent AS THE ROOT (wrapper.vm stays
// null -> "Cannot read properties of null (reading '$')"). Wrap in a trivial
// host so the async component is a child — assertions below stay identical.
function hostOf(inner: Component) {
  return defineComponent({ render: () => h(inner) });
}

function stubUa(ua: string): () => void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  return () => {
    delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  };
}

describe('isMobileDevice', () => {
  it('true saat UA mobile walau tanpa matchMedia', () => {
    const restore = stubUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const mm = window.matchMedia;
    // @ts-expect-error simulasi environment tanpa matchMedia
    delete window.matchMedia;
    try {
      expect(isMobileDevice()).toBe(true);
    } finally {
      window.matchMedia = mm;
      restore();
    }
  });

  it('true saat UA Macintosh tapi display-mode standalone (iPad PWA)', () => {
    const restore = stubUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('standalone'),
      media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      onchange: null, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      expect(isMobileDevice()).toBe(true);
    } finally {
      window.matchMedia = mm; // pulihkan — jsdom setup memasang stub global matches:false
      restore();
    }
  });

  it('false saat desktop browser biasa', () => {
    const restore = stubUa('Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36');
    try {
      expect(isMobileDevice()).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('adaptiveRoute', () => {
  it('resolve MOBILE saat detect true; loader desktop tak dipanggil', async () => {
    const desktop = vi.fn(() => Promise.resolve(Desktop));
    const mobile = vi.fn(() => Promise.resolve(Mobile));
    const w = mount(hostOf(adaptiveRoute(desktop, mobile, () => true)));
    await flushPromises();
    expect(w.find('[data-test="surface"]').text()).toBe('mobile');
    expect(mobile).toHaveBeenCalledTimes(1);
    expect(desktop).not.toHaveBeenCalled();
  });

  it('resolve DESKTOP saat detect false', async () => {
    const desktop = vi.fn(() => Promise.resolve(Desktop));
    const mobile = vi.fn(() => Promise.resolve(Mobile));
    const w = mount(hostOf(adaptiveRoute(desktop, mobile, () => false)));
    await flushPromises();
    expect(w.find('[data-test="surface"]').text()).toBe('desktop');
  });
});
