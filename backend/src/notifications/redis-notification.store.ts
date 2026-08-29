import type Redis from 'ioredis';
import {
  LOCK_TTL_S,
  NotificationStore,
  RELOGIN_TTL_MS,
  SENT_TTL_MS,
  SentKind,
  SNAPSHOT_TTL_MS,
  SnapshotKey,
  WebSubscriptionRecord,
} from './notification-store';

const SUBS_KEY = 'notif:subs';
const SUBS_WEB_KEY = 'notif:subs:web';
const LOCK_KEY = 'notif:cycle-lock';
const seconds = (ms: number) => Math.floor(ms / 1000);

export class RedisNotificationStore extends NotificationStore {
  constructor(
    private readonly client: Redis,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  async addDeviceToken(sub: string, token: string): Promise<void> {
    const key = `notif:tokens:${sub}`;
    const raw = await this.client.get(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(token)) list.push(token);
    await this.client.set(key, JSON.stringify(list));
    await this.client.sadd(SUBS_KEY, sub);
  }

  async removeDeviceToken(sub: string, token: string): Promise<void> {
    const key = `notif:tokens:${sub}`;
    const raw = await this.client.get(key);
    if (!raw) return;
    const rest: string[] = JSON.parse(raw).filter((t: string) => t !== token);
    if (rest.length === 0) {
      await this.client.del(key);
      await this.client.srem(SUBS_KEY, sub);
    } else {
      await this.client.set(key, JSON.stringify(rest));
    }
  }

  async getDeviceTokens(sub: string): Promise<string[]> {
    const raw = await this.client.get(`notif:tokens:${sub}`);
    return raw ? JSON.parse(raw) : [];
  }

  async listSubsWithTokens(): Promise<string[]> {
    return this.client.smembers(SUBS_KEY);
  }

  async addWebSubscription(sub: string, s: WebSubscriptionRecord): Promise<void> {
    const key = `notif:web:${sub}`;
    const raw = await this.client.get(key);
    const list: WebSubscriptionRecord[] = raw ? JSON.parse(raw) : [];
    if (!list.some((e) => e.endpoint === s.endpoint)) list.push(s);
    await this.client.set(key, JSON.stringify(list));
    await this.client.sadd(SUBS_WEB_KEY, sub);
  }

  async removeWebSubscription(sub: string, s: WebSubscriptionRecord): Promise<void> {
    const key = `notif:web:${sub}`;
    const raw = await this.client.get(key);
    if (!raw) return;
    const rest: WebSubscriptionRecord[] = JSON.parse(raw).filter(
      (e: WebSubscriptionRecord) => e.endpoint !== s.endpoint,
    );
    if (rest.length === 0) {
      await this.client.del(key);
      await this.client.srem(SUBS_WEB_KEY, sub);
    } else {
      await this.client.set(key, JSON.stringify(rest));
    }
  }

  async getWebSubscriptions(sub: string): Promise<WebSubscriptionRecord[]> {
    const raw = await this.client.get(`notif:web:${sub}`);
    return raw ? JSON.parse(raw) : [];
  }

  async listSubsWithWeb(): Promise<string[]> {
    return this.client.smembers(SUBS_WEB_KEY);
  }

  async getSnapshot<T>(sub: string, key: SnapshotKey): Promise<T | null> {
    const raw = await this.client.get(`notif:snap:${sub}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setSnapshot<T>(sub: string, key: SnapshotKey, value: T): Promise<void> {
    await this.client.set(
      `notif:snap:${sub}:${key}`,
      JSON.stringify(value),
      'EX',
      seconds(SNAPSHOT_TTL_MS),
    );
  }

  async getSentKeys(sub: string, kind: SentKind): Promise<string[]> {
    const raw = await this.client.get(`notif:sent:${sub}:${kind}`);
    return raw ? JSON.parse(raw) : [];
  }

  async setSentKeys(sub: string, kind: SentKind, values: string[]): Promise<void> {
    await this.client.set(
      `notif:sent:${sub}:${kind}`,
      JSON.stringify(values),
      'EX',
      seconds(SENT_TTL_MS),
    );
  }

  async getReloginFlagged(sub: string): Promise<boolean> {
    return (await this.client.get(`notif:relogin:${sub}`)) === '1';
  }

  async setReloginFlagged(sub: string, flagged: boolean): Promise<void> {
    if (flagged) {
      await this.client.set(
        `notif:relogin:${sub}`,
        '1',
        'EX',
        seconds(RELOGIN_TTL_MS),
      );
    } else {
      await this.client.del(`notif:relogin:${sub}`);
    }
  }

  async tryLockCycle(): Promise<boolean> {
    // SET NX EX atomik; ioredis balas 'OK' saat berhasil, null saat gagal.
    const got = (await this.client.set(
      LOCK_KEY,
      String(this.now()),
      'EX',
      LOCK_TTL_S,
      'NX',
    )) as unknown;
    return got === 'OK';
  }

  async unlockCycle(): Promise<void> {
    await this.client.del(LOCK_KEY);
  }
}
