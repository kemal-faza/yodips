import { Injectable, Logger } from '@nestjs/common';
import { CapturedSession } from '../playwright/playwright-auth.service';

/**
 * Stores captured SSO sessions keyed by user identity (NIM).
 * In-memory implementation; swap for Redis/DB in production (interface only).
 */
@Injectable()
export class SessionStore {
  private readonly logger = new Logger(SessionStore.name);
  private readonly sessions = new Map<string, CapturedSession>();

  set(identity: string, session: CapturedSession): void {
    this.sessions.set(identity, session);
    this.logger.log(`SSO session stored for ${identity}`);
  }

  get(identity: string): CapturedSession | null {
    return this.sessions.get(identity) ?? null;
  }

  clear(identity: string): void {
    this.sessions.delete(identity);
  }

  all(): CapturedSession[] {
    return [...this.sessions.values()];
  }
}