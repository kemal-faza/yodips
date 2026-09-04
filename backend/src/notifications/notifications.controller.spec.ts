import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationStore } from './notification-store';

class StoreMock implements Partial<NotificationStore> {
  tokens: Record<string, string[]> = {};
  subs = new Set<string>();
  web: Record<string, Array<{ endpoint: string; p256dh: string; auth: string }>> = {};
  async addDeviceToken(sub: string, token: string) {
    const list = this.tokens[sub] ?? (this.tokens[sub] = []);
    if (!list.includes(token)) list.push(token);
    this.subs.add(sub);
  }
  async removeDeviceToken(sub: string, token: string) {
    const rest = (this.tokens[sub] ?? []).filter((t) => t !== token);
    this.tokens[sub] = rest;
    if (rest.length === 0) this.subs.delete(sub);
  }
  async getDeviceTokens(sub: string) {
    return this.tokens[sub] ?? [];
  }
  async addWebSubscription(
    sub: string,
    s: { endpoint: string; p256dh: string; auth: string },
    cap = 8,
  ) {
    const list = this.web[sub] ?? (this.web[sub] = []);
    if (list.some((e) => e.endpoint === s.endpoint)) return 'duplicate';
    if (list.length >= cap) return 'cap-reached';
    list.push(s);
    return 'added';
  }
  async removeWebSubscription(sub: string, s: { endpoint: string; p256dh: string; auth: string }) {
    const list = this.web[sub] ?? [];
    const rest = list.filter((e) => e.endpoint !== s.endpoint);
    if (rest.length === 0) delete this.web[sub];
    else this.web[sub] = rest;
  }
  async getWebSubscriptions(sub: string) {
    return this.web[sub] ?? [];
  }
}

function makeController(opts: { nodeEnv?: string; vapidPublicKey?: string } = {}) {
  const store = new StoreMock();
  const fakePoller = {
    runCycle: async () => ({ usersChecked: 0, pushesSent: 0 }),
    calls: [] as Array<[number, number | undefined]>,
  };
  // track argumen utk verifikasi threading window
  fakePoller.runCycle = async (nowMs?: number, windowMs?: number) => {
    fakePoller.calls.push([nowMs ?? -1, windowMs]);
    return { usersChecked: 0, pushesSent: 0 };
  };
  const fakeConfig = {
    get: (k: string) => (k === 'NODE_ENV' ? opts.nodeEnv ?? 'development' : undefined),
  };
  const fakeWebPush = {
    publicKey: opts.vapidPublicKey ?? '',
    send: async () => ({ invalid: [] }),
  };
  const controller = new NotificationsController(
    store,
    fakePoller as any,
    fakeConfig as any,
    fakeWebPush as any,
  );
  return { store, fakePoller, fakeWebPush, controller };
}

describe('NotificationsController', () => {
  it('POST device menyimpan token utk req.user.sub', async () => {
    const { store, controller } = makeController();
    await controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' });
    expect(await store.getDeviceTokens('u1')).toEqual(['tok-1']);
  });

  it('POST tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller.register({}, { token: 'tok' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DELETE menghapus token; token terakhir memprune indeks', async () => {
    const { store, controller } = makeController();
    await controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' });
    await controller.unregister({ user: { sub: 'u1' } }, { token: 'tok-1' });
    expect(await store.getDeviceTokens('u1')).toEqual([]);
    expect(store.subs.size).toBe(0);
  });

  it('DELETE tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller.unregister({}, { token: 'tok' }).catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('devRunCycle di development menjalankan satu siklus + threading window', async () => {
    const { fakePoller, controller } = makeController();
    const sum = await controller.devRunCycle('2');
    expect(sum).toEqual({ usersChecked: 0, pushesSent: 0 });
    expect(fakePoller.calls[0][1]).toBe(2 * 3600 * 1000); // deadlineWindowMs
  });

  it('devRunCycle menolak di production', async () => {
    const { controller } = makeController({ nodeEnv: 'production' });
    const err = await controller.devRunCycle().catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it('POST web-device menyimpan web subscription utk req.user.sub', async () => {
    const { store, controller } = makeController();
    await controller.registerWeb(
      { user: { sub: 'u1' } },
      { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' },
    );
    expect(await store.getWebSubscriptions('u1')).toEqual([
      { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' },
    ]);
  });

  it('POST web-device tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller
      .registerWeb({}, { endpoint: 'e', p256dh: 'p', auth: 'a' })
      .catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DELETE web-device menghapus subscription', async () => {
    const { store, controller } = makeController();
    const sub = { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' };
    await controller.registerWeb({ user: { sub: 'u1' } }, sub);
    await controller.removeWeb({ user: { sub: 'u1' } }, sub);
    expect(await store.getWebSubscriptions('u1')).toEqual([]);
  });

  it('DELETE web-device tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller
      .removeWeb({}, { endpoint: 'e', p256dh: 'p', auth: 'a' })
      .catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('GET vapid-public-key mengembalikan publicKey dari WebPushService', async () => {
    const { controller } = makeController({ vapidPublicKey: 'vapid-pub' });
    expect(await controller.vapidPublicKey()).toEqual({ publicKey: 'vapid-pub' });
  });

  it('registerWeb: duplicate endpoint is idempotent (second call returns ok, single stored)', async () => {
    const { store, controller } = makeController();
    const sub = { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' };
    await controller.registerWeb({ user: { sub: 'u1' } }, sub);
    await expect(controller.registerWeb({ user: { sub: 'u1' } }, sub)).resolves.toEqual({ ok: true });
    expect(await store.getWebSubscriptions('u1')).toEqual([sub]);
  });

  it('registerWeb: 9th subscription for one user -> 409 WEB_PUSH_CAP_REACHED', async () => {
    const { store, controller } = makeController();
    for (let i = 0; i < 8; i++) {
      await controller.registerWeb(
        { user: { sub: 'u1' } },
        { endpoint: `https://pusher/${i}`, p256dh: 'pk', auth: 'auth' },
      );
    }
    const err = await controller
      .registerWeb(
        { user: { sub: 'u1' } },
        { endpoint: 'https://pusher/9', p256dh: 'pk', auth: 'auth' },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'WEB_PUSH_CAP_REACHED' });
    expect(await store.getWebSubscriptions('u1')).toHaveLength(8);
  });

  it('registerWeb: over-cap for user u2 does not affect u1', async () => {
    const { store, controller } = makeController();
    for (let i = 0; i < 8; i++) {
      await controller.registerWeb(
        { user: { sub: 'u1' } },
        { endpoint: `https://pusher/${i}`, p256dh: 'pk', auth: 'auth' },
      );
    }
    await controller.registerWeb(
      { user: { sub: 'u2' } },
      { endpoint: 'https://pusher/only', p256dh: 'pk', auth: 'auth' },
    );
    expect(await store.getWebSubscriptions('u2')).toHaveLength(1);
  });
});
