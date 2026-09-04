/**
 * Trust-proxy policy mapping (YD-RATE-001 hardening).
 *
 * Maps the validated numeric `TRUST_PROXY_HOPS` selector (0..2, default 0) to a
 * FAIL-CLOSED Express `trust proxy` policy. We deliberately do NOT pass the raw
 * number to Express: a numeric hop count trusts the first N addresses of the
 * request chain *regardless of who they are*, so a shorter reachable proxy path
 * (e.g. an attacker connecting straight to the Heroku app, bypassing Cloudflare)
 * puts attacker-supplied `X-Forwarded-For` entries inside the trusted window and
 * lets the client forge `req.ip` (rate-limit bucket evasion — the original
 * YD-RATE-001 finding reapplied).
 *
 * Instead each hop is trusted only if its address belongs to a vetted CIDR set:
 *   - the immediate socket peer and every consumed `X-Forwarded-For` entry must
 *     match the policy, otherwise the walk stops and the untrusted address is
 *     reported as the client.
 *
 * Express wiring: `app.set('trust proxy', <policy>)` compiles the string/array
 * via `proxy-addr.compile` into a CIDR trust function consumed by `req.ip` /
 * `req.ips` / `ThrottlerGuard.getTracker(req)` (which returns `req.ip`). No
 * custom guard, no manual header parsing, no new dependency.
 */

/** Complete official Cloudflare proxy egress IPv4 ranges.
 *  Source: https://www.cloudflare.com/ips-v4 (authoritative, fetched 2026-09-04).
 *  MAINTENANCE: re-verify on any topology change or quarterly; Cloudflare may
 *  add/remove ranges. `curl -s https://www.cloudflare.com/ips-v4`. */
export const CLOUDFLARE_IPV4_CIDRS: readonly string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

/** Complete official Cloudflare proxy egress IPv6 ranges.
 *  Source: https://www.cloudflare.com/ips-v6 (authoritative, fetched 2026-09-04).
 *  MAINTENANCE: re-verify on any topology change or quarterly; Cloudflare may
 *  add/remove ranges. `curl -s https://www.cloudflare.com/ips-v6`. */
export const CLOUDFLARE_IPV6_CIDRS: readonly string[] = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/**
 * Express built-in proxy-addr CIDR groups (see proxy-addr's IP_RANGES):
 *  - loopback:     127.0.0.0/8, ::1/128
 *  - linklocal:    169.254.0.0/16, fe80::/10
 *  - uniquelocal:  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
 * Together these cover a single local/private reverse-proxy hop (Caddy on
 * 127.0.0.1, or Heroku's internal router fronting the dyno) and NO public peer.
 */
export const LOCAL_PRIVATE_TRUST_GROUPS: readonly string[] = [
  'loopback',
  'linklocal',
  'uniquelocal',
];

/**
 * An Express `trust proxy` value. `false` trusts no proxy (socket IP only);
 * arrays compile to CIDR trust functions.
 */
export type TrustProxyPolicy = false | readonly string[];

/** Fail-closed default: trust no proxy (direct/dev; `X-Forwarded-For` ignored). */
export const TRUST_PROXY_POLICY_NONE: TrustProxyPolicy = false;

/** Single local/private trusted hop (Caddy same-origin VPS; Heroku router alone). */
export const TRUST_PROXY_POLICY_LOCAL_ONLY: TrustProxyPolicy =
  LOCAL_PRIVATE_TRUST_GROUPS;

/** Local/private hop + Cloudflare proxy ranges (current Heroku prod topology:
 *  Cloudflare → Heroku router → dyno). A direct/public non-CF peer is untrusted. */
export const TRUST_PROXY_POLICY_LOCAL_AND_CLOUDFLARE: TrustProxyPolicy = [
  ...LOCAL_PRIVATE_TRUST_GROUPS,
  ...CLOUDFLARE_IPV4_CIDRS,
  ...CLOUDFLARE_IPV6_CIDRS,
];

/**
 * Map the validated numeric hop selector to the fail-closed trust policy.
 * `hops` is expected to be the env-validated value (0..2, @Min/@Max in
 * env.validation.ts); any out-of-range value fails CLOSED to `false`.
 */
export function trustProxyPolicyForHops(hops: number): TrustProxyPolicy {
  switch (hops) {
    case 0:
      return TRUST_PROXY_POLICY_NONE;
    case 1:
      return TRUST_PROXY_POLICY_LOCAL_ONLY;
    case 2:
      return TRUST_PROXY_POLICY_LOCAL_AND_CLOUDFLARE;
    default:
      return TRUST_PROXY_POLICY_NONE;
  }
}
