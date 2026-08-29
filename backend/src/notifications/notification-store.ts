export type SnapshotKey = 'assignments' | 'jadwal';
export type SentKind = 'deadline' | 'reschedule';

export const SNAPSHOT_TTL_MS = 14 * 24 * 3600 * 1000;
export const SENT_TTL_MS = 14 * 24 * 3600 * 1000;
export const RELOGIN_TTL_MS = 30 * 24 * 3600 * 1000;
export const LOCK_TTL_S = 900;

/**
 * Web Push subscription yang disimpan per-user (mirror PushSubscription).
 * Store hanya menyimpan objek { endpoint, p256dh, auth } — tidak menyimpan
 * seluruh browser subscription/options.
 */
export interface WebSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * State notifikasi per-user (registry token FCM, snapshot diff, dedup, flag
 * re-login, lock siklus). Pola ala SessionStore: InMemory dev/test, Redis prod.
 */
export abstract class NotificationStore {
  abstract addDeviceToken(sub: string, token: string): Promise<void>;
  abstract removeDeviceToken(sub: string, token: string): Promise<void>;
  abstract getDeviceTokens(sub: string): Promise<string[]>;
  abstract listSubsWithTokens(): Promise<string[]>;

  abstract addWebSubscription(sub: string, s: WebSubscriptionRecord): Promise<void>;
  abstract removeWebSubscription(sub: string, s: WebSubscriptionRecord): Promise<void>;
  abstract getWebSubscriptions(sub: string): Promise<WebSubscriptionRecord[]>;
  abstract listSubsWithWeb(): Promise<string[]>;

  abstract getSnapshot<T>(sub: string, key: SnapshotKey): Promise<T | null>;
  abstract setSnapshot<T>(sub: string, key: SnapshotKey, value: T): Promise<void>;

  abstract getSentKeys(sub: string, kind: SentKind): Promise<string[]>;
  abstract setSentKeys(sub: string, kind: SentKind, values: string[]): Promise<void>;

  abstract getReloginFlagged(sub: string): Promise<boolean>;
  abstract setReloginFlagged(sub: string, flagged: boolean): Promise<void>;

  abstract tryLockCycle(): Promise<boolean>;
  abstract unlockCycle(): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/** In-memory store utk dev/test (single event loop). */
export class InMemoryNotificationStore extends NotificationStore {
  private readonly kv = new Map<string, Entry>();
  private readonly subs = new Map<string, string[]>();
  private readonly web = new Map<string, WebSubscriptionRecord[]>();
  private lockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  async addDeviceToken(sub: string, token: string): Promise<void> {
    const cur = this.subs.get(sub) ?? [];
    if (!cur.includes(token)) cur.push(token);
    this.subs.set(sub, cur);
  }

  async removeDeviceToken(sub: string, token: string): Promise<void> {
    const rest = (this.subs.get(sub) ?? []).filter((t) => t !== token);
    if (rest.length === 0) this.subs.delete(sub);
    else this.subs.set(sub, rest);
  }

  async getDeviceTokens(sub: string): Promise<string[]> {
    return this.subs.get(sub) ?? [];
  }

  async listSubsWithTokens(): Promise<string[]> {
    return [...this.subs.keys()];
  }

  async addWebSubscription(sub: string, s: WebSubscriptionRecord): Promise<void> {
    const cur = this.web.get(sub) ?? [];
    if (!cur.some((e) => e.endpoint === s.endpoint)) cur.push(s);
    this.web.set(sub, cur);
  }

  async removeWebSubscription(sub: string, s: WebSubscriptionRecord): Promise<void> {
    const cur = this.web.get(sub) ?? [];
    const rest = cur.filter((e) => e.endpoint !== s.endpoint);
    if (rest.length === 0) this.web.delete(sub);
    else this.web.set(sub, rest);
  }

  async getWebSubscriptions(sub: string): Promise<WebSubscriptionRecord[]> {
    return this.web.get(sub) ?? [];
  }

  async listSubsWithWeb(): Promise<string[]> {
    return [...this.web.keys()];
  }

  async getSnapshot<T>(sub: string, key: SnapshotKey): Promise<T | null> {
    return this.getExpired<T>(`${sub}:snap:${key}`);
  }

  async setSnapshot<T>(sub: string, key: SnapshotKey, value: T): Promise<void> {
    this.put(`${sub}:snap:${key}`, value, SNAPSHOT_TTL_MS);
  }

  async getSentKeys(sub: string, kind: SentKind): Promise<string[]> {
    return this.getExpired<string[]>(`${sub}:sent:${kind}`) ?? [];
  }

  async setSentKeys(sub: string, kind: SentKind, values: string[]): Promise<void> {
    this.put(`${sub}:sent:${kind}`, values, SENT_TTL_MS);
  }

  async getReloginFlagged(sub: string): Promise<boolean> {
    return (await this.getExpired<boolean>(`${sub}:relogin`)) === true;
  }

  async setReloginFlagged(sub: string, flagged: boolean): Promise<void> {
    if (flagged) this.put(`${sub}:relogin`, true, RELOGIN_TTL_MS);
    else this.kv.delete(`${sub}:relogin`);
  }

  async tryLockCycle(): Promise<boolean> {
    if (this.now() < this.lockedUntil) return false;
    this.lockedUntil = this.now() + LOCK_TTL_S * 1000;
    return true;
  }

  async unlockCycle(): Promise<void> {
    this.lockedUntil = 0;
  }

  private put(key: string, value: unknown, ttlMs: number) {
    this.kv.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  private getExpired<T>(key: string): T | null {
    const e = this.kv.get(key);
    if (!e) return null;
    if (this.now() > e.expiresAt) {
      this.kv.delete(key);
      return null;
    }
    return e.value as T;
  }
}
