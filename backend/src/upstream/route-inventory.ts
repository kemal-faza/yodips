import {
  UPSTREAM_ROUTES,
  type UpstreamRoute,
} from '../observability/telemetry-contract';

/**
 * Route context + attempt validation.
 *
 * Owns the trusted upstream origin map and the check that a fixed inventory
 * route (service/operation/route) matches the exact origin, path and method
 * before any network attempt is made.
 */

export type UpstreamRouteContext = UpstreamRoute & {
  /** Required by the Microsoft token route; never included in telemetry. */
  tenantId?: string;
};

const UPSTREAM_ORIGINS: Readonly<Record<UpstreamRoute['service'], string>> = {
  kulon: 'https://kulon2.undip.ac.id',
  siap: 'https://siap.undip.ac.id',
  'siap-api': 'https://api.siap.undip.ac.id',
  sso: 'https://sso.undip.ac.id',
  microsoft: 'https://login.microsoftonline.com',
};

const MICROSOFT_TENANT_SEGMENT =
  /^(?:common|organizations|consumers|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/i;

function microsoftTokenPath(tenantId: unknown): string {
  if (
    typeof tenantId !== 'string' ||
    !MICROSOFT_TENANT_SEGMENT.test(tenantId)
  ) {
    throw new TypeError('Invalid Microsoft tenant path');
  }
  return `/${tenantId}/oauth2/v2.0/token`;
}

function rawPathname(url: string): string {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return '';
  const pathStart = url.indexOf('/', schemeEnd + 3);
  if (pathStart < 0) return '/';
  const queryStart = url.indexOf('?', pathStart);
  const fragmentStart = url.indexOf('#', pathStart);
  const pathEnd =
    queryStart < 0
      ? fragmentStart < 0
        ? url.length
        : fragmentStart
      : fragmentStart < 0
        ? queryStart
        : Math.min(queryStart, fragmentStart);
  return url.slice(pathStart, pathEnd);
}

/** Validate a fixed inventory route and the URL path before any fetch occurs. */
export function validateUpstreamAttempt(
  context: UpstreamRouteContext,
  url: string,
  method: string,
): UpstreamRouteContext {
  if (!context || typeof context !== 'object') {
    throw new TypeError('Invalid upstream route context');
  }
  const canonical = UPSTREAM_ROUTES.find(
    (candidate) =>
      candidate.service === context.service &&
      candidate.operation === context.operation &&
      candidate.route === context.route,
  );
  if (!canonical) throw new TypeError('Invalid upstream route context');

  if (typeof url !== 'string') {
    throw new TypeError('Invalid upstream request URL');
  }
  if (typeof method !== 'string') {
    throw new TypeError('Invalid upstream request method');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('Invalid upstream request URL');
  }
  const [expectedMethod, canonicalPath] = canonical.route.split(' ');
  const expectedPath =
    canonical.service === 'microsoft' &&
    canonical.operation === 'token_exchange'
      ? microsoftTokenPath(context.tenantId)
      : canonicalPath;
  const pathMatches =
    canonical.service === 'microsoft' &&
    canonical.operation === 'token_exchange'
      ? rawPathname(url) === expectedPath && parsed.pathname === expectedPath
      : parsed.pathname === expectedPath;
  if (method.toUpperCase() !== expectedMethod || !pathMatches) {
    throw new TypeError('Upstream URL does not match route context');
  }
  if (parsed.origin !== UPSTREAM_ORIGINS[canonical.service]) {
    throw new TypeError('Upstream URL origin is not allowed');
  }
  return canonical;
}
