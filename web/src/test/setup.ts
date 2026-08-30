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

// SVG geometry: jsdom does not implement getBBox/getComputedTextLength/
// getTotalLength (they are real layout queries requiring a rendering engine).
// Unovis charts call them while sizing axes during render, and without a stub
// the rAF-driven render throws an unhandled error that fails CI (Vitest exits
// non-zero on unhandled errors even when all tests pass — 2026-08-30 incident:
// ChartGradeDistribution palette test green but deployment blocked).
// Numbers are deliberately fake — tests only assert markup/colors, and no test
// performs meaningful geometry measurement in jsdom.
function svgGeometryStub(): DOMRect {
  return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) };
}

if (typeof SVGGraphicsElement !== 'undefined' && !SVGGraphicsElement.prototype.getBBox) {
  SVGGraphicsElement.prototype.getBBox = svgGeometryStub;
}
if (typeof SVGTextContentElement !== 'undefined' && !SVGTextContentElement.prototype.getComputedTextLength) {
  SVGTextContentElement.prototype.getComputedTextLength = () => 0;
}
if (typeof SVGGeometryElement !== 'undefined' && !SVGGeometryElement.prototype.getTotalLength) {
  SVGGeometryElement.prototype.getTotalLength = () => 0;
}
