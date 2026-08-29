import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  detectNewAssignments,
  detectReschedules,
  findDueSoon,
  NotifEvent,
} from './detector';
import { isStaleUpstreamError } from '../upstream/upstream-fetch';
import { KulonService } from '../kulon/kulon.service';
import { eventToPush, PushCopy } from './push-copy';
import { NotificationStore, WebSubscriptionRecord } from './notification-store';
import { SiapService } from '../siap/siap.service';
import { FcmService } from './fcm.service';
import { KulonAssignment } from '../kulon/kulon.service';
import { SiapJadwal } from '../siap/siap.service';
import { WebPushService } from './web-push.service';

export interface CycleSummary {
  usersChecked: number;
  pushesSent: number;
}

const CHUNK_SIZE = 2;           // maks user paralel (spec §3.2)
const JITTER_MAX_MS = 60_000;   // jitter antar-user

/**
 * Orkestrator polling 15-menit per spec §3.2: enumerate user ber-token ->
 * fetch upstream -> diff vs snapshot -> push FCM. Anti-overlap memakai lock
 * NotificationStore + flag in-process (deployment = satu web dyno).
 */
@Injectable()
export class NotificationsPoller implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsPoller.name);
  running = false;

  constructor(
    private readonly store: NotificationStore,
    private readonly kulon: KulonService,
    private readonly siap: SiapService,
    private readonly fcm: FcmService,
    private readonly webPush: WebPushService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get<boolean>('NOTIFICATIONS_ENABLED')) {
      this.logger.warn('NOTIFICATIONS_ENABLED false — poller mati');
      return;
    }
    if (!this.fcm.configured) {
      this.logger.warn('FCM belum configured — poller mati');
      return;
    }
    const expr =
      this.config.get<string>('NOTIF_POLL_CRON') ?? '*/15 * * * *';
    const job = new CronJob(expr, () => {
      void this.runCycle().catch((e) =>
        this.logger.error(`cycle gagal: ${(e as Error).message}`),
      );
    });
    this.schedulerRegistry.addCronJob('notifications-poll', job);
    job.start();
    this.logger.log(`Poller aktif (${expr})`);
  }

  async runCycle(
    nowMs: number = Date.now(),
    deadlineWindowMs?: number,
  ): Promise<CycleSummary> {
    const summary: CycleSummary = { usersChecked: 0, pushesSent: 0 };
    if (this.running) return summary;
    const locked = await this.store.tryLockCycle();
    if (!locked) return summary;
    this.running = true;
    try {
      const fcmSubs = await this.store.listSubsWithTokens();
      const webSubs = await this.store.listSubsWithWeb();
      const subs = [...new Set([...fcmSubs, ...webSubs])];
      for (let i = 0; i < subs.length; i += CHUNK_SIZE) {
        await Promise.all(
          subs.slice(i, i + CHUNK_SIZE).map(async (sub) => {
            await this.sleep(Math.random() * JITTER_MAX_MS);
            summary.usersChecked += 1;
            try {
              await this.processUser(sub, nowMs, summary, deadlineWindowMs);
            } catch (e) {
              if (isStaleUpstreamError(e)) {
                await this.sendReloginOnce(sub, summary);
              } else {
                // Upstream/network failure: skip diam — snapshot dipertahankan.
                this.logger.warn(`skip ${sub}: ${(e as Error)?.message}`);
              }
            }
          }),
        );
      }
      await this.store.unlockCycle();
    } finally {
      this.running = false;
    }
    return summary;
  }

  private async processUser(
    sub: string,
    nowMs: number,
    summary: CycleSummary,
    deadlineWindowMs?: number,
  ): Promise<void> {
    const tokens = await this.store.getDeviceTokens(sub);
    const webSubs = await this.store.getWebSubscriptions(sub);
    if (tokens.length === 0 && webSubs.length === 0) return;

    // Services resolve their own upstream sessions from `sub`; a missing or
    // expired session surfaces as a typed stale 401 -> re-login push (catch
    // di runCycle).
    const assignments: KulonAssignment[] = await this.kulon.getAllAssignments(sub);
    const jadwal: SiapJadwal[] = await this.siap.getJadwal(sub);

    // Sesi valid -> episode expired usai; reset agar episode BERIKUTNYA boleh push lagi.
    if (await this.store.getReloginFlagged(sub)) {
      await this.store.setReloginFlagged(sub, false);
    }

    const prevAssignments = await this.store.getSnapshot<KulonAssignment[]>(
      sub,
      'assignments',
    );
    const newRes = detectNewAssignments(prevAssignments, assignments);

    const sentDeadline = await this.store.getSentKeys(sub, 'deadline');
    const due = findDueSoon(assignments, nowMs, sentDeadline, deadlineWindowMs);

    const prevJadwal = await this.store.getSnapshot<SiapJadwal[]>(sub, 'jadwal');
    const seenPrints = await this.store.getSentKeys(sub, 'reschedule');
    const resched = detectReschedules(prevJadwal, jadwal, seenPrints);

    const events: NotifEvent[] = [...newRes.events, ...resched.events, ...due.events];
    for (const ev of events) {
      await this.deliver(sub, tokens, webSubs, eventToPush(ev), summary);
    }

    // Persist state — snapshot hanya saat fetch tampak sehat (guard detector).
    if (newRes.snapshotValid) {
      await this.store.setSnapshot(sub, 'assignments', assignments);
    }
    if (resched.snapshotValid) {
      await this.store.setSnapshot(sub, 'jadwal', jadwal);
    }
    await this.store.setSentKeys(sub, 'deadline', due.newKeys);
    await this.store.setSentKeys(sub, 'reschedule', resched.fingerprints);
  }

  private async deliver(
    sub: string,
    tokens: string[],
    webSubs: WebSubscriptionRecord[],
    copy: PushCopy,
    summary: CycleSummary,
  ): Promise<void> {
    const { invalidTokens } = await this.fcm.sendEach(tokens, copy);
    summary.pushesSent += 1;
    for (const bad of invalidTokens) {
      await this.store.removeDeviceToken(sub, bad);
    }
    if (webSubs.length > 0 && this.webPush.configured) {
      const { invalid } = await this.webPush.send(webSubs, copy);
      for (const bad of invalid) {
        await this.store.removeWebSubscription(sub, bad);
      }
    }
  }

  /** Push "sesi berakhir" maksimal sekali per episode expired. */
  private async sendReloginOnce(
    sub: string,
    summary: CycleSummary,
  ): Promise<void> {
    if (await this.store.getReloginFlagged(sub)) return;
    const tokens = await this.store.getDeviceTokens(sub);
    const webSubs = await this.store.getWebSubscriptions(sub);
    if (tokens.length === 0 && webSubs.length === 0) {
      await this.store.setReloginFlagged(sub, true);
      return;
    }
    await this.deliver(
      sub,
      tokens,
      webSubs,
      {
        title: 'Sesi berakhir',
        body: 'Login ulang lewat web atau extension supaya notifikasi tetap aktif.',
        collapseKey: 'session_expired',
        data: { type: 'session_expired', target: '', payload: '{}' },
      },
      summary,
    );
    await this.store.setReloginFlagged(sub, true);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
