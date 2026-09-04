import {
  CLOUDFLARE_IPV4_CIDRS,
  CLOUDFLARE_IPV6_CIDRS,
  trustProxyPolicyForHops,
  TRUST_PROXY_POLICY_LOCAL_AND_CLOUDFLARE,
  TRUST_PROXY_POLICY_LOCAL_ONLY,
  TRUST_PROXY_POLICY_NONE,
} from './trust-proxy';
import { compile } from 'proxy-addr';

// Compile a policy array into the same CIDR trust function Express uses
// (express/lib/utils.compileTrust → proxyaddr.compile). The returned function
// is `trust(addr, index)` — true when the address is an accepted proxy hop.
function trustFn(policy: readonly string[]) {
  return compile(policy as string[]);
}

describe('trust-proxy policy mapping (YD-RATE-001 hardening)', () => {
  it('maps 0 → false (trust no proxy; default fail-safe)', () => {
    expect(trustProxyPolicyForHops(0)).toBe(TRUST_PROXY_POLICY_NONE);
    expect(TRUST_PROXY_POLICY_NONE).toBe(false);
  });

  it('maps 1 → local/private trust groups only', () => {
    expect(trustProxyPolicyForHops(1)).toBe(TRUST_PROXY_POLICY_LOCAL_ONLY);
    expect(TRUST_PROXY_POLICY_LOCAL_ONLY).toEqual([
      'loopback',
      'linklocal',
      'uniquelocal',
    ]);
  });

  it('maps 2 → local/private groups + complete current Cloudflare IPv4+IPv6 ranges', () => {
    const policy = trustProxyPolicyForHops(2);
    expect(policy).toBe(TRUST_PROXY_POLICY_LOCAL_AND_CLOUDFLARE);
    expect(policy).toEqual([
      'loopback',
      'linklocal',
      'uniquelocal',
      ...CLOUDFLARE_IPV4_CIDRS,
      ...CLOUDFLARE_IPV6_CIDRS,
    ]);
  });

  it('fails closed (false) for any out-of-range value', () => {
    expect(trustProxyPolicyForHops(3)).toBe(false);
    expect(trustProxyPolicyForHops(-1)).toBe(false);
    expect(trustProxyPolicyForHops(NaN)).toBe(false);
    expect(trustProxyPolicyForHops(undefined as unknown as number)).toBe(false);
  });

  it('Cloudflare range lists carry the authoritative 2026-09-04 count (15 v4 + 7 v6)', () => {
    expect(CLOUDFLARE_IPV4_CIDRS).toHaveLength(15);
    expect(CLOUDFLARE_IPV6_CIDRS).toHaveLength(7);
  });
});

describe('trust-proxy CIDR policy behavior (fail-closed hop identity)', () => {
  const fnLocal = trustFn(TRUST_PROXY_POLICY_LOCAL_ONLY as string[]);
  const fnCf = trustFn(TRUST_PROXY_POLICY_LOCAL_AND_CLOUDFLARE as string[]);

  it('policy 1 trusts loopback, linklocal, uniquelocal hops', () => {
    expect(fnLocal('127.0.0.1', 0)).toBe(true);
    expect(fnLocal('::ffff:127.0.0.1', 0)).toBe(true);
    expect(fnLocal('::1', 0)).toBe(true);
    expect(fnLocal('169.254.1.1', 0)).toBe(true);
    expect(fnLocal('10.0.0.4', 0)).toBe(true);
    expect(fnLocal('172.16.0.4', 0)).toBe(true);
    expect(fnLocal('192.168.0.4', 0)).toBe(true);
    expect(fnLocal('fc00::1', 0)).toBe(true);
  });

  it('policy 1 rejects any public / non-CF direct peer (no blanket numeric trust)', () => {
    // Old numeric trust=1/2 trusted ANY address at the counted positions;
    // the CIDR policy must NOT trust arbitrary public peers.
    expect(fnLocal('203.0.113.9', 0)).toBe(false);
    expect(fnLocal('198.51.100.7', 0)).toBe(false);
    expect(fnLocal('8.8.8.8', 0)).toBe(false);
    expect(fnLocal('114.10.44.242', 0)).toBe(false);
    expect(fnCf('203.0.113.9', 0)).toBe(false);
    expect(fnCf('198.51.100.7', 0)).toBe(false);
    expect(fnCf('8.8.8.8', 0)).toBe(false);
    expect(fnCf('114.10.44.242', 0)).toBe(false);
  });

  it('policy 2 trusts representative live Cloudflare IPv4 + IPv6 edges', () => {
    // IPs below are the actual CF edges observed in production router logs and
    // DNS (2026-09-04) — all inside the authoritative fetched ranges.
    expect(fnCf('172.71.82.47', 0)).toBe(true);
    expect(fnCf('104.22.176.19', 0)).toBe(true);
    expect(fnCf('162.158.162.140', 0)).toBe(true);
    expect(fnCf('172.70.142.205', 0)).toBe(true);
    expect(fnCf('104.21.25.219', 0)).toBe(true);
    expect(fnCf('2606:4700::1', 0)).toBe(true);
    expect(fnCf('2400:cb00::1', 0)).toBe(true);
  });

  it('policy 2 rejects adjacent-but-outside (non-Cloudflare) addresses', () => {
    // Boundary probes just outside the authoritative ranges — must NOT be trusted.
    expect(fnCf('104.28.0.1', 0)).toBe(false); // just above 104.24.0.0/14
    expect(fnCf('172.72.0.1', 0)).toBe(false); // just above 172.64.0.0/13
    expect(fnCf('162.160.0.1', 0)).toBe(false); // just above 162.158.0.0/15
    expect(fnCf('141.101.63.1', 0)).toBe(false); // just below 141.101.64.0/18
    expect(fnCf('198.42.0.1', 0)).toBe(false); // just above 198.41.128.0/17
    expect(fnCf('173.245.47.1', 0)).toBe(false); // just below 173.245.48.0/20
    expect(fnCf('2606:4701::1', 0)).toBe(false); // just above 2606:4700::/32
    expect(fnCf('2a06:98c8::1', 0)).toBe(false); // just above 2a06:98c0::/29
  });
});
