import { describe, it, expect } from 'vitest';
import { detectEdgeBin, resolveDevProfile, buildArgs } from './launch-edge.mjs';

const EXISTING = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';

describe('launch-edge pure helpers', () => {
  it('detectEdgeBin honors EDGE_BIN when the path exists', () => {
    expect(detectEdgeBin({ EDGE_BIN: EXISTING })).toBe(EXISTING);
  });
  it('detectEdgeBin returns null for a non-existent EDGE_BIN path and no known paths', () => {
    expect(detectEdgeBin({ EDGE_BIN: '/definitely/not/existing/edge' }, [])).toBeNull();
  });
  it('resolveDevProfile uses tmpdir/edge-sso-dev', () => {
    expect(resolveDevProfile().endsWith('edge-sso-dev')).toBe(true);
  });
  it('buildArgs includes root extension dir, debug port, separate profile', () => {
    const args = buildArgs({ bin: '/edge', extRoot: '/abs/extension', port: 9222, url: 'http://localhost:5173', profile: '/tmp/edge-sso-dev' });
    expect(args).toContain('--remote-debugging-port=9222');
    expect(args).toContain('--load-extension=/abs/extension');
    expect(args).toContain('--user-data-dir=/tmp/edge-sso-dev');
    expect(args).toContain('--no-first-run');
    expect(args).toContain('http://localhost:5173');
  });
});