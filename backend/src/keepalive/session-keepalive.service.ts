import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SessionStore } from '../session/session-store';
import type { CapturedSession } from '../session/session-contract';
import { KulonUpstreamSession } from '../kulon/kulon-upstream.session';
import { SiapUpstreamSession } from '../siap/siap-upstream.session';
import { mergeSessionCookie } from './merge-session-cookie';
import type { KeepAliveProbeResult } from './keepalive-probe';
import { SsoSessionProbe } from './sso-session.probe';

const JOB_NAME = 'session-keepalive';
const CHUNK_SIZE = 4;

/**
 * Periodic keep-alive: probes each captured upstream session and persists
 * rotated cookies through the store's strict per-cookie CAS.
 *
 * Probes run SEQUENTIALLY per session (SSO → Kulon → SIAP) so a single
 * session never fans out three upstream requests at once; sessions are
 * processed in bounded chunks with jitter. A rotated cookie is written
 * immediately, keeping the next CAS's `expected` snapshot current.
 */
@Injectable()
export class SessionKeepAliveService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SessionKeepAliveService.name);
  private running = false;
  private job?: CronJob;

  constructor(
    @Inject(SessionStore) private readonly store: SessionStore,
    private readonly sso: SsoSessionProbe,
    private readonly kulon: KulonUpstreamSession,
    private readonly siap: SiapUpstreamSession,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('SESSION_KEEPALIVE_ENABLED')) {
      this.logger.warn('SESSION_KEEPALIVE_ENABLED false — keep-alive mati');
      return;
    }
    const expression =
      this.config.get<string>('SESSION_KEEPALIVE_CRON') ?? '*/30 * * * *';
    const job = new CronJob(expression, () => {
      void this.runCycle().catch(() =>
        this.logger.error('[session.keepalive] cycle_failed'),
      );
    });
    this.job = job;
    this.scheduler.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Keep-alive aktif (${expression})`);
  }

  onApplicationShutdown(): void {
    if (!this.job) return;
    this.job.stop();
    this.scheduler.deleteCronJob(JOB_NAME);
    this.job = undefined;
  }

  async runCycle(nowMs: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cap = Number(this.config.get('SESSION_ABSOLUTE_TTL_MS') ?? 0);
      const allowlist = new Set(
        (this.config.get<string>('SESSION_KEEPALIVE_ALLOWLIST') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
      const concurrency = Math.min(
        10,
        Math.max(1, Number(this.config.get('SESSION_KEEPALIVE_CONCURRENCY') ?? CHUNK_SIZE)),
      );
      const budget = Number(
        this.config.get('SESSION_KEEPALIVE_CYCLE_BUDGET_MS') ?? 1_200_000,
      );
      const deadline = nowMs + budget;
      const jitter = Number(
        this.config.get('SESSION_KEEPALIVE_JITTER_MS') ?? 15_000,
      );
      const rateLimited = new Set<string>();
      const sessions = (await this.store.all()).filter(
        (session) =>
          (!allowlist.size || allowlist.has(session.identity)) &&
          (cap <= 0 || nowMs - session.capturedAt < cap),
      );

      for (let index = 0; index < sessions.length; index += concurrency) {
        if (Date.now() >= deadline) break;
        const chunk = sessions.slice(index, index + concurrency);
        await Promise.all(
          chunk.map(async (session) => {
            if (jitter > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, Math.random() * jitter),
              );
            }
            await this.refreshSession(session, deadline, rateLimited).catch(
              () => undefined,
            );
          }),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async refreshSession(
    session: CapturedSession,
    deadline: number,
    rateLimited: Set<string>,
  ): Promise<void> {
    const started = Date.now();
    const probes: Array<{ result: KeepAliveProbeResult }> = [];
    probes.push(
      await this.probe('sso', rateLimited, () =>
        this.sso.probe(session.ssoCookie),
      ),
    );
    probes.push(
      await this.probe('kulon', rateLimited, () =>
        this.kulon.probeForKeepAlive(session.kulonCookie),
      ),
    );
    probes.push(
      await this.probe('siap', rateLimited, () =>
        this.siap.probeForKeepAlive(session.siapCookie),
      ),
    );

    if (Date.now() >= deadline) return;
    if (!probes.some((probe) => probe.result.valid)) {
      this.logger.log(
        `[session.keepalive] no-valid-probe (${Date.now() - started}ms)`,
      );
      return;
    }

    let expected = session;
    let rotated = false;

    const renew = async (
      field: 'ssoCookie' | 'kulonCookie' | 'siapCookie',
      result: KeepAliveProbeResult,
      matcher: RegExp,
    ): Promise<boolean> => {
      if (!result.valid || result.setCookies.length === 0) return true;
      const merged = mergeSessionCookie(String(expected[field] ?? ''), result.setCookies, matcher);
      if (!merged.changed) return true;
      if (!merged.cookie.trim()) {
        this.logger.log(
          `[session.keepalive] ${field} cleared upstream; skipping renewal`,
        );
        return true;
      }
      const replacement = { ...expected, [field]: merged.cookie };
      const outcome = await this.store.replaceIfUnchanged(
        expected.identity,
        expected.sessionGeneration,
        expected,
        replacement,
      );
      if (outcome !== 'updated') return false;
      expected = replacement;
      rotated = true;
      return true;
    };

    if (!(await renew('ssoCookie', probes[0].result, /^ci_session_sso$/))) return;
    if (!(await renew('kulonCookie', probes[1].result, /^MoodleSession/))) return;
    if (!(await renew('siapCookie', probes[2].result, /^(?:sia_|sipp|siapp|ciapp_)/i))) return;

    if (!rotated) {
      await this.store.getIfGeneration(session.identity, session.sessionGeneration);
    }
    this.logger.log(
      `[session.keepalive] rotated=${rotated} (${Date.now() - started}ms)`,
    );
  }

  private async probe(
    service: string,
    rateLimited: Set<string>,
    run: () => Promise<KeepAliveProbeResult>,
  ): Promise<{ result: KeepAliveProbeResult }> {
    if (rateLimited.has(service)) {
      return { result: { valid: false, kind: 'rate-limited', setCookies: [] } };
    }
    try {
      const result = await run();
      if (!result.valid && result.kind === 'rate-limited') rateLimited.add(service);
      return { result };
    } catch {
      return { result: { valid: false, kind: 'transient', setCookies: [] } };
    }
  }
}
