import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { CycleSendBudget, WebPushService } from './web-push.service';
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

/** ConfigService stub enabling Web Push with fixed VAPID keys. */
function enabledConfig(): ConfigService {
  return {
    get: (k: string) =>
      ({
        WEB_PUSH_ENABLED: true,
        WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
        WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
        WEB_PUSH_SUBJECT: 'mailto:admin@yodips.dev',
      } as Record<string, unknown>)[k],
  } as unknown as ConfigService;
}

/** Build a service whose resolver rejects any non-public host (no real DNS). */
function makeService(): WebPushService {
  const svc = new WebPushService(enabledConfig());
  svc.onModuleInit();
  // Hostname-driven fake resolver: fcm.googleapis.com resolves public, every
  // other hostname fails closed (shape-valid but non-public / unresolvable).
  svc.resolveHost = async (hostname: string) =>
    hostname === 'fcm.googleapis.com'
      ? { ok: true as const, records: [{ address: '142.250.4.100', family: 4 }] }
      : { ok: false as const, reason: 'non-public' as const };
  return svc;
}

const BUDGET = (n: number) => new CycleSendBudget(n);

describe('WebPushService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disabled bila WEB_PUSH_ENABLED false -> configured false', () => {
    const config = {
      get: (k: string) => (k === 'WEB_PUSH_ENABLED' ? false : undefined),
    } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();
    expect(svc.configured).toBe(false);
    expect(svc.publicKey).toBe('');
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it('disabled bila VAPID key hilang -> configured false, warn', () => {
    const config = {
      get: (k: string) => (k === 'WEB_PUSH_ENABLED' ? true : undefined),
    } as unknown as ConfigService;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = new WebPushService(config);
    svc.onModuleInit();
    expect(svc.configured).toBe(false);
    expect(setVapidDetails).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('enabled bila env true + keys -> configured true; setVapidDetails dipanggil dengan subject', () => {
    const svc = new WebPushService(enabledConfig());
    svc.onModuleInit();
    expect(svc.configured).toBe(true);
    expect(svc.publicKey).toBe('pub');
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:admin@yodips.dev',
      'pub',
      'priv',
    );
  });

  it('send -> memanggil sendNotification dgn endpoint/keys + JSON payload + pinned agent + timeout', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const payload = {
      title: 'Tugas baru',
      body: 'Tugas 1 · PWL',
      collapseKey: 'new_task',
      data: { type: 'new_task' },
    };
    const { invalid } = await svc.send([SUB], payload, BUDGET(10));

    expect(invalid).toEqual([]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [s, json, opts] = sendNotification.mock.calls[0];
    expect(s).toEqual({
      endpoint: SUB.endpoint,
      keys: { p256dh: SUB.p256dh, auth: SUB.auth },
    });
    expect(JSON.parse(json)).toEqual(payload);
    expect(opts.vapidDetails).toEqual({
      subject: 'mailto:admin@yodips.dev',
      publicKey: 'pub',
      privateKey: 'priv',
    });
    expect(opts.timeout).toBe(10_000);
    expect(opts.agent).toBeDefined();
    expect(opts.agent.options.lookup).toBeInstanceOf(Function);
    expect(opts.agent.options.autoSelectFamily).toBe(false);
    // NOTE: toBeTypeOf('function') rather than toBeInstanceOf(Function) —
    // Agent#destroy is a node:https host-realm builtin, so `instanceof`
    // against jest's sandbox Function is false (cross-realm); a type check
    // is realm-independent and asserts the same contract.
    expect(typeof opts.agent.destroy).toBe('function');
  });

  it('destroys the pinned agent after every send (no retained sockets)', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const destroySpy = jest.fn();
    // Capture the agent web-push receives and spy its destroy().
    const realSend = sendNotification.getMockImplementation();
    let seenAgent: { destroy: jest.Mock } | undefined;
    sendNotification.mockImplementation(async (...args: unknown[]) => {
      const opts = args[2] as { agent: { destroy: () => void } };
      seenAgent = { destroy: jest.fn(opts.agent.destroy.bind(opts.agent)) };
      opts.agent.destroy = seenAgent.destroy;
      return realSend ? realSend(...args) : { statusCode: 201 };
    });

    await svc.send([SUB, { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/def' }], {
      title: 't', body: 'b', collapseKey: 'c', data: {},
    }, BUDGET(10));

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(seenAgent).toBeDefined();
    expect(seenAgent!.destroy).toHaveBeenCalled();
  });

  it('drops subscriptions whose endpoint DNS is not public before sending', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const good = { ...SUB };
    const bad: WebSubscriptionRecord = {
      endpoint: 'https://private.local/x',
      p256dh: 'p',
      auth: 'a',
    };
    const { invalid } = await svc.send([good, bad], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    }, BUDGET(10));
    expect(invalid).toEqual([bad]); // pruned like a 410
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('drops subscriptions whose endpoint fails shape re-check', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const rawIp: WebSubscriptionRecord = {
      endpoint: 'https://127.0.0.1/x',
      p256dh: 'p',
      auth: 'a',
    };
    const { invalid } = await svc.send([rawIp], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    }, BUDGET(10));
    expect(invalid).toEqual([rawIp]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('invalid subscription (statusCode 410/404) -> masuk daftar invalid', async () => {
    const svc = makeService();
    sendNotification.mockRejectedValue({ statusCode: 410 });
    const { invalid } = await svc.send([SUB], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    }, BUDGET(10));
    expect(invalid).toEqual([SUB]);

    sendNotification.mockRejectedValue(new Error('boom')); // non-410 -> tidak invalid
    const { invalid: invalid2 } = await svc.send([SUB], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    }, BUDGET(10));
    expect(invalid2).toEqual([]);
  });

  it('budget: aggregate across MULTIPLE send() calls with one shared budget never exceeds max', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const sub = (i: number): WebSubscriptionRecord => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
      p256dh: 'p',
      auth: 'a',
    });
    const budget = BUDGET(50); // ONE shared cycle budget
    const payload = { title: 't', body: 'b', collapseKey: 'c', data: {} };

    // 20 + 20 + 20 across three events/deliveries in one cycle
    await svc.send(Array.from({ length: 20 }, (_, i) => sub(i)), payload, budget);
    await svc.send(Array.from({ length: 20 }, (_, i) => sub(100 + i)), payload, budget);
    const { invalid } = await svc.send(Array.from({ length: 20 }, (_, i) => sub(200 + i)), payload, budget);

    expect(invalid).toEqual([]); // over-budget subs are best-effort DROPPED for this cycle:
    // not invalid (kept in the store), not queued for retry — see the HONEST
    // BUDGET SEMANTICS comment in web-push.service.ts.
    expect(sendNotification).toHaveBeenCalledTimes(50); // 20 + 20 + 10 = global cap
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it('over-budget subscriptions are silently dropped: not invalid, not marked for removal', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const sub = (i: number): WebSubscriptionRecord => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
      p256dh: 'p',
      auth: 'a',
    });
    const budget = BUDGET(2);
    // 5 subs against a 2-slot budget: exactly 2 network sends, the other 3 are
    // dropped for this cycle but reported as VALID (the poller must keep them).
    const { invalid } = await svc.send(
      Array.from({ length: 5 }, (_, i) => sub(i)),
      { title: 't', body: 'b', collapseKey: 'c', data: {} },
      budget,
    );
    expect(invalid).toEqual([]); // dropped != invalid: poller keeps + retries nothing
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(0);
  });

  it('exhausted budget sends nothing (no reset per call)', async () => {
    const svc = makeService();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const budget = BUDGET(1);
    await svc.send([SUB], { title: 't', body: 'b', collapseKey: 'c', data: {} }, budget);
    sendNotification.mockClear();
    await svc.send([SUB], { title: 't', body: 'b', collapseKey: 'c', data: {} }, budget);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('send saat disabled atau no subscriptions -> invalid kosong, tanpa call', async () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const svc = new WebPushService(config);
    svc.onModuleInit();
    const { invalid } = await svc.send([], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: {},
    }, BUDGET(10));
    expect(invalid).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
