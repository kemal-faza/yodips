import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

export interface PushPayload {
  title: string;
  body: string;
  collapseKey: string;
  data: Record<string, string>;
}

/**
 * Satu-satunya titik sentuh SDK firebase-admin. configured=false bila
 * flag/kredensial belum ada — pemanggil wajib no-op saat itu.
 */
@Injectable()
export class FcmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FcmService.name);
  private messaging: Messaging | null = null;
  private app: ReturnType<typeof initializeApp> | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const b64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    const enabled = this.config.get<boolean>('NOTIFICATIONS_ENABLED');
    if (!enabled || !b64) {
      this.logger.warn(
        'Push notifications disabled (NOTIFICATIONS_ENABLED / FIREBASE_SERVICE_ACCOUNT_JSON unset)',
      );
      return;
    }
    try {
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      const existing = getApps().find((a) => a.name === 'yodips-push');
      this.app =
        existing ??
        initializeApp({ credential: cert(json as never) }, 'yodips-push');
      this.messaging = getMessaging(this.app);
      this.logger.log('Firebase Cloud Messaging ready');
    } catch (e) {
      this.logger.error(`Firebase init gagal — notifikasi mati: ${(e as Error).message}`);
    }
  }

  get configured(): boolean {
    return this.messaging !== null;
  }

  async sendEach(
    tokens: string[],
    msg: PushPayload,
  ): Promise<{ invalidTokens: string[] }> {
    if (!this.messaging || tokens.length === 0) return { invalidTokens: [] };
    const res = await this.messaging.sendEachForMulticast({
      tokens,
      notification: { title: msg.title, body: msg.body },
      android: {
        priority: 'high',
        collapseKey: msg.collapseKey,
        // firebase-admin v14 moved channelId into AndroidNotification.
        notification: { channelId: 'akademik' },
      },
      data: msg.data,
    });
    const invalidTokens: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code ?? '';
      if (
        !r.success &&
        (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token')
      ) {
        invalidTokens.push(tokens[i]);
      }
    });
    return { invalidTokens };
  }

  async onModuleDestroy() {
    if (this.app) await deleteApp(this.app);
  }
}
