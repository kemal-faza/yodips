import { RedisNotificationStore } from './redis-notification.store';

/** Fake ioredis minimal: subset perintah yang dipakai store. */
function fakeRedis() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const expiries = new Map<string, number>();
  let now = 1_756_000_000_000;
  const expired = (key: string) => {
    const at = expiries.get(key);
    if (at !== undefined && now > at) {
      strings.delete(key);
      sets.delete(key);
      expiries.delete(key);
      return true;
    }
    return false;
  };
  return {
    advance: (ms: number) => {
      now += ms;
    },
    client: {
      async get(key: string) {
        expired(key);
        return strings.get(key) ?? null;
      },
      async set(key: string, value: string, ...rest: unknown[]) {
        expired(key);
        const mode = rest[0];
        if (mode === 'EX' || mode === 'PX') {
          const ttl = rest[1] as number;
          // SET key val EX t NX — hormati NX agar test lock eksklusif
          // mencerminkan semantik Redis sungguhan.
          if (rest[2] === 'NX' && strings.has(key)) return null;
          expiries.set(key, now + (mode === 'EX' ? ttl * 1000 : ttl));
          strings.set(key, value);
          return 'OK';
        }
        if (mode === 'NX') {
          if (strings.has(key)) return null;
          strings.set(key, value);
          if (rest[1] === 'EX') expiries.set(key, now + (rest[2] as number) * 1000);
          return 'OK';
        }
        strings.set(key, value);
        return 'OK';
      },
      async del(key: string) {
        strings.delete(key);
        sets.delete(key);
        return 1;
      },
      async sadd(key: string, member: string) {
        expired(key);
        const s = sets.get(key) ?? new Set<string>();
        const added = s.has(member) ? 0 : 1;
        s.add(member);
        sets.set(key, s);
        return added;
      },
      async srem(key: string, member: string) {
        expired(key);
        const s = sets.get(key);
        if (!s) return 0;
        const removed = s.has(member) ? 1 : 0;
        s.delete(member);
        if (s.size === 0) sets.delete(key);
        return removed;
      },
      async smembers(key: string) {
        expired(key);
        return [...(sets.get(key) ?? [])];
      },
    },
  };
}

describe('RedisNotificationStore', () => {
  it('paritas perilaku dengan kontrak NotificationStore', async () => {
    const f = fakeRedis();
    const s = new RedisNotificationStore(f.client as any, () => f.now);

    await s.addDeviceToken('u1', 'a');
    await s.addDeviceToken('u1', 'a'); // idempotent
    await s.addDeviceToken('u1', 'b');
    expect(await s.getDeviceTokens('u1')).toEqual(['a', 'b']);
    expect(await s.listSubsWithTokens()).toEqual(['u1']);

    await s.removeDeviceToken('u1', 'a');
    expect(await s.getDeviceTokens('u1')).toEqual(['b']);
    await s.removeDeviceToken('u1', 'b');
    expect(await s.listSubsWithTokens()).toEqual([]); // indeks terprune

    await s.setSnapshot('u1', 'jadwal', [{ x: 1 }]);
    expect(await s.getSnapshot('u1', 'jadwal')).toEqual([{ x: 1 }]);
    expect(await s.getSnapshot('u1', 'assignments')).toBeNull();

    await s.setSentKeys('u1', 'deadline', ['k1']);
    expect(await s.getSentKeys('u1', 'deadline')).toEqual(['k1']);

    await s.setReloginFlagged('u1', true);
    expect(await s.getReloginFlagged('u1')).toBe(true);
    await s.setReloginFlagged('u1', false);
    expect(await s.getReloginFlagged('u1')).toBe(false);

    expect(await s.tryLockCycle()).toBe(true);
    expect(await s.tryLockCycle()).toBe(false);
    await s.unlockCycle();
    expect(await s.tryLockCycle()).toBe(true);
  });

  it('snapshot kedaluwarsa setelah 14 hari', async () => {
    const f = fakeRedis();
    const s = new RedisNotificationStore(f.client as any, () => f.now);
    await s.setSnapshot('u1', 'assignments', [{ id: 1 }]);
    f.advance(14 * 24 * 3600 * 1000 + 1000);
    expect(await s.getSnapshot('u1', 'assignments')).toBeNull();
  });

  it('lock kedaluwarsa otomatis (900 s)', async () => {
    const f = fakeRedis();
    const s = new RedisNotificationStore(f.client as any, () => f.now);
    expect(await s.tryLockCycle()).toBe(true);
    f.advance(901_000);
    expect(await s.tryLockCycle()).toBe(true);
  });
});
