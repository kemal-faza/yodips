import {
  CLOUDFLARE_IPV4_CIDRS,
  CLOUDFLARE_IPV6_CIDRS,
  trustProxyPolicyForHops,
  TRUST_PROXY_POLICY_LOCAL_AND_CLOUDFLARE,
  TRUST_PROXY_POLICY_LOCAL_ONLY,
  TRUST_PROXY_POLICY_NONE,
} from './trust-proxy';

// NOTE on seam choice (undeclared-dependency hygiene): hop-trust BEHAVIOR is not
// unit-tested here via a direct `proxy-addr`/`express` import — both are
// transitive deps (@nestjs/platform-express → express → proxy-addr), and a
// direct runtime import would be an undeclared-dependency smell. Instead the
// compiled trust function + forwarding-chain behavior (synthetic public/local/CF
// sockets → real req.ip) is exercised through the EXISTING app seam in
// configure-http.spec.ts (`syntheticReqIp`, which drives the booted Nest app's
// own Express `req.ip` getter — no hand-parsed XFF, no new package). This file
// keeps only the PURE hops→policy mapping tests.

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

  it('fails closed (false) for a fractional value (defense in depth; env @IsInt rejects it first)', () => {
    // Env validation now rejects '1.5' via @IsInt, but if any non-integer ever
    // reaches the mapper it must NOT partially trust (e.g. 1.5 → local-only):
    // fail closed to trust-none.
    expect(trustProxyPolicyForHops(1.5)).toBe(false);
    expect(trustProxyPolicyForHops(0.5)).toBe(false);
  });

  it('Cloudflare range lists carry the authoritative 2026-09-04 count (15 v4 + 7 v6)', () => {
    expect(CLOUDFLARE_IPV4_CIDRS).toHaveLength(15);
    expect(CLOUDFLARE_IPV6_CIDRS).toHaveLength(7);
  });
});
