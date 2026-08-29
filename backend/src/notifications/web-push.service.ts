import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { WebSubscriptionRecord } from './notification-store';

export interface WebPushServiceConfig {
  enabled: boolean;
  subject: string;
  publicKey: string;
  privateKey: string;
}

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private vapid: WebPushServiceConfig | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const enabled = this.config.get<boolean>('WEB_PUSH_ENABLED') === true;
    const publicKey = this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
    const subject =
      this.config.get<string>('WEB_PUSH_SUBJECT') ?? 'mailto:admin@yodips.dev';
    if (!enabled || !publicKey || !privateKey) {
      this.logger.warn(
        'Web Push disabled (WEB_PUSH_ENABLED / VAPID keys unset)',
      );
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
  ): Promise<{ invalid: WebSubscriptionRecord[] }> {
    if (!this.vapid || subscriptions.length === 0) return { invalid: [] };
    const invalid: WebSubscriptionRecord[] = [];
    await Promise.all(
      subscriptions.map(async (s) => {
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
            },
          );
        } catch (e) {
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) invalid.push(s); // gone/subscription expired
        }
      }),
    );
    return { invalid };
  }
}
