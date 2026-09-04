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

const mockLookup = lookup as unknown as jest.Mock;describe('validateWebPushEndpointShape', () => {
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

describe('isBase64Url', () => {
  it.each([
    ['fcm-send_abc123', true],
    ['', false],
    ['a+b', false], // base64 (non-url) alphabet is rejected
    ['a/b', false],
    ['a==', false], // padding rejected
    ['abc def', false],
    ['abc123!', false],
  ])('validates %p -> %p', (s, expected) => {
    const { isBase64Url } = require('./endpoint-policy') as typeof import('./endpoint-policy');
    expect(isBase64Url(s)).toBe(expected);
  });
});

describe('explicit default-port probe evidence (Node WHATWG URL normalization)', () => {
  it('documented: new URL("https://host:443/x").port is "" so raw-text detection is required', () => {
    // Independent probe of this runtime (Node 22.23.1): WHATWG URL strips an
    // explicit DEFAULT port into the empty string, so url.port cannot
    // distinguish "https://host/x" from "https://host:443/x". This is why
    // validateWebPushEndpointShape inspects the pre-normalization text via
    // hasExplicitPort — and rejects BOTH the explicit :443 and any :8443.
    const normalized = new URL('https://fcm.googleapis.com:443/x');
    expect(normalized.port).toBe('');
    expect(normalized.href).toBe('https://fcm.googleapis.com/x');
    expect(normalized.host).toBe('fcm.googleapis.com');
    const nonDefault = new URL('https://fcm.googleapis.com:8443/x');
    expect(nonDefault.port).toBe('8443');
    // The policy contract: canonical https URL with NO explicit port only.
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com:443/x')).toEqual({
      ok: false,
      reason: 'non-default-port',
    });
    expect(validateWebPushEndpointShape('https://fcm.googleapis.com:8443/x')).toEqual({
      ok: false,
      reason: 'non-default-port',
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

describe('isPublicAddress — IPv4-embedded translation/tunneling prefixes (RFC 6052/6to4/NAT64)', () => {
  // A Web Push provider endpoint resolves over the public Internet to ordinary
  // public IPv4 or IPv6. ANY form that tunnels, translates or maps traffic to
  // a non-public IPv4 target must fail closed at the classifier (no reliance on
  // OS routing failure). RFC 6052 well-known prefix 64:ff9b::/96, its
  // local-use 64:ff9b:1::/48 variant, and 6to4 2002::/16 embed an IPv4 in the
  // low 32 bits / next 32 bits — always block them, public or not.
  it.each([
    // ---- RFC 6052 NAT64 well-known prefix 64:ff9b::/96 (dotted-quad form) ----
    ['64:ff9b::10.0.0.1'], // private 10/8 via NAT64
    ['64:ff9b::127.0.0.1'], // loopback via NAT64
    ['64:ff9b::192.168.1.1'], // private 192.168/16 via NAT64
    ['64:ff9b::172.16.0.1'], // private 172.16/12 via NAT64
    ['64:ff9b::100.64.0.1'], // CGNAT via NAT64
    ['64:ff9b::0.0.0.0'], // this-network via NAT64
    // ---- hex-hextet embed forms (::ffff:w.x.y.z style, prefix + 2 hextets) ----
    ['64:ff9b::a00:1'], // 10.0.0.1
    ['64:ff9b::7f00:1'], // 127.0.0.1
    ['64:ff9b::c0a8:101'], // 192.168.1.1
    ['64:ff9b::ac10:1'], // 172.16.0.1
    ['64:ff9b::808:808'], // 8.8.8.8 — public, but NAT64 transport is never needed
    // ---- RFC 6052 local-use prefix 64:ff9b:1::/48 (dotted-quad + hex forms) ----
    ['64:ff9b:1::10.0.0.1'],
    ['64:ff9b:1::a00:1'],
    ['64:ff9b:1::c0a8:101'],
    ['64:ff9b:1::808:808'],
    // ---- 6to4 2002::/16 (hextets 2-3 carry the IPv4) ----
    ['2002:0a00:0001::'], // 10.0.0.1
    ['2002:7f00:0001::'], // 127.0.0.1
    ['2002:ac10:0001::'], // 172.16.0.1
    ['2002:c0a8:0101::'], // 192.168.1.1
    ['2002:0808:0808::'], // 8.8.8.8 — public, but 6to4 transport is never needed
    // ---- Teredo 2001::/32 (server IPv4 in hextets 4-5) ----
    ['2001:0000:4136:e378:8000:63bf:3fff:fdd2'], // any embedded — Teredo never needed
  ])('blocks translation/tunneling form %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it('still accepts ordinary public IPv6 (Google/Cloudflare) and public IPv4', () => {
    expect(isPublicAddress('2607:f8b0:4004:800::200e')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('142.250.4.100')).toBe(true);
  });
});

describe('resolvePublicHostnames — mixed DNS answers with translation forms', () => {
  beforeEach(() => mockLookup.mockReset());

  it('rejects a mixed A/AAAA answer where any record is a translation form', async () => {
    mockLookup.mockResolvedValue([
      { address: '142.250.4.100', family: 4 },
      { address: '2002:a00:1::', family: 6 },
    ]);
    expect(await resolvePublicHostnames('mixed.example')).toEqual({
      ok: false,
      reason: 'non-public',
    });
  });

  it('rejects a pure-IPv6 answer carrying a 6to4 form of a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '2002:7f00:1::', family: 6 }]);
    expect(await resolvePublicHostnames('six-four.example')).toEqual({
      ok: false,
      reason: 'non-public',
    });
  });

  it('rejects a pure-IPv6 answer carrying a NAT64 local-use form of a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '64:ff9b:1::a00:1', family: 6 }]);
    expect(await resolvePublicHostnames('nat64.example')).toEqual({
      ok: false,
      reason: 'non-public',
    });
  });
});
