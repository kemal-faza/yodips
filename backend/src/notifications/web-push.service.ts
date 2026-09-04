import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'node:https';
import * as webpush from 'web-push';
import { WebSubscriptionRecord } from './notification-store';
import { mapWithConcurrency } from '../common/map-with-concurrency';
import {
  DnsLookupRecord,
  resolvePublicHostnames,
  validateWebPushEndpointShape,
} from './endpoint-policy';

export interface WebPushServiceConfig {
  enabled: boolean;
  subject: string;
  publicKey: string;
  privateKey: string;
}

export type ResolveHost = typeof resolvePublicHostnames;

/** Global per-poller-cycle web-push send budget, shared across users/events. */
export class CycleSendBudget {
  remaining: number;
  constructor(readonly max: number) {
    this.remaining = max;
  }
  /** Reserve `n` sends; returns the number actually reserved (0 when exhausted). */
  take(n: number): number {
    const granted = Math.min(n, this.remaining);
    this.remaining -= granted;
    return granted;
  }
  get exhausted(): boolean {
    return this.remaining <= 0;
  }
}

const SEND_POOL_WIDTH = 4;
export const DEFAULT_CYCLE_BUDGET = 50;
const SEND_TIMEOUT_MS = 10_000;

/**
 * Build an https.Agent whose lookup pins ONE vetted public address.
 * autoSelectFamily:false forces the SINGLE-address lookup callback form
 * cb(null, address, family) — Node 22's default autoSelectFamily:true instead
 * requests all records (array form). Disabling it makes the pin deterministic.
 */
export function buildPinnedAgent(record: DnsLookupRecord): Agent {
  return new Agent({
    autoSelectFamily: false,
    lookup: (
      _hostname: string,
      _options: { all?: boolean; family?: number; hints?: number },
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string | import('node:dns').LookupAddress[],
        family?: number,
      ) => void,
    ) => {
      // Only the single-address form is produced here (autoSelectFamily:false
      // makes Node call with { all: false } semantics), so forward the one
      // vetted record's address + family unchanged. The array branch is typed
      // for LookupFunction assignability but is never exercised at runtime.
      cb(null, record.address, record.family);
    },
  });
}

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private vapid: WebPushServiceConfig | null = null;
  /** Test seam: replaced in specs so unit tests never touch DNS. */
  resolveHost: ResolveHost = resolvePublicHostnames;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const enabled = this.config.get<boolean>('WEB_PUSH_ENABLED') === true;
    const publicKey = this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
    const subject =
      this.config.get<string>('WEB_PUSH_SUBJECT') ?? 'mailto:admin@yodips.dev';
    if (!enabled || !publicKey || !privateKey) {
      this.logger.warn('Web Push disabled (WEB_PUSH_ENABLED / VAPID keys unset)');
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.vapid = { enabled, subject, publicKey, privateKey };
    this.logger.log('Web Push ready');
  }

  get configured(): boolean {
    return this.vapid !== null;
  }

  get publicKey(): string {
    return this.vapid?.publicKey ?? '';
  }

  async send(
    subscriptions: WebSubscriptionRecord[],
    payload: {
      title: string;
      body: string;
      collapseKey: string;
      data: Record<string, string>;
    },
    budget: CycleSendBudget,
  ): Promise<{ invalid: WebSubscriptionRecord[] }> {
    if (!this.vapid || subscriptions.length === 0 || budget.exhausted) {
      return { invalid: [] };
    }
    const invalid: WebSubscriptionRecord[] = [];
    const sendOne = async (s: WebSubscriptionRecord): Promise<void> => {
      try {
        // 1. Shape re-check (a registration may predate this code).
        const shape = validateWebPushEndpointShape(s.endpoint);
        if (!shape.ok) {
          invalid.push(s);
          return;
        }
        // 2. The ONE DNS resolve per send: require EVERY record public.
        const dns = await this.resolveHost(shape.hostname);
        if (!dns.ok) {
          invalid.push(s);
          return;
        }
        // 3. Reserve a slot ONLY when we are about to touch the network.
        //    Shape/DNS-pruned subs never consume cycle budget. The budget is
        //    the SINGLE shared per-cycle counter, so the aggregate across
        //    users/events/pool-workers can never exceed budget.max.
        if (budget.exhausted || budget.take(1) === 0) return;
        const pinned = buildPinnedAgent(dns.records[0]);
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            {
              vapidDetails: {
                subject: this.vapid!.subject,
                publicKey: this.vapid!.publicKey,
                privateKey: this.vapid!.privateKey,
              },
              timeout: SEND_TIMEOUT_MS,
              agent: pinned,
            },
          );
        } finally {
          // Never retain a socket/agent between sends (verified: default agent
          // keeps no free socket after the response; destroy clears all).
          pinned.destroy();
        }
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) invalid.push(s);
        // Other errors (socket timeout, DNS, upstream 5xx) are skipped silently
        // — existing poller semantics; snapshots are preserved for the next cycle.
      }
    };
    await mapWithConcurrency(subscriptions, SEND_POOL_WIDTH, sendOne);
    return { invalid };
  }
}
