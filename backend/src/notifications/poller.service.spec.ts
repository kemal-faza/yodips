import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { NotificationsPoller } from './poller.service';
import { InMemoryNotificationStore } from './notification-store';
import { KulonAssignment } from '../kulon/kulon.service';
import { SiapJadwal } from '../siap/siap.service';
const NOW = 1_756_000_000_000;
// Di luar jendela deadline 24 jam — dipakai test yang BUKAN tentang deadline
// agar findDueSoon tidak menambah push "Deadline 24 jam" ke f.sent.
const DUE_FAR_SEC = Math.floor(NOW / 1000) + 72 * 3600;

const A = (id: number, over: Partial<KulonAssignment> = {}): KulonAssignment => ({
  id,
  name: `Tugas ${id}`,
  module: 'assign',
  eventType: 'due',
  duedate: Math.floor(NOW / 1000) + 3600,
  overdue: false,
  course: 'PWL',
  courseId: 10,
  assignmentId: 100 + id,
  courseModuleId: 1000 + id,
  submissionStatus: 'not_submitted',
  ...over,
});

const J = (tanggal: string): SiapJadwal => ({
  kode: 'MIK1', hari: 'Senin', matakuliah: 'PM', ruang: 'A301', waktu: '09:40', sks: 3, tanggal,
});

function makeFakes() {
  const store = new InMemoryNotificationStore(() => NOW);
  const kulon = { getAllAssignments: async (): Promise<KulonAssignment[]> => [] };
  const siap = { getJadwal: async (): Promise<SiapJadwal[]> => [] };
  const sent: Array<{ tokens: string[]; title: string }> = [];
  const fcm = {
    configured: true,
    sendEach: async (tokens: string[], msg: { title: string }) => {
      sent.push({ tokens, title: msg.title });
      return { invalidTokens: [] };
    },
  };
  const webSent: Array<{ subs: unknown[]; title: string }> = [];
  const webPush = {
    configured: false,
    publicKey: '',
    send: async (subs: unknown[], msg: { title: string }) => {
      webSent.push({ subs, title: msg.title });
      return { invalid: [] };
    },
  };
  const poller = new NotificationsPoller(
    store,
    kulon as any,
    siap as any,
    fcm as any,
    webPush as any,
    { get: () => undefined } as any, // ConfigService — tak dipakai runCycle
    {} as any,                       // SchedulerRegistry — tak dipakai runCycle
  );
  return { store, kulon, siap, sent, fcm, webSent, webPush, poller };
}

describe('NotificationsPoller.runCycle', () => {
  let mathRandom: jest.SpyInstance;
  beforeEach(() => {
    mathRandom = jest.spyOn(global.Math, 'random').mockReturnValue(0); // jitter 0
  });
  afterEach(() => mathRandom.mockRestore());

  it('baseline pertama: tanpa push, snapshot tersimpan', async () => {
    const f = makeFakes();
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    f.siap.getJadwal = async () => [J('2026-08-17')];
    await f.store.addDeviceToken('u1', 'tok');

    const sum = await f.poller.runCycle(NOW);

    expect(sum.usersChecked).toBe(1);
    expect(sum.pushesSent).toBe(0);
    expect(f.sent).toHaveLength(0);
    expect(await f.store.getSnapshot('u1', 'assignments')).toHaveLength(1);
    expect(await f.store.getSnapshot('u1', 'jadwal')).toHaveLength(1);
  });

  it('tugas baru -> push new_task', async () => {
    const f = makeFakes();
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    await f.store.addDeviceToken('u1', 'tok');
    await f.poller.runCycle(NOW);

    f.kulon.getAllAssignments = async () => [
      A(1, { duedate: DUE_FAR_SEC }),
      A(2, { duedate: DUE_FAR_SEC }),
    ];
    const sum = await f.poller.runCycle(NOW);

    expect(sum.pushesSent).toBe(1);
    expect(f.sent[0]).toMatchObject({ title: 'Tugas baru', tokens: ['tok'] });
  });

  it('sesi stale -> push re-login SEKALI; siklus berikut tidak dobel', async () => {
    const f = makeFakes();
    f.kulon.getAllAssignments = async () => {
      throw new HttpException({ message: 'expired' }, HttpStatus.UNAUTHORIZED);
    };
    await f.store.addDeviceToken('u1', 'tok');

    await f.poller.runCycle(NOW);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].title).toBe('Sesi berakhir');
    expect(await f.store.getReloginFlagged('u1')).toBe(true);

    await f.poller.runCycle(NOW);
    expect(f.sent).toHaveLength(1);
  });

  it('sesi pulih -> flag direset', async () => {
    const f = makeFakes();
    f.kulon.getAllAssignments = async () => {
      throw new HttpException({ message: 'expired' }, HttpStatus.UNAUTHORIZED);
    };
    await f.store.addDeviceToken('u1', 'tok');
    await f.poller.runCycle(NOW);

    f.kulon.getAllAssignments = async () => [A(1)];
    await f.poller.runCycle(NOW);

    expect(await f.store.getReloginFlagged('u1')).toBe(false);
  });

  it('upstream error non-stale -> skip diam, snapshot lama tak tersentuh', async () => {
    const f = makeFakes();
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    await f.store.addDeviceToken('u1', 'tok');
    await f.poller.runCycle(NOW);

    f.kulon.getAllAssignments = async () => {
      throw new HttpException({ message: 'boom' }, HttpStatus.BAD_GATEWAY);
    };
    const sum = await f.poller.runCycle(NOW);

    expect(sum.pushesSent).toBe(0);
    expect(f.sent).toHaveLength(0);
    expect(await f.store.getSnapshot('u1', 'assignments')).toEqual([A(1, { duedate: DUE_FAR_SEC })]);
  });

  it('upstream skip log is fixed and contains no subject or error details', async () => {
    const f = makeFakes();
    const subject = '12345678901234';
    const secret = new Error('cookie=sia_app_session=SECRET nim=12345678901234');
    const warn = jest
      .spyOn((f.poller as any).logger, 'warn')
      .mockImplementation(() => undefined);
    f.kulon.getAllAssignments = async () => {
      throw secret;
    };
    await f.store.addDeviceToken(subject, 'tok');

    await f.poller.runCycle(NOW);

    expect(warn).toHaveBeenCalledWith('[notification.poll] user_skipped');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(subject);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret.message);
    warn.mockRestore();
  });

  it('reschedule -> push sekali; diff identik tak dikirim ulang', async () => {
    const f = makeFakes();
    f.siap.getJadwal = async () => [J('2026-08-17')];
    await f.store.addDeviceToken('u1', 'tok');
    await f.poller.runCycle(NOW);

    f.siap.getJadwal = async () => [J('2026-08-19')];
    await f.poller.runCycle(NOW);
    expect(f.sent.filter((s) => s.title === 'Jadwal berubah')).toHaveLength(1);

    await f.poller.runCycle(NOW); // snapshot kini sama dgn fetch
    expect(f.sent.filter((s) => s.title === 'Jadwal berubah')).toHaveLength(1);
  });

  it('deadline in-window dipush sekali lalu dedup', async () => {
    const f = makeFakes();
    const soon = Math.floor(NOW / 1000) + 3600;
    f.kulon.getAllAssignments = async () => [A(1, { duedate: soon })];
    await f.store.addDeviceToken('u1', 'tok');

    await f.poller.runCycle(NOW); // baseline + deadline terdeteksi langsung
    expect(f.sent.filter((s) => s.title === 'Deadline 24 jam')).toHaveLength(1);

    await f.poller.runCycle(NOW);
    expect(f.sent.filter((s) => s.title === 'Deadline 24 jam')).toHaveLength(1);
  });

  it('user tanpa token dilewati; token invalid diprune', async () => {
    const f = makeFakes();
    f.kulon.getAllAssignments = async () => [A(1)];

    const none = await f.poller.runCycle(NOW); // belum ada subs
    expect(none.usersChecked).toBe(0);

    await f.store.addDeviceToken('u1', 'bad-tok');
    (f as any).fcm.sendEach = async () => ({ invalidTokens: ['bad-tok'] });
    await f.poller.runCycle(NOW);
    expect(await f.store.getDeviceTokens('u1')).toEqual([]);
    expect(await f.store.listSubsWithTokens()).toEqual([]);
  });

  it('running-flag mencegah overlap', async () => {
    const f = makeFakes();
    f.poller.running = true;
    const sum = await f.poller.runCycle(NOW);
    expect(sum.usersChecked).toBe(0);
    f.poller.running = false;
  });

  it('web-only user (0 FCM token, 1 web sub) TIDAK early-return -> webPush.send dipanggil', async () => {
    const f = makeFakes();
    (f as any).webPush.configured = true;
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    await f.store.addWebSubscription('u1', {
      endpoint: 'https://pusher/abc',
      p256dh: 'pk',
      auth: 'auth',
    });
    await f.poller.runCycle(NOW); // baseline

    f.kulon.getAllAssignments = async () => [
      A(1, { duedate: DUE_FAR_SEC }),
      A(2, { duedate: DUE_FAR_SEC }),
    ];
    const sum = await f.poller.runCycle(NOW);

    expect(sum.usersChecked).toBe(1);
    expect(f.webSent).toHaveLength(1);
    expect(f.webSent[0].subs).toHaveLength(1);
    expect(f.webSent[0].title).toBe('Tugas baru');
    // FCM OK dipanggil namun template kosong (tidak ada token); real impl no-op.
    expect(f.sent[0].tokens).toEqual([]);
  });

  it('user dgn kedua token + web sub -> FCM & web sama-sama terkirim', async () => {
    const f = makeFakes();
    (f as any).webPush.configured = true;
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    await f.store.addDeviceToken('u1', 'tok');
    await f.store.addWebSubscription('u1', {
      endpoint: 'https://pusher/abc',
      p256dh: 'pk',
      auth: 'auth',
    });
    await f.poller.runCycle(NOW); // baseline

    f.kulon.getAllAssignments = async () => [
      A(1, { duedate: DUE_FAR_SEC }),
      A(2, { duedate: DUE_FAR_SEC }),
    ];
    const sum = await f.poller.runCycle(NOW);

    expect(sum.pushesSent).toBe(1);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].tokens).toEqual(['tok']);
    expect(f.webSent).toHaveLength(1);
    expect(f.webSent[0].subs).toHaveLength(1);
  });

  it('invalid web sub (statusCode 410) -> removeWebSubscription dipanggil', async () => {
    const f = makeFakes();
    (f as any).webPush.configured = true;
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    const sub1 = { endpoint: 'https://pusher/bad', p256dh: 'pk', auth: 'auth' };
    const sub2 = { endpoint: 'https://pusher/ok', p256dh: 'pk', auth: 'auth' };
    await f.store.addWebSubscription('u1', sub1);
    await f.store.addWebSubscription('u1', sub2);
    await f.poller.runCycle(NOW); // baseline

    f.kulon.getAllAssignments = async () => [
      A(1, { duedate: DUE_FAR_SEC }),
      A(2, { duedate: DUE_FAR_SEC }),
    ];
    (f as any).webPush.send = async () => ({ invalid: [sub1] });
    await f.poller.runCycle(NOW);

    expect(await f.store.getWebSubscriptions('u1')).toEqual([sub2]);
    expect(await f.store.listSubsWithWeb()).toEqual(['u1']);
  });

  it('web-only user tanpa webPush.configured -> web tidak dikirim (no-op)', async () => {
    const f = makeFakes();
    (f as any).webPush.configured = false;
    f.kulon.getAllAssignments = async () => [A(1, { duedate: DUE_FAR_SEC })];
    await f.store.addWebSubscription('u1', {
      endpoint: 'https://pusher/abc',
      p256dh: 'pk',
      auth: 'auth',
    });
    await f.poller.runCycle(NOW);

    f.kulon.getAllAssignments = async () => [
      A(1, { duedate: DUE_FAR_SEC }),
      A(2, { duedate: DUE_FAR_SEC }),
    ];
    const sum = await f.poller.runCycle(NOW);

    expect(sum.usersChecked).toBe(1);
    expect(f.webSent).toHaveLength(0);
  });
});

describe('NotificationsPoller.onApplicationBootstrap', () => {
  function makeBootstrapPoller(opts: {
    fcmConfigured: boolean;
    webPushConfigured: boolean;
    sched?: { addCronJob: jest.Mock };
  }) {
    const f = makeFakes();
    (f as any).fcm.configured = opts.fcmConfigured;
    (f as any).webPush.configured = opts.webPushConfigured;
    const addCronJob = opts.sched?.addCronJob ?? jest.fn();
    const poller = new NotificationsPoller(
      f.store,
      f.kulon as any,
      f.siap as any,
      f.fcm as any,
      f.webPush as any,
      {
        get: (key: string) =>
          key === 'NOTIFICATIONS_ENABLED' ? true : undefined,
      } as any,
      { addCronJob } as any,
    );
    return { f, addCronJob, poller };
  }

  it('poller mati bila FCM & Web Push sama-sama belum configured', () => {
    const { addCronJob, poller } = makeBootstrapPoller({
      fcmConfigured: false,
      webPushConfigured: false,
    });
    poller.onApplicationBootstrap();
    expect(addCronJob).not.toHaveBeenCalled();
  });

  it('poller mulai bila webPush configured meski FCM tidak', () => {
    const { addCronJob, poller } = makeBootstrapPoller({
      fcmConfigured: false,
      webPushConfigured: true,
    });
    poller.onApplicationBootstrap();
    expect(addCronJob).toHaveBeenCalledTimes(1);
    // hentikan cron real supaya tak ada timer menggantung
    const job = addCronJob.mock.calls[0][1];
    job.stop();
  });

  it('poller mulai bila FCM configured (regresi) — cron dijadwalkan', () => {
    const { addCronJob, poller } = makeBootstrapPoller({
      fcmConfigured: true,
      webPushConfigured: false,
    });
    poller.onApplicationBootstrap();
    expect(addCronJob).toHaveBeenCalledTimes(1);
    const job = addCronJob.mock.calls[0][1];
    job.stop();
  });

  it('outer cycle failure log is fixed and contains no error details', async () => {
    const { addCronJob, poller, f } = makeBootstrapPoller({
      fcmConfigured: true,
      webPushConfigured: false,
    });
    const secret = new Error('cookie=sia_app_session=SECRET nim=12345678901234');
    const error = jest
      .spyOn((poller as any).logger, 'error')
      .mockImplementation(() => undefined);
    f.store.listSubsWithTokens = async () => {
      throw secret;
    };

    poller.onApplicationBootstrap();
    const job = addCronJob.mock.calls[0][1];
    job.stop();
    job.fireOnTick();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(error).toHaveBeenCalledWith('[notification.poll] cycle_failed');
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET');
    expect(JSON.stringify(error.mock.calls)).not.toContain('12345678901234');
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret.message);
    error.mockRestore();
  });
});
