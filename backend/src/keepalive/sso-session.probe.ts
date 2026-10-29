import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createNoopTelemetryRuntime,
  TELEMETRY_RUNTIME,
  type TelemetryRuntime,
} from '../observability/telemetry';
import type { UpstreamRouteContext } from '../upstream/route-inventory';
import {
  classifyProbeStatus,
  type KeepAliveProbeResult,
} from './keepalive-probe';
import { probeWithRedirects } from './probe-transport';

const SSO_LOGIN_CONTEXT: UpstreamRouteContext = {
  service: 'sso',
  operation: 'login_page',
  route: 'GET /auth/user/login',
};

@Injectable()
export class SsoSessionProbe {
  private readonly runtime: TelemetryRuntime;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(TELEMETRY_RUNTIME) runtime?: TelemetryRuntime,
  ) {
    this.runtime = runtime ?? createNoopTelemetryRuntime();
  }

  async probe(cookie: string): Promise<KeepAliveProbeResult> {
    if (!cookie) return { valid: false, kind: 'no-cookie', setCookies: [] };
    try {
      const hops = await probeWithRedirects(
        this.runtime,
        SSO_LOGIN_CONTEXT,
        this.loginUrl(),
        { headers: { Cookie: cookie }, redirect: 'manual' },
        {
          stopWhen: (hop) =>
            !!hop.location &&
            new URL(hop.location, hop.url).pathname === '/pages/dashboard',
          readBody: (hop) => hop.status >= 200 && hop.status < 300,
        },
      );
      const setCookies = hops.flatMap((hop) => hop.setCookies);
      const final = hops[hops.length - 1];
      if (!final) return { valid: false, kind: 'transient', setCookies };
      if (
        final.location &&
        new URL(final.location, final.url).pathname === '/pages/dashboard'
      ) {
        return { valid: true, setCookies };
      }
      const kind = classifyProbeStatus(final.status);
      if (kind !== 'valid') return { valid: false, kind, setCookies };
      return { valid: false, kind: 'invalid', setCookies };
    } catch {
      return { valid: false, kind: 'transient', setCookies: [] };
    }
  }

  private loginUrl(): string {
    const override = this.config.get<string>('SSO_LOGIN_URL')?.trim();
    if (override) return override;
    const base = this.config
      .getOrThrow<string>('SSO_BASE_URL')
      .replace(/\/$/, '');
    return `${base}/auth/user/login`;
  }
}
