// Vitest jsdom setup: stubs for browser APIs used by reka-ui (shadcn-vue)
// primitives (Dialog/Sheet/Select/ToggleGroup position, measure, scroll).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!window.matchMedia) {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
}

// jsdom does not expose requestAnimationFrame/cancelAnimationFrame. Copying
// the pattern above, define a cancellable setTimeout-based frame so components
// with rAF loops (e.g. MorphingText) run without throwing ReferenceError.
if (!('requestAnimationFrame' in globalThis)) {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number;
}
if (!('cancelAnimationFrame' in globalThis)) {
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}
