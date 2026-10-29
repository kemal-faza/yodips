import { recordTelemetry, type TelemetryRuntime } from '../observability/telemetry';
import {
  validateUpstreamAttempt,
  type UpstreamRouteContext,
} from '../upstream/route-inventory';
import {
  networkEvent,
  terminalUpstreamEvent,
} from '../upstream/telemetry-events';

export interface ProbeHop {
  status: number;
  url: string;
  location?: string;
  setCookies: string[];
  body?: string;
}

export interface ProbeTransportOptions {
  maxRedirects?: number;
  timeoutMs?: number;
  stopWhen?: (hop: ProbeHop) => boolean;
  readBody?: (hop: ProbeHop) => boolean;
}

const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function probeWithRedirects(
  runtime: TelemetryRuntime,
  context: UpstreamRouteContext,
  url: string,
  init: RequestInit,
  options: ProbeTransportOptions = {},
): Promise<ProbeHop[]> {
  const canonical = validateUpstreamAttempt(context, url, init.method ?? 'GET');
  const origin = new URL(url).origin;
  const started = Date.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRequests = (options.maxRedirects ?? DEFAULT_MAX_REDIRECTS) + 1;
  const hops: ProbeHop[] = [];
  let currentUrl = url;
  let finalStatus = 0;

  try {
    for (let hop = 0; hop < maxRequests; hop++) {
      const res = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
        signal,
      });
      finalStatus = res.status;
      const setCookies =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : splitSetCookieHeader(res.headers.get('set-cookie'));
      const location = res.headers.get('location') ?? undefined;
      const entry: ProbeHop = {
        status: res.status,
        url: currentUrl,
        location,
        setCookies,
      };
      hops.push(entry);

      if (options.stopWhen?.(entry)) {
        await res.body?.cancel();
        break;
      }

      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        const next = new URL(location, currentUrl);
        if (next.origin !== origin) break;
        currentUrl = next.toString();
        continue;
      }

      if (options.readBody?.(entry)) entry.body = await res.text();
      else await res.body?.cancel();
      break;
    }

    const outcome = finalStatus >= 200 && finalStatus < 300 ? 'ok' : 'http_error';
    recordTelemetry(
      runtime,
      terminalUpstreamEvent(canonical, { outcome }, finalStatus, Date.now() - started),
    );
    return hops;
  } catch (error) {
    recordTelemetry(runtime, networkEvent(canonical, 'fetch-threw', Date.now() - started));
    throw error;
  }
}

/** Split a legacy combined Set-Cookie header without breaking `Expires=Wed, ...`. */
export function splitSetCookieHeader(header: string | null): string[] {
  if (!header) return [];
  const result: string[] = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < header.length; i++) {
    if (header[i] === ';') inExpires = false;
    if (header.slice(i, i + 8).toLowerCase() === 'expires=') inExpires = true;
    if (header[i] === ',' && !inExpires && header[i + 1] === ' ') {
      result.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(header.slice(start).trim());
  return result.filter(Boolean);
}
