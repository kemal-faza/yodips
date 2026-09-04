import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type EndpointRejectReason =
  | 'not-https'
  | 'has-credentials'
  | 'has-fragment'
  | 'non-default-port'
  | 'no-hostname'
  | 'raw-ip-host'
  | 'path-missing';

export type EndpointPolicy =
  | { ok: true; hostname: string }
  | { ok: false; reason: EndpointRejectReason };

/**
 * True when the raw (pre-normalization) URL text carries an explicit port.
 * WHATWG URL drops a default ":443" into url.port === '', so we inspect the
 * raw authority: the port separator is the first ':' after the authority's
 * '@' (userinfo is rejected separately) — a ':' inside bracketed IPv6
 * ([::1]:8443) belongs to the literal and is not a port separator, hence we
 * scan after stripping any leading '[' ... ']' host portion.
 */
function hasExplicitPort(raw: string): boolean {
  // Extract the authority component: scheme://authority/path...
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd === -1) return false;
  let authority = raw.slice(schemeEnd + 3);
  const pathStart = authority.search(/[/?#]/);
  if (pathStart !== -1) authority = authority.slice(0, pathStart);
  // Drop userinfo (rejected separately); ':' before '@' is a password separator.
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close !== -1) authority = authority.slice(close + 1); // drop [v6] literal
  }
  return authority.includes(':');
}

/**
 * Shape-only Web Push endpoint validation (no I/O, no DNS) — enforced at
 * registration for YD-PUSH-001. Accepts exactly: https:, no userinfo, no
 * fragment, no explicit port, a real hostname that is NOT a raw IP literal,
 * and a non-root path. A query string is allowed (it does not change the
 * connect target). DNS/public-address enforcement happens separately at send
 * time via resolvePublicHostnames + the pinned https.Agent in web-push.service.
 */
export function validateWebPushEndpointShape(raw: string): EndpointPolicy {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'no-hostname' };
  }
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'no-hostname' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'has-credentials' };
  }
  if (url.hash !== '') return { ok: false, reason: 'has-fragment' };
  // WHATWG URL strips an explicit DEFAULT port (":443") into url.port === '',
  // so the explicit-port check must inspect the raw authority text, not the
  // normalized URL. Bracketed IPv6 literals contain ':' legitimately — only a
  // ':' OUTSIDE the brackets (or outside userinfo) is a port separator.
  if (hasExplicitPort(trimmed)) return { ok: false, reason: 'non-default-port' };
  if (url.hostname === '') return { ok: false, reason: 'no-hostname' };
  // Raw-IP hostnames (incl. bracketed IPv6 and v4-mapped) defeat the point of
  // DNS resolution — reject outright at registration. WHATWG URL keeps the
  // brackets on IPv6 hostnames, so strip them before net.isIP.
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host) !== 0) return { ok: false, reason: 'raw-ip-host' };
  if (url.pathname === '' || url.pathname === '/') {
    return { ok: false, reason: 'path-missing' };
  }
  return { ok: true, hostname: url.hostname };
}

const ipv4ToInt = (ip: string): number => {
  const parts = ip.split('.').map(Number);
  return (
    ((parts[0] << 24) >>> 0) +
    (parts[1] << 16) +
    (parts[2] << 8) +
    parts[3]
  );
};

/**
 * IPv4 classification via prefix arithmetic (readable, exact, no regex table).
 * Returns false for every non-globally-routable range:
 *   0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24,
 *   192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24,
 *   224.0.0.0/4 and 240.0.0.0/4 (multicast + reserved/broadcast).
 */
export function isPublicIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const n = ipv4ToInt(ip);
  const inCidr = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  const block =
    inCidr('0.0.0.0', 8) ||
    inCidr('10.0.0.0', 8) ||
    inCidr('100.64.0.0', 10) ||
    inCidr('127.0.0.0', 8) ||
    inCidr('169.254.0.0', 16) ||
    inCidr('172.16.0.0', 12) ||
    inCidr('192.0.0.0', 24) ||
    inCidr('192.0.2.0', 24) ||
    inCidr('192.168.0.0', 16) ||
    inCidr('198.18.0.0', 15) ||
    inCidr('198.51.100.0', 24) ||
    inCidr('203.0.113.0', 24) ||
    inCidr('224.0.0.0', 4) ||
    inCidr('240.0.0.0', 4); // 240.0.0.0/4 reserved (incl. broadcast)
  return !block;
}

const ipv6Expand = (ip: string): string[] | null => {
  let head = ip;
  let v4Tail: string[] | null = null;
  // A trailing dotted-quad (v4-mapped/compatible forms: ::ffff:10.0.0.1) —
  // convert it to two hextets so the rest of the parser sees pure hex groups.
  const v4Match = head.match(/^(.*):(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4Match) {
    const [, pre, a, b, c, d] = v4Match;
    const oct = (s: string) => {
      const v = Number(s);
      if (v > 255) return null;
      return v;
    };
    const nums = [oct(a), oct(b), oct(c), oct(d)];
    if (nums.some((x) => x === null)) return null;
    const hi = ((nums[0]! << 8) | nums[1]!) & 0xffff;
    const lo = ((nums[2]! << 8) | nums[3]!) & 0xffff;
    // Hex STRINGS (the shared .toLowerCase()/.padStart() path below expects
    // string groups — a raw number would throw).
    v4Tail = [hi.toString(16).padStart(4, '0'), lo.toString(16).padStart(4, '0')];
    head = pre;
  }
  let groups: (string | null)[] = head.split('::');
  if (groups.length > 2) return null; // more than one '::'
  const left = groups[0] === '' ? [] : groups[0].split(':');
  const right =
    groups.length === 2 && groups[1] !== ''
      ? groups[1].split(':')
      : [];
  const leftLen = left.length;
  const rightLen = right.length;
  const fill = 8 - leftLen - rightLen - (v4Tail ? 2 : 0);
  if (groups.length === 2 && fill < 1) return null;
  if (groups.length === 1 && fill !== 0) return null;
  if (leftLen + rightLen + (v4Tail ? 2 : 0) > 8) return null;
  const all: string[] = [
    ...left,
    ...Array.from({ length: Math.max(fill, 0) }, () => '0'),
    ...right,
    ...(v4Tail ?? []),
  ];
  const out: string[] = [];
  for (const g of all) {
    if (!/^[0-9a-f]{0,4}$/i.test(g)) return null;
    out.push(g === '' ? '0' : g.toLowerCase().padStart(4, '0'));
  }
  return out.length === 8 ? out : null;
};

/** Parse an IPv6 literal into its 8 hextets (null when malformed). */
export function parseIpv6(ip: string): string[] | null {
  if (isIP(ip) !== 6) return null;
  return ipv6Expand(ip);
}

/** True when `ip` is a v4-mapped IPv6 (::ffff:a.b.c.d / 0:0:0:0:0:ffff:w.x.y.z). */
export function isV4MappedIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  return (
    g !== null &&
    g[0] === '0000' &&
    g[1] === '0000' &&
    g[2] === '0000' &&
    g[3] === '0000' &&
    g[4] === '0000' &&
    g[5] === 'ffff'
  );
}

/** IPv4 dotted-quad embedded in hextets 6-7 of a v4-mapped IPv6. */
export function v4MappedEmbeddedIpv4(g: string[]): string {
  const hi = parseInt(g[6], 16);
  const lo = parseInt(g[7], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * IPv6 classification: block the unspecified/loopback (:: / ::1), ULA
 * fc00::/7, link-local fe80::/10, multicast ff00::/8, documentation
 * 2001:db8::/32, ORCHID 2001:10::/28, and every v4-mapped address whose
 * embedded IPv4 is itself non-public (::ffff:0:0/96 policy — a v4-mapped
 * address is a v4 transport, so its embedded v4 is classified).
 */
export function isPublicIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (g === null) return false;
  if (g.every((x) => x === '0000')) return false; // ::
  if (
    g[0] === '0000' &&
    g[1] === '0000' &&
    g[2] === '0000' &&
    g[3] === '0000' &&
    g[4] === '0000' &&
    g[5] === '0000' &&
    g[6] === '0000' &&
    g[7] === '0001'
  ) {
    return false; // ::1 loopback
  }
  const first = parseInt(g[0], 16);
  if (first >= 0xfe80 && first <= 0xfebf) return false; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if (first >= 0xff00) return false; // ff00::/8 multicast
  if (g[0] === '2001') {
    const second = parseInt(g[1], 16);
    if (second === 0x0db8) return false; // 2001:db8::/32 documentation
    if (second === 0x0010) return false; // 2001:10::/28 ORCHID
  }
  if (isV4MappedIpv6(ip)) {
    return isPublicIpv4(v4MappedEmbeddedIpv4(g)); // transparent v4-mapped
  }
  return true;
}

/** Public iff exactly one of the v4/v6 classifiers accepts it. */
export function isPublicAddress(ip: string): boolean {
  return isPublicIpv4(ip) || isPublicIpv6(ip);
}

/** Mirrors Node's dns.LookupAddress — the record shape Task 4's agent needs. */
export type DnsLookupRecord = { address: string; family: number };

/**
 * One-shot DNS resolution that requires EVERY returned A/AAAA record to be a
 * public address (fail-closed). Called once per send by WebPushService BEFORE
 * the https.Agent is built; the agent then pins the returned address(es) so a
 * DNS change between this check and the socket connect cannot redirect the
 * connection to a private target (DNS-rebinding mitigation at send time).
 * Returns the typed records (not bare strings) so the agent can forward
 * `address` + `family` unchanged to the socket layer.
 */
export async function resolvePublicHostnames(
  hostname: string,
): Promise<{ ok: true; records: DnsLookupRecord[] } | { ok: false; reason: 'dns' | 'non-public' }> {
  let records: DnsLookupRecord[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: 'dns' };
  }
  if (records.length === 0) return { ok: false, reason: 'dns' };
  if (!records.every((r) => isPublicAddress(r.address))) {
    return { ok: false, reason: 'non-public' };
  }
  return { ok: true, records };
}
