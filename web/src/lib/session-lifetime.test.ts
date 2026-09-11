import { describe, expect, it, vi } from 'vitest';
import { createSessionLifetime, sessionLifetime } from './session-lifetime';
import { clearCache, getCacheGeneration } from '../api/cache';

describe('createSessionLifetime — the one owner of the session generation', () => {
  it('starts at epoch 0, gate down, and the epoch is current', () => {
    const s = createSessionLifetime();
    expect(s.epoch()).toBe(0);
    expect(s.isLogoutInProgress()).toBe(false);
    expect(s.isCurrent(0)).toBe(true);
  });

  it('advance() moves the generation; begin()/end() own only the gate', () => {
    const s = createSessionLifetime();
    s.begin();
    expect(s.epoch()).toBe(0); // begin must NOT move the generation
    s.advance();
    expect(s.epoch()).toBe(1);
    s.end();
    expect(s.epoch()).toBe(1); // end never un-bumps
  });

  it('end() is ref-counted and never negative', () => {
    const s = createSessionLifetime();
    s.end();
    expect(s.isLogoutInProgress()).toBe(false);
    s.begin();
    s.begin();
    const e = s.epoch();
    s.end();
    expect(s.isLogoutInProgress()).toBe(true);
    s.end();
    expect(s.isLogoutInProgress()).toBe(false);
    expect(s.epoch()).toBe(e);
  });

  it('isCurrent(e) is false during logout, false for a stale epoch, true again after end', () => {
    const s = createSessionLifetime();
    s.advance();
    const epoch = s.epoch();
    expect(s.isCurrent(epoch)).toBe(true);

    s.begin();
    expect(s.isCurrent(epoch)).toBe(false); // gate up

    s.end();
    expect(s.isCurrent(epoch)).toBe(true); // same epoch, gate down

    expect(s.isCurrent(epoch - 1)).toBe(false); // stale
    expect(s.isCurrent(epoch + 1)).toBe(false); // unknown
  });

  it('wipeSession() advances the generation and runs the wipe once', () => {
    const onWipe = vi.fn();
    const s = createSessionLifetime({ onWipe });
    const before = s.epoch();
    s.wipeSession();
    expect(s.epoch()).toBe(before + 1);
    expect(onWipe).toHaveBeenCalledTimes(1);
    expect(s.isCurrent(before)).toBe(false);
    expect(s.isCurrent(s.epoch())).toBe(true);
  });

  it('two instances hold independent state (no shared module singleton)', () => {
    const a = createSessionLifetime();
    const b = createSessionLifetime();
    a.begin();
    a.advance();
    expect(b.epoch()).toBe(0);
    expect(b.isLogoutInProgress()).toBe(false);
    expect(a.isCurrent(0)).toBe(false);
    expect(b.isCurrent(0)).toBe(true);
  });

  it('the production default wipes the data cache with the session generation', () => {
    const before = getCacheGeneration();
    sessionLifetime.wipeSession();
    expect(getCacheGeneration()).toBe(before + 1);
  });
});
