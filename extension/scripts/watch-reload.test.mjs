import { describe, it, expect } from 'vitest';
import { findSwTarget } from './watch-reload.mjs';

describe('watch-reload pure helpers', () => {
  const SW = { type: 'service_worker', url: 'chrome-extension://abc123/background.js', webSocketDebuggerUrl: 'ws://x' };
  const page = { type: 'page', url: 'http://localhost:5173/' };

  it('findSwTarget picks the extension service worker by background.js url', () => {
    const t = findSwTarget([page, SW]);
    expect(t).toBe(SW);
  });
  it('findSwTarget returns undefined when no extension SW', () => {
    expect(findSwTarget([page])).toBeUndefined();
  });
  it('findSwTarget honors an explicit extension id', () => {
    const other = { ...SW, url: 'chrome-extension://zzz/background.js' };
    const t = findSwTarget([other, SW], 'abc123');
    expect(t?.url).toContain('abc123');
  });
});