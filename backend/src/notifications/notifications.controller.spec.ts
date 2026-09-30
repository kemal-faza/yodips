import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { MAX_WEB_SUBSCRIPTIONS, NotificationStore } from './notification-store';

interface WebSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface StoreSpy {
  addDeviceToken: jest.Mock;
  removeDeviceToken: jest.Mock;
  getDeviceTokens: jest.Mock;
  addWebSubscription: jest.Mock;
  removeWebSubscription: jest.Mock;
  getWebSubscriptions: jest.Mock;
}

/**
 * Store spy: kontrak controller adalah DELEGASI (panggil method store dengan
 * argumen yang benar + map hasilnya ke HTTP). Prune indeks, cap per-user dan
 * idempotensi duplicate dimiliki `notification-store.spec.ts`.
 */
function makeStore(): StoreSpy {
  return {
    addDeviceToken: jest.fn().mockResolvedValue(undefined),
    removeDeviceToken: jest.fn().mockResolvedValue(undefined),
    getDeviceTokens: jest.fn().mockResolvedValue([]),
    addWebSubscription: jest.fn().mockResolvedValue('added'),
    removeWebSubscription: jest.fn().mockResolvedValue(undefined),
    getWebSubscriptions: jest.fn().mockResolvedValue([]),
  };
}

function makeController(
  opts: { nodeEnv?: string; vapidPublicKey?: string; webPushCap?: number } = {},
) {
  const store = makeStore();
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
    get: (k: string) => {
      if (k === 'NODE_ENV') return opts.nodeEnv ?? 'development';
      if (k === 'WEB_PUSH_MAX_SUBSCRIPTIONS') return opts.webPushCap;
      return undefined;
    },
  };
  const fakeWebPush = {
    publicKey: opts.vapidPublicKey ?? '',
    send: async () => ({ invalid: [] }),
  };
  const controller = new NotificationsController(
    store as unknown as NotificationStore,
    fakePoller as any,
    fakeConfig as any,
    fakeWebPush as any,
  );
  return { store, fakePoller, fakeWebPush, controller };
}

describe('NotificationsController', () => {
  it('POST device mendaftarkan token utk req.user.sub', async () => {
    const { store, controller } = makeController();
    await expect(
      controller.register({ user: { sub: 'u1' } }, { token: 'tok-1' }),
    ).resolves.toEqual({ ok: true });
    expect(store.addDeviceToken).toHaveBeenCalledWith('u1', 'tok-1');
  });

  it('POST tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller.register({}, { token: 'tok' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DELETE device mendelegasikan penghapusan token ke store', async () => {
    const { store, controller } = makeController();
    await expect(
      controller.unregister({ user: { sub: 'u1' } }, { token: 'tok-1' }),
    ).resolves.toEqual({ ok: true });
    expect(store.removeDeviceToken).toHaveBeenCalledWith('u1', 'tok-1');
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

  it('POST web-device menyimpan subscription + cap default store', async () => {
    const { store, controller } = makeController();
    const sub: WebSub = { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' };
    await expect(controller.registerWeb({ user: { sub: 'u1' } }, sub)).resolves.toEqual({
      ok: true,
    });
    expect(store.addWebSubscription).toHaveBeenCalledWith('u1', sub, MAX_WEB_SUBSCRIPTIONS);
  });

  it('POST web-device memakai WEB_PUSH_MAX_SUBSCRIPTIONS bila di-set', async () => {
    const { store, controller } = makeController({ webPushCap: 3 });
    const sub: WebSub = { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' };
    await controller.registerWeb({ user: { sub: 'u1' } }, sub);
    expect(store.addWebSubscription).toHaveBeenCalledWith('u1', sub, 3);
  });

  it('POST web-device tanpa sub -> 401', async () => {
    const { controller } = makeController();
    const err = await controller
      .registerWeb({}, { endpoint: 'e', p256dh: 'p', auth: 'a' })
      .catch((e) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('registerWeb: duplicate dari store tetap sukses (idempotent)', async () => {
    const { store, controller } = makeController();
    store.addWebSubscription.mockResolvedValue('duplicate');
    await expect(
      controller.registerWeb(
        { user: { sub: 'u1' } },
        { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' },
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('registerWeb: cap-reached dari store -> 409 WEB_PUSH_CAP_REACHED', async () => {
    const { store, controller } = makeController();
    store.addWebSubscription.mockResolvedValue('cap-reached');
    const err = await controller
      .registerWeb(
        { user: { sub: 'u1' } },
        { endpoint: 'https://pusher/9', p256dh: 'pk', auth: 'auth' },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'WEB_PUSH_CAP_REACHED' });
  });

  it('DELETE web-device mendelegasikan penghapusan subscription ke store', async () => {
    const { store, controller } = makeController();
    const sub: WebSub = { endpoint: 'https://pusher/abc', p256dh: 'pk', auth: 'auth' };
    await expect(controller.removeWeb({ user: { sub: 'u1' } }, sub)).resolves.toEqual({
      ok: true,
    });
    expect(store.removeWebSubscription).toHaveBeenCalledWith('u1', sub);
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
});
