import 'reflect-metadata';
import {
  isPublicAddress,
  resolvePublicHostnames,
  validateWebPushEndpointShape,
} from './endpoint-policy';
import { lookup } from 'node:dns/promises';

// The module imports the named `lookup` binding at call time, so a top-level
// jest.mock on node:dns/promises intercepts it deterministically (no network).
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockLookup = lookup as unknown as jest.Mock;

describe('validateWebPushEndpointShape', () => {
  it('accepts a canonical public https push endpoint', () => {
    expect(
      validateWebPushEndpointShape('https://fcm.googleapis.com/fcm/send/abc123'),
    ).toEqual({ ok: true, hostname: 'fcm.googleapis.com' });
  });

  it('rejects http and non-https schemes', () => {
    expect(validateWebPushEndpointShape('http://fcm.googleapis.com/x').ok).toBe(false);
    expect(validateWebPushEndpointShape('ftp://fcm.googleapis.com/x').ok).toBe(false);
  });

  it('rejects credentials, fragment and non-default port; tolerates a query string', () => {
    expect(validateWebPushEndpointShape('https://user:pass@fcm.googleapis.com/x').ok).toBe(false);
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com/x#frag').ok).toBe(false);
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com:8443/x').ok).toBe(false);
    // Explicit :443 is still an explicit port — reject (canonical form only).
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com:443/x').ok).toBe(false);
    // A query string does not change the connect target — allowed.
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com/x?y=1').ok).toBe(true);
  });

  it('rejects a bare host without a path, empty and unparsable strings', () => {
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com').ok).toBe(false);
    expect(validateWebPushEndpointShape('').ok).toBe(false);
    expect(validateWebPushEndpointShape('not a url').ok).toBe(false);
  });

  it('rejects raw-IP hostnames (DNS-rebinding degenerate case)', () => {
    expect(validateWebPushEndpointShape('https://127.0.0.1/x').ok).toBe(false);
    expect(validateWebPushEndpointShape('https://10.0.0.1/x').ok).toBe(false);
    expect(validateWebPushEndpointShape('https://[::1]/x').ok).toBe(false);
    expect(validateWebPushEndpointShape('https://[::ffff:7f00:1]/x').ok).toBe(false);
  });

  it('reports the specific reject reason for a credentials endpoint', () => {
    expect(validateWebPushEndpointShape('https://u:p@fcm.googleapis.com/x')).toEqual({
      ok: false,
      reason: 'has-credentials',
    });
  });
});

describe('isPublicAddress', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and reserved IPv4', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('10.0.0.1')).toBe(false);
    expect(isPublicAddress('172.16.0.1')).toBe(false);
    expect(isPublicAddress('172.31.255.255')).toBe(false);
    expect(isPublicAddress('192.168.1.1')).toBe(false);
    expect(isPublicAddress('169.254.1.1')).toBe(false);
    expect(isPublicAddress('100.64.0.1')).toBe(false);
    expect(isPublicAddress('0.0.0.0')).toBe(false);
    expect(isPublicAddress('192.0.2.1')).toBe(false);
    expect(isPublicAddress('198.51.100.7')).toBe(false);
    expect(isPublicAddress('203.0.113.9')).toBe(false);
    expect(isPublicAddress('198.18.0.1')).toBe(false);
    expect(isPublicAddress('224.0.0.1')).toBe(false);
    expect(isPublicAddress('255.255.255.255')).toBe(false);
  });

  it('blocks loopback, ULA, link-local, multicast and v4-mapped-to-non-public IPv6', () => {
    expect(isPublicAddress('::')).toBe(false);
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('fc00::1')).toBe(false);
    expect(isPublicAddress('fd12:3456:789a::1')).toBe(false);
    expect(isPublicAddress('fe80::1')).toBe(false);
    expect(isPublicAddress('ff02::1')).toBe(false);
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicAddress('2001:db8::1')).toBe(false);
  });

  it('accepts public addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('142.250.4.100')).toBe(true);
    expect(isPublicAddress('2607:f8b0:4004:800::200e')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
});

describe('resolvePublicHostnames (mock dns)', () => {
  beforeEach(() => mockLookup.mockReset());

  it('resolves a public host to its typed records', async () => {
    mockLookup.mockResolvedValue([
      { address: '142.250.4.100', family: 4 },
      { address: '2607:f8b0:4004:800::200e', family: 6 },
    ]);
    const out = await resolvePublicHostnames('fcm.googleapis.com');
    expect(out).toEqual({
      ok: true,
      records: [
        { address: '142.250.4.100', family: 4 },
        { address: '2607:f8b0:4004:800::200e', family: 6 },
      ],
    });
  });

  it('rejects when every record is non-public (dns-rebinding simulation)', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect(await resolvePublicHostnames('attacker.example')).toEqual({
      ok: false,
      reason: 'non-public',
    });
  });

  it('rejects when ANY record is non-public (mixed A/AAAA fail-closed)', async () => {
    mockLookup.mockResolvedValue([
      { address: '142.250.4.100', family: 4 },
      { address: '10.0.0.4', family: 4 },
    ]);
    expect(await resolvePublicHostnames('mixed.example')).toEqual({
      ok: false,
      reason: 'non-public',
    });
  });

  it('rejects an unresolvable host and an empty record list', async () => {
    const err = new Error('ENOTFOUND') as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    mockLookup.mockRejectedValueOnce(err);
    expect(await resolvePublicHostnames('no-such-host.invalid')).toEqual({
      ok: false,
      reason: 'dns',
    });
    mockLookup.mockResolvedValueOnce([]);
    expect(await resolvePublicHostnames('empty.example')).toEqual({
      ok: false,
      reason: 'dns',
    });
  });
});
