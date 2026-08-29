import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { WebPushService } from './web-push.service';
import { WebSubscriptionRecord } from './notification-store';

jest.mock('web-push');

const mockedWebpush = webpush as jest.Mocked<typeof webpush>;
const setVapidDetails = mockedWebpush.setVapidDetails as jest.Mock;
const sendNotification = mockedWebpush.sendNotification as jest.Mock;

const SUB: WebSubscriptionRecord = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'p256dh-ecc-key',
  auth: 'auth-secret',
};

describe('WebPushService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disabled bila WEB_PUSH_ENABLED false -> configured false', async () => {
    const config = {
      get: (k: string) =>
        k === 'WEB_PUSH_ENABLED'
          ? false
          : undefined,
    } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();
    expect(svc.configured).toBe(false);
    expect(svc.publicKey).toBe('');
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it('disabled bila VAPID key hilang -> configured false, warn', () => {
    const config = {
      get: (k: string) =>
        k === 'WEB_PUSH_ENABLED' ? true : undefined,
    } as unknown as ConfigService;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new WebPushService(config);
    svc.onModuleInit();
    expect(svc.configured).toBe(false);
    expect(setVapidDetails).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('enabled bila env true + keys -> configured true; setVapidDetails dipanggil dengan subject', async () => {
    const config = {
      get: (k: string) =>
        ({
          WEB_PUSH_ENABLED: true,
          WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
          WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
          WEB_PUSH_SUBJECT: 'mailto:admin@yodips.dev',
        } as Record<string, unknown>)[k],
    } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();
    expect(svc.configured).toBe(true);
    expect(svc.publicKey).toBe('pub');
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:admin@yodips.dev',
      'pub',
      'priv',
    );
  });

  it('send -> memanggil sendNotification dgn endpoint/keys + JSON payload', async () => {
    const config = {
      get: (k: string) =>
        ({
          WEB_PUSH_ENABLED: true,
          WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
          WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
          WEB_PUSH_SUBJECT: 'mailto:admin@yodips.dev',
        } as Record<string, unknown>)[k],
    } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const payload = {
      title: 'Tugas baru',
      body: 'Tugas 1 · PWL',
      collapseKey: 'new_task',
      data: { type: 'new_task' },
    };
    const { invalid } = await svc.send([SUB], payload);

    expect(invalid).toEqual([]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [s, json, opts] = sendNotification.mock.calls[0];
    expect(s).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.auth } });
    expect(JSON.parse(json)).toEqual(payload);
    expect(opts.vapidDetails).toEqual({
      subject: 'mailto:admin@yodips.dev',
      publicKey: 'pub',
      privateKey: 'priv',
    });
  });

  it('invalid subscription (statusCode 410/404) -> masuk daftar invalid', async () => {
    const config = {
      get: (k: string) =>
        ({
          WEB_PUSH_ENABLED: true,
          WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
          WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
        } as Record<string, unknown>)[k],
    } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();
    sendNotification.mockRejectedValue({ statusCode: 410 });

    const { invalid } = await svc.send([SUB], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    });
    expect(invalid).toEqual([SUB]);

    sendNotification.mockRejectedValue(new Error('boom')); // non-410 -> tidak invalid
    const { invalid: invalid2 } = await svc.send([SUB], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    });
    expect(invalid2).toEqual([]);
  });

  it('send saat disabled atau no subscriptions -> invalid kosong, tanpa call', async () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();

    const { invalid } = await svc.send([], { title: 't', body: 'b', collapseKey: 'c', data: {} });
    expect(invalid).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
