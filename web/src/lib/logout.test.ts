import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginLogout,
  endLogout,
  getReauthEpoch,
  isLogoutInProgress,
} from './logout';

describe('logout in-progress flag (ref-counted, dependency-free)', () => {
  beforeEach(() => {
    // Module state survives between tests; make each test start clean.
    while (isLogoutInProgress()) endLogout();
  });
  afterEach(() => {
    while (isLogoutInProgress()) endLogout();
  });

  it('is false before any beginLogout', () => {
    expect(isLogoutInProgress()).toBe(false);
  });

  it('is true between beginLogout() and endLogout()', () => {
    beginLogout();
    expect(isLogoutInProgress()).toBe(true);
    endLogout();
    expect(isLogoutInProgress()).toBe(false);
  });

  it('ref-counts: two beginLogout() need two endLogout()', () => {
    beginLogout();
    beginLogout();
    expect(isLogoutInProgress()).toBe(true);
    endLogout();
    expect(isLogoutInProgress()).toBe(true); // one still in flight
    endLogout();
    expect(isLogoutInProgress()).toBe(false);
  });

  it('endLogout() never drives the count negative', () => {
    endLogout();
    endLogout();
    expect(isLogoutInProgress()).toBe(false);
  });

  it('beginLogout() returns void (no Promise barrier)', () => {
    expect(beginLogout()).toBeUndefined();
    while (isLogoutInProgress()) endLogout();
  });

  it('beginLogout() bumps the reauth epoch once (invalidates in-flight reauth polls)', () => {
    const before = getReauthEpoch();
    beginLogout();
    expect(getReauthEpoch()).toBe(before + 1);
    endLogout();
    // endLogout releases the flag but does NOT un-bump: a reauth poll that
    // captured the pre-logout epoch stays invalid even after the flag drops.
    expect(getReauthEpoch()).toBe(before + 1);
  });

  it('each beginLogout() bumps the epoch again (monotonic)', () => {
    const before = getReauthEpoch();
    beginLogout();
    endLogout();
    beginLogout();
    expect(getReauthEpoch()).toBe(before + 2);
    while (isLogoutInProgress()) endLogout();
  });
});
