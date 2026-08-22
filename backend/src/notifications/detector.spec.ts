import {
  detectNewAssignments,
  findDueSoon,
  detectReschedules,
} from './detector';
import { KulonAssignment } from '../kulon/kulon.service';
import { SiapJadwal } from '../siap/siap.service';

const NOW = 1_756_000_000_000;

const A = (over: Partial<KulonAssignment> = {}): KulonAssignment => ({
  id: 1,
  name: 'Tugas 1',
  module: 'assign',
  eventType: 'due',
  duedate: Math.floor(NOW / 1000) + 3600,
  overdue: false,
  course: 'Pemrograman Web Lanjut',
  courseId: 10,
  assignmentId: 100,
  courseModuleId: 1000,
  submissionStatus: 'not_submitted',
  ...over,
});

const J = (over: Partial<SiapJadwal> = {}): SiapJadwal => ({
  kode: 'MIK1624503',
  hari: 'Senin',
  matakuliah: 'Pembelajaran Mesin',
  ruang: 'A301',
  waktu: '09:40',
  sks: 3,
  tanggal: '2026-08-17',
  ...over,
});

describe('detectNewAssignments', () => {
  it('baseline (snapshot null) -> tanpa notifikasi, snapshotValid', () => {
    const r = detectNewAssignments(null, [A()]);
    expect(r.events).toEqual([]);
    expect(r.snapshotValid).toBe(true);
  });

  it('tugas baru terdeteksi; yang lama tidak dikirim ulang', () => {
    const prev = [A({ id: 1 }), A({ id: 2 })];
    const curr = [A({ id: 1 }), A({ id: 2 }), A({ id: 3, name: 'Quiz 2' })];
    const r = detectNewAssignments(prev, curr);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: 'new_task', id: 3, name: 'Quiz 2' });
    expect(r.snapshotValid).toBe(true);
  });

  it('fetch kosong padahal snapshot isi -> curiga, snapshot dipertahankan', () => {
    const r = detectNewAssignments([A({ id: 1 }), A({ id: 2 })], []);
    expect(r.events).toEqual([]);
    expect(r.snapshotValid).toBe(false);
  });

  it('mass-drop >=50% id hilang sekaligus -> curiga', () => {
    const prev = [A({ id: 1 }), A({ id: 2 }), A({ id: 3 }), A({ id: 4 })];
    const r = detectNewAssignments(prev, [A({ id: 1 })]); // 75% hilang
    expect(r.events).toEqual([]);
    expect(r.snapshotValid).toBe(false);
  });

  it('drop <50% valid; tugas benar-benar baru tetap dinotifikasikan', () => {
    const prev = [A({ id: 1 }), A({ id: 2 }), A({ id: 3 }), A({ id: 4 })];
    const curr = [A({ id: 1 }), A({ id: 2 }), A({ id: 3 }), A({ id: 5 })];
    const r = detectNewAssignments(prev, curr);
    expect(r.snapshotValid).toBe(true);
    expect(r.events.map((e) => e.id)).toEqual([5]);
  });
});

describe('findDueSoon', () => {
  const inWindow = Math.floor(NOW / 1000) + 3600;

  it('tugas belum dikumpulkan dgn due <=24 jam jadi kandidat', () => {
    const r = findDueSoon([A({ id: 7, duedate: inWindow })], NOW, []);
    expect(r.events).toHaveLength(1);
    expect(r.newKeys).toEqual([`7:${inWindow}`]);
  });

  it('submitted/graded dikecualikan; undefined/unknown termasuk', () => {
    const r = findDueSoon(
      [
        A({ id: 1, submissionStatus: 'submitted' }),
        A({ id: 2, submissionStatus: 'graded' }),
        A({ id: 3, submissionStatus: undefined }),
        A({ id: 4, submissionStatus: 'unknown' }),
      ],
      NOW,
      [],
    );
    expect(r.events.map((e) => e.id)).toEqual([3, 4]);
  });

  it('duedate 0 / lewat / >24 jam diabaikan; tepat 24 jam termasuk', () => {
    const r = findDueSoon(
      [
        A({ id: 1, duedate: 0 }),
        A({ id: 2, duedate: Math.floor(NOW / 1000) - 60 }),
        A({ id: 3, duedate: Math.floor(NOW / 1000) + 25 * 3600 }),
        A({ id: 4, duedate: Math.floor(NOW / 1000) + 24 * 3600 }),
      ],
      NOW,
      [],
    );
    expect(r.events.map((e) => e.id)).toEqual([4]);
  });

  it('dedup: kunci sama tak dikirim ulang; deadline diperpanjang re-arm', () => {
    const first = findDueSoon([A({ id: 7, duedate: inWindow })], NOW, []);
    const second = findDueSoon([A({ id: 7, duedate: inWindow })], NOW, first.newKeys);
    expect(second.events).toEqual([]);
    const extended = Math.floor(NOW / 1000) + 7200;
    const third = findDueSoon([A({ id: 7, duedate: extended })], NOW, first.newKeys);
    expect(third.events).toHaveLength(1);
  });

  it('window custom menggantikan default 24 jam', () => {
    const far = Math.floor(NOW / 1000) + 72 * 3600;
    const r = findDueSoon([A({ id: 9, duedate: far })], NOW, [], 96 * 3600 * 1000);
    expect(r.events).toHaveLength(1);
  });
});

describe('detectReschedules', () => {
  it('baseline null -> tanpa notifikasi', () => {
    const r = detectReschedules(null, [J()], []);
    expect(r.events).toEqual([]);
    expect(r.snapshotValid).toBe(true);
  });

  it('pindah tanggal/jam/ruang dipasangkan sort-by-(tanggal,waktu)', () => {
    const prev = [J(), J({ tanggal: '2026-08-24', ruang: 'B201' })];
    const curr = [J({ tanggal: '2026-08-19' }), J({ tanggal: '2026-08-26', ruang: 'C302' })];
    const r = detectReschedules(prev, curr, []);
    expect(r.events).toHaveLength(1);
    const ev = r.events[0] as Extract<typeof r.events[0], { kind: 'reschedule' }>;
    expect(ev.changes).toEqual([
      {
        before: { tanggal: '2026-08-17', waktu: '09:40', ruang: 'A301' },
        after: { tanggal: '2026-08-19', waktu: '09:40', ruang: 'A301' },
      },
      {
        before: { tanggal: '2026-08-24', waktu: '09:40', ruang: 'B201' },
        after: { tanggal: '2026-08-26', waktu: '09:40', ruang: 'C302' },
      },
    ]);
    expect(r.fingerprints).toHaveLength(1);
  });

  it('fingerprint sama tak dikirim ulang; perubahan baru tetap terkirim', () => {
    const first = detectReschedules([J()], [J({ tanggal: '2026-08-19' })], []);
    expect(first.events).toHaveLength(1);
    const second = detectReschedules(
      [J()],
      [J({ tanggal: '2026-08-19' })],
      first.fingerprints,
    );
    expect(second.events).toEqual([]);
    const third = detectReschedules(
      [J({ tanggal: '2026-08-19' })],
      [J({ tanggal: '2026-08-20' })],
      second.fingerprints,
    );
    expect(third.events).toHaveLength(1);
  });

  it('pertemuan baru/hilang (tak berimbang) TIDAK dinotifikasikan', () => {
    const prev = [J(), J({ tanggal: '2026-08-24' })];
    const curr = [J({ tanggal: '2026-08-19' }), J(), J({ tanggal: '2026-09-01' })];
    const r = detectReschedules(prev, curr, []);
    expect(r.events).toEqual([]);
  });

  it('matkul lain yang tak berubah tidak ikut terbangun event', () => {
    const other = { kode: 'MIK1624501', matakuliah: 'Komputasi' };
    const prev = [J(), J({ ...other, tanggal: '2026-08-18' })];
    const curr = [J({ tanggal: '2026-08-19' }), J({ ...other, tanggal: '2026-08-18' })];
    const r = detectReschedules(prev, curr, []);
    expect(r.events).toHaveLength(1);
    expect((r.events[0] as any).matkulKey).toBe('MIK1624503');
  });

  it('guard: curr kosong vs snapshot isi -> snapshotValid false', () => {
    const r = detectReschedules([J()], [], []);
    expect(r.snapshotValid).toBe(false);
    expect(r.events).toEqual([]);
  });
});
