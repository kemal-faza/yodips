import { describe, it, expect } from 'vitest';
import { detectChromeBin, resolveDevProfile, buildArgs } from './launch-chrome.mjs';

const EXISTING = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';

describe('launch-chrome pure helpers', () => {
  it('detectChromeBin honors CHROME_BIN override as-is', () => {
    expect(detectChromeBin({ CHROME_BIN: EXISTING })).toBe(EXISTING);
  });
  it('detectChromeBin returns a set CHROME_BIN even if non-existent (error surfaced by launcher)', () => {
    expect(detectChromeBin({ CHROME_BIN: '/definitely/not/existing/chrome' })).toBe('/definitely/not/existing/chrome');
  });
  it('detectChromeBin finds a known deployment on this machine', () => {
    expect(detectChromeBin({})).toBe('/usr/bin/google-chrome');
  });
  it('resolveDevProfile uses tmpdir/chrome-sso-dev', () => {
    expect(resolveDevProfile().endsWith('chrome-sso-dev')).toBe(true);
  });
  it('buildArgs includes root extension dir, debug port, separate profile', () => {
    const args = buildArgs({ bin: '/chrome', extRoot: '/abs/extension', port: 9222, url: 'http://localhost:5173', profile: '/tmp/chrome-sso-dev' });
    expect(args).toContain('--remote-debugging-port=9222');
    expect(args).toContain('--load-extension=/abs/extension');
    expect(args).toContain('--user-data-dir=/tmp/chrome-sso-dev');
    expect(args).toContain('--no-first-run');
    expect(args).toContain('http://localhost:5173');
  });
});