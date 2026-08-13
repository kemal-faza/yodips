import { describe, expect, it, vi } from 'vitest';
import { emitReauthRequested, onReauthRequested } from './reauth';

describe('reauth event bus', () => {
  it('calls subscribed listeners on emit', () => {
    const cb = vi.fn();
    onReauthRequested(cb);
    emitReauthRequested();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops future notifications', () => {
    const cb = vi.fn();
    const off = onReauthRequested(cb);
    off();
    emitReauthRequested();
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple independent listeners', () => {
    const a = vi.fn();
    const b = vi.fn();
    onReauthRequested(a);
    onReauthRequested(b);
    emitReauthRequested();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not break other listeners', () => {
    const boom = vi.fn(() => { throw new Error('x'); });
    const ok = vi.fn();
    onReauthRequested(boom);
    onReauthRequested(ok);
    expect(() => emitReauthRequested()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});