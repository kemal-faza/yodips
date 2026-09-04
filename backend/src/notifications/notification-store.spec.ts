import { InMemoryNotificationStore } from './notification-store';

describe('InMemoryNotificationStore', () => {
  let now: number;
  const tick = (ms: number) => {
    now += ms;
  };
  const make = () => new InMemoryNotificationStore(() => now);

  beforeEach(() => {
    now = 1_756_000_000_000;
  });

  it('registry token: add/get/remove + indeks sub terprune saat token habis', async () => {
    const s = make();
    await s.addDeviceToken('u1', 'tok-a');
    await s.addDeviceToken('u1', 'tok-b');
    await s.addDeviceToken('u2', 'tok-c');
    expect(await s.listSubsWithTokens()).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(await s.getDeviceTokens('u1')).toEqual(['tok-a', 'tok-b']);

    await s.removeDeviceToken('u1', 'tok-a');
    expect(await s.getDeviceTokens('u1')).toEqual(['tok-b']);
    await s.removeDeviceToken('u1', 'tok-b');
    expect(await s.listSubsWithTokens()).toEqual(['u2']);
    await s.removeDeviceToken('u2', 'missing'); // idempotent
  });

  it('addDeviceToken idempotent utk token sama', async () => {
    const s = make();
    await s.addDeviceToken('u1', 'tok-a');
    await s.addDeviceToken('u1', 'tok-a');
    expect(await s.getDeviceTokens('u1')).toEqual(['tok-a']);
  });

  it('snapshot: roundtrip + kadaluarsa 14 hari -> null', async () => {
    const s = make();
    await s.setSnapshot('u1', 'jadwal', [{ kode: 'X' }]);
    expect(await s.getSnapshot('u1', 'jadwal')).toEqual([{ kode: 'X' }]);
    expect(await s.getSnapshot('u1', 'assignments')).toBeNull();

    tick(14 * 24 * 3600 * 1000 + 1);
    expect(await s.getSnapshot('u1', 'jadwal')).toBeNull();
  });

  it('sent-keys: overwrite penuh + TTL 14 hari', async () => {
    const s = make();
    await s.setSentKeys('u1', 'deadline', ['7:111']);
    await s.setSentKeys('u1', 'deadline', ['7:111', '8:222']);
    expect(await s.getSentKeys('u1', 'deadline')).toEqual(['7:111', '8:222']);
    expect(await s.getSentKeys('u1', 'reschedule')).toEqual([]);

    tick(14 * 24 * 3600 * 1000 + 1);
    expect(await s.getSentKeys('u1', 'deadline')).toEqual([]);
  });

  it('flag re-login: set/clear + TTL 30 hari', async () => {
    const s = make();
    expect(await s.getReloginFlagged('u1')).toBe(false);
    await s.setReloginFlagged('u1', true);
    expect(await s.getReloginFlagged('u1')).toBe(true);
    await s.setReloginFlagged('u1', false);
    expect(await s.getReloginFlagged('u1')).toBe(false);

    await s.setReloginFlagged('u1', true);
    tick(31 * 24 * 3600 * 1000);
    expect(await s.getReloginFlagged('u1')).toBe(false);
  });

  it('cycle lock: eksklusif, unlock bebas, expired otomatis', async () => {
    const s = make();
    expect(await s.tryLockCycle()).toBe(true);
    expect(await s.tryLockCycle()).toBe(false);
    await s.unlockCycle();
    expect(await s.tryLockCycle()).toBe(true);

    await s.unlockCycle();
    await s.tryLockCycle();
    tick(901_000);
    expect(await s.tryLockCycle()).toBe(true);
  });

  it('web subscriptions honor the per-user cap', async () => {
    const s = make();
    for (let i = 0; i < 8; i++) {
      expect(
        await s.addWebSubscription('u1', {
          endpoint: `https://pusher/${i}`,
          p256dh: 'p',
          auth: 'a',
        }),
      ).toBe('added');
    }
    expect(
      await s.addWebSubscription('u1', {
        endpoint: 'https://pusher/9',
        p256dh: 'p',
        auth: 'a',
      }),
    ).toBe('cap-reached');
    expect(await s.getWebSubscriptions('u1')).toHaveLength(8);
  });

  it('re-adding the same endpoint reports duplicate, not cap-reached', async () => {
    const s = make();
    await s.addWebSubscription('u1', {
      endpoint: 'https://pusher/1',
      p256dh: 'p',
      auth: 'a',
    });
    expect(
      await s.addWebSubscription('u1', {
        endpoint: 'https://pusher/1',
        p256dh: 'p',
        auth: 'a',
      }),
    ).toBe('duplicate');
    // duplicate does not consume a slot — still only 1 stored
    expect(await s.getWebSubscriptions('u1')).toHaveLength(1);
  });

  it('a caller-supplied cap overrides the default', async () => {
    const s = make();
    expect(
      await s.addWebSubscription(
        'u1',
        { endpoint: 'https://pusher/1', p256dh: 'p', auth: 'a' },
        1,
      ),
    ).toBe('added');
    expect(
      await s.addWebSubscription(
        'u1',
        { endpoint: 'https://pusher/2', p256dh: 'p', auth: 'a' },
        1,
      ),
    ).toBe('cap-reached');
  });
});
