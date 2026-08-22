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
  const session = {
    get: async () => ({ identity: 'u1', ssoCookie: 's', microsoftCookie: '', kulonCookie: 'k', siapCookie: 'si', capturedAt: 0 }),
  };
  const kulon = { getAllAssignments: async (): Promise<KulonAssignment[]> => [] };
  const siap = { getJadwal: async (): Promise<SiapJadwal[]> => [] };
  const probe = { fetchSesskeyOrThrow: async () => 'sesskey' };
  const sent: Array<{ tokens: string[]; title: string }> = [];
  const fcm = {
    configured: true,
    sendEach: async (tokens: string[], msg: { title: string }) => {
      sent.push({ tokens, title: msg.title });
      return { invalidTokens: [] };
    },
  };
  const poller = new NotificationsPoller(
    store,
    session as any,
    kulon as any,
    siap as any,
    probe as any,
    fcm as any,
    { get: () => undefined } as any, // ConfigService — tak dipakai runCycle
    {} as any,                       // SchedulerRegistry — tak dipakai runCycle
  );
  return { store, session, kulon, siap, probe, sent, fcm, poller };
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
    f.probe.fetchSesskeyOrThrow = async () => {
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
    f.probe.fetchSesskeyOrThrow = async () => {
      throw new HttpException({ message: 'expired' }, HttpStatus.UNAUTHORIZED);
    };
    await f.store.addDeviceToken('u1', 'tok');
    await f.poller.runCycle(NOW);

    f.probe.fetchSesskeyOrThrow = async () => 'sesskey';
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
});
