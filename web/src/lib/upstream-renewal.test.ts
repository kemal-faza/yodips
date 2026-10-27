import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverUpstreamSession, resetUpstreamRecoveryState, upstreamRecoveryState } from './upstream-renewal';
import { sessionLifetime } from './session-lifetime';

vi.mock('../config/extension', () => ({ EXTENSION_ID: 'test-extension-id' }));

describe('web upstream recovery', () => {
  let callbacks: Array<(value: unknown) => void>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem('sso_token', 'jwt-a');
    callbacks = [];
    sendMessage = vi.fn((_id, _message, callback) => { callbacks.push(callback); });
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: null } });
  });
  afterEach(() => { sessionLifetime.advance(); localStorage.clear(); resetUpstreamRecoveryState(); vi.unstubAllGlobals(); });

  it('shares one renewal across simultaneous reads of the same service', async () => {
    const a = recoverUpstreamSession('kulon');
    const b = recoverUpstreamSession('kulon');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    callbacks[0]({ status: 'recovered' });
    await expect(Promise.all([a, b])).resolves.toEqual(['recovered', 'recovered']);
  });

  it('discards a recovery that finishes after logout or token replacement', async () => {
    const recovery = recoverUpstreamSession('siap');
    sessionLifetime.advance();
    localStorage.setItem('sso_token', 'jwt-b');
    callbacks[0]({ status: 'recovered' });
    await expect(recovery).resolves.toBe('cancelled');
    expect(localStorage.getItem('sso_token')).toBe('jwt-b');
  });

  it('offers interactive login only when requested and clears the prompt after service recovery', async () => {
    const automatic = recoverUpstreamSession('kulon');
    callbacks[0]({ status: 'interaction-required' });
    await automatic;
    expect(upstreamRecoveryState.kulon).toBe(true);

    const interactive = recoverUpstreamSession('kulon', true);
    expect(sendMessage).toHaveBeenLastCalledWith('test-extension-id',
      { action: 'renew', service: 'kulon', token: 'jwt-a', interactive: true }, expect.any(Function));
    callbacks[1]({ status: 'recovered' });
    await interactive;
    expect(upstreamRecoveryState.kulon).toBe(false);
  });
});
