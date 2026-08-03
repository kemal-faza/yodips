import { Injectable, Logger } from '@nestjs/common';
import { CapturedSession } from '../playwright/playwright-auth.service';

/**
 * Stores the captured SSO session for the current user.
 * In-memory implementation; swap for Redis/DB in production.
 */
@Injectable()
export class SessionStore {
  private readonly logger = new Logger(SessionStore.name);
  private session: CapturedSession | null = null;

  set(session: CapturedSession): void {
    this.session = session;
    this.logger.log('SSO session stored in memory');
  }

  get(): CapturedSession | null {
    return this.session;
  }

  clear(): void {
    this.session = null;
  }
}