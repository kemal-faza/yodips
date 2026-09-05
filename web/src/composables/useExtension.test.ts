import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useExtension } from './useExtension';

vi.mock('../config/extension', () => ({ EXTENSION_ID: 'test-extension-id' }));

function mockChrome(exists = true, responder?: (msg: any) => any) {
  const rt = {
    lastError: null,
    sendMessage: vi.fn().mockImplementation((_id, msg, cb) => {
      if (typeof responder === 'function') cb(responder(msg));
      else if (msg.action === 'handoff') cb({ status: 'started', mode: 'auto' });
      else cb({ status: 'ok' });
    }),
  };
  (globalThis as any).chrome = exists ? { runtime: rt } : undefined;
  return rt;
}

beforeEach(() => {
  vi.resetModules();
  mockChrome();
});

describe('useExtension', () => {
  it('sendHandoff returns the started payload', async () => {
    const res = await useExtension().sendHandoff();
    expect(res).toEqual({ status: 'started', mode: 'auto' });
  });

  it('sendHandoff returns not-installed without chrome', async () => {
    mockChrome(false);
    expect(await useExtension().sendHandoff()).toBe('not-installed');
  });

  it.each([
    null,
    undefined,
    'malformed',
    42,
    [],
    {},
    { status: 'unknown' },
    { status: 'ok' },
    { status: 'started' },
    { status: 'error' },
  ])('sendHandoff turns malformed runtime response %# into a controlled error', async (response) => {
    mockChrome(true, () => response);

    await expect(useExtension().sendHandoff()).resolves.toEqual({
      status: 'error',
      message: expect.any(String),
    });
  });

  it('readStatus returns poll payload', async () => {
    mockChrome(true, (msg) => (msg.action === 'status' ? { status: 'ok', active: true, phase: 'sso' } : { status: 'ok' }));
    const s = await useExtension().readStatus();
    expect(s).toEqual({ status: 'ok', active: true, phase: 'sso' });
  });

  it('readStatus returns null when not installed', async () => {
    mockChrome(false);
    expect(await useExtension().readStatus()).toBeNull();
  });

  it.each([
    null,
    undefined,
    'malformed',
    42,
    [],
    {},
    { status: 'unknown' },
    { status: 'ok' },
    { status: 'ok', active: 'yes' },
  ])('readStatus turns malformed runtime response %# into a controlled error', async (response) => {
    mockChrome(true, () => response);

    await expect(useExtension().readStatus()).resolves.toEqual({
      status: 'error',
      message: expect.any(String),
    });
  });

  it('onResult listens to the undip-sso-extension window message', async () => {
    const ext = useExtension();
    const cb = vi.fn();
    const off = ext.onResult(cb);
    const payload = { status: 'ok', accessToken: 'jwt' };
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { source: 'undip-sso-extension', payload } }));
    expect(cb).toHaveBeenCalledWith(payload);
    off();
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { source: 'undip-sso-extension', payload } }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onResult ignores messages from other sources', async () => {
    const cb = vi.fn();
    useExtension().onResult(cb);
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data: { source: 'someone-else', payload: {} } }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('onResult ignores messages from a different (cross-origin) origin', async () => {
    const cb = vi.fn();
    useExtension().onResult(cb);
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { source: 'undip-sso-extension', payload: { status: 'ok', accessToken: 'forged' } } }));
    expect(cb).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'malformed', 42, {}, { status: 'unknown' }, { status: 'ok' }])(
    'onResult ignores malformed bridge payload %#',
    (payload) => {
      const cb = vi.fn();
      useExtension().onResult(cb);
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'undip-sso-extension', payload },
      }));
      expect(cb).not.toHaveBeenCalled();
    },
  );
});
