import { describe, expect, it, vi } from 'vitest';
import * as lifecycle from './lifecycle.js';

const perform = (input: unknown) => (lifecycle as any).performUpstreamRenewal(input);
const allowed = (appUrl: string, backendUrl: string) =>
  (lifecycle as any).isAllowedRenewalTarget(appUrl, backendUrl);

function setup() {
  return {
    service: 'kulon' as const,
    token: 'secret-jwt',
    requestEpoch: 4,
    currentEpoch: () => 4,
    deps: {
      readCookie: vi.fn().mockResolvedValue('MoodleSession=old'),
      renew: vi.fn().mockResolvedValue({ status: 200 }),
      captureTicket: vi.fn().mockResolvedValue('ready'),
    },
  };
}

describe('authenticated upstream renewal', () => {
  it('renews an already refreshed browser cookie without starting a ticket', async () => {
    const input = setup();
    await expect(perform(input)).resolves.toEqual({ status: 'recovered' });
    expect(input.deps.renew).toHaveBeenCalledWith('kulon', 'MoodleSession=old', 'secret-jwt');
    expect(input.deps.captureTicket).not.toHaveBeenCalled();
  });

  it('captures a new ticket after a rejected cookie and retries renewal once', async () => {
    const input = setup();
    input.deps.renew.mockResolvedValueOnce({ status: 422 }).mockResolvedValueOnce({ status: 200 });
    input.deps.readCookie.mockResolvedValueOnce('MoodleSession=old').mockResolvedValueOnce('MoodleSession=new');
    await expect(perform(input)).resolves.toEqual({ status: 'recovered' });
    expect(input.deps.captureTicket).toHaveBeenCalledWith('kulon');
    expect(input.deps.renew).toHaveBeenLastCalledWith('kulon', 'MoodleSession=new', 'secret-jwt');
    expect(input.deps.renew).toHaveBeenCalledTimes(2);
  });

  it('does not open a ticket or ask for login on an upstream failure', async () => {
    const input = setup();
    input.deps.renew.mockResolvedValue({ status: 502 });
    await expect(perform(input)).resolves.toEqual({ status: 'unavailable' });
    expect(input.deps.captureTicket).not.toHaveBeenCalled();
  });

  it('reports required interaction without submitting an unverified cookie', async () => {
    const input = setup();
    input.deps.renew.mockResolvedValue({ status: 422 });
    input.deps.captureTicket.mockResolvedValue('interaction-required');
    await expect(perform(input)).resolves.toEqual({ status: 'interaction-required' });
    expect(input.deps.renew).toHaveBeenCalledTimes(1);
  });

  it('does not submit after logout changes the operation epoch', async () => {
    const input = setup();
    let epoch = 4;
    input.currentEpoch = () => epoch;
    input.deps.readCookie.mockImplementation(async () => { epoch = 5; return 'MoodleSession=old'; });
    await expect(perform(input)).resolves.toEqual({ status: 'cancelled' });
    expect(input.deps.renew).not.toHaveBeenCalled();
  });

  it('allows only the expected app and backend origin pairs', () => {
    expect(allowed('https://sso.crunchy.my.id/dashboard', 'https://backend.crunchy.my.id')).toBe(true);
    expect(allowed('http://localhost:5173/', 'http://localhost:3000')).toBe(true);
    expect(allowed('https://sso.crunchy.my.id/', 'https://attacker.example')).toBe(false);
    expect(allowed('https://attacker.example/', 'https://backend.crunchy.my.id')).toBe(false);
    expect(allowed('https://sso.crunchy.my.id/', 'https://backend.crunchy.my.id.attacker.example')).toBe(false);
  });

  it('classifies ticket navigation without treating a login page as an authenticated landing', () => {
    const classify = (lifecycle as any).classifyRenewalNavigation;
    expect(classify('kulon', 'https://kulon2.undip.ac.id/auth/oidc/?t=hidden', true)).toBe('pending');
    expect(classify('kulon', 'https://kulon2.undip.ac.id/my/', true)).toBe('ready');
    expect(classify('siap', 'https://siap.undip.ac.id/pages/mhs/dashboard', true)).toBe('ready');
    expect(classify('siap', 'https://siap.undip.ac.id/sso/login?t=hidden', true)).toBe('pending');
    expect(classify('kulon', 'https://login.microsoftonline.com/example', true)).toBe('interaction-required');
    expect(classify('kulon', 'https://login.microsoftonline.com/example', false)).toBe('pending');
    expect(classify('kulon', 'https://account.microsoft.com/example', true)).toBe('interaction-required');
    expect(classify('kulon', 'https://kulon2.undip.ac.id/login/index.php', true)).toBe('interaction-required');
    expect(classify('siap', 'https://siap.undip.ac.id.evil.example/dashboard', true)).toBe('unavailable');
    expect(classify('siap', 'https://siap.undip.ac.id/pages/mhs/dashboard', false)).toBe('pending');
  });
});
