function parseCookieHeader(value: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of value.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    pairs.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return pairs;
}

function isDeletion(setCookie: string): boolean {
  const maxAge = /(?:^|;)\s*max-age\s*=\s*(-?\d+)/i.exec(setCookie);
  if (maxAge && Number(maxAge[1]) <= 0) return true;
  const expires = /(?:^|;)\s*expires\s*=\s*([^;]+)/i.exec(setCookie);
  const parsed = expires ? Date.parse(expires[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed <= Date.now();
}

export function mergeSessionCookie(
  storedCookie: string,
  setCookieHeaders: string[],
  matcher: RegExp,
): { cookie: string; changed: boolean } {
  const pairs = parseCookieHeader(storedCookie);
  let changed = false;

  for (const header of setCookieHeaders) {
    const first = header.split(';', 1)[0]?.trim() ?? '';
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    if (!matcher.test(name)) continue;
    if (isDeletion(header)) {
      if (pairs.delete(name)) changed = true;
      continue;
    }
    const value = first.slice(eq + 1).trim();
    if (pairs.get(name) !== value) {
      pairs.set(name, value);
      changed = true;
    }
  }

  return {
    cookie: [...pairs].map(([name, value]) => `${name}=${value}`).join('; '),
    changed,
  };
}
