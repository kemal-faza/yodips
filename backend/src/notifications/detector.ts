import { createHash } from 'crypto';
import { KulonAssignment } from '../kulon/kulon.service';
import { SiapJadwal } from '../siap/siap.service';

/** Event layak-push hasil deteksi (pure data, tanpa I/O). */
export type NotifEvent =
  | {
      kind: 'new_task';
      id: number;
      course: string;
      name: string;
      module: string;
      dueAtSec: number;
    }
  | {
      kind: 'deadline_reached';
      id: number;
      course: string;
      name: string;
      dueAtSec: number;
    }
  | {
      kind: 'reschedule';
      matkulKey: string;
      matkul: string;
      changes: ReschedulePair[];
    };

export interface ReschedulePair {
  before: JadwalSlot;
  after: JadwalSlot;
}

export interface JadwalSlot {
  tanggal: string;
  waktu: string;
  ruang: string;
}

export interface SnapshotOutcome<T> {
  events: T[];
  /** false = fetch tampak rusak vs snapshot; pemanggil WAJIB mempertahankan snapshot lama. */
  snapshotValid: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guard anti false-positive: total kosong ATAU >=50% isi snapshot hilang sekaligus. */
function snapshotSuspect(prevCount: number, currCount: number): boolean {
  if (prevCount > 0 && currCount === 0) return true;
  if (prevCount > 0 && currCount * 2 <= prevCount) return true;
  return false;
}

export function detectNewAssignments(
  prevSnapshot: KulonAssignment[] | null,
  curr: KulonAssignment[],
): SnapshotOutcome<NotifEvent> {
  if (prevSnapshot === null) return { events: [], snapshotValid: true }; // baseline
  if (snapshotSuspect(prevSnapshot.length, curr.length)) {
    return { events: [], snapshotValid: false };
  }
  const prevIds = new Set(prevSnapshot.map((a) => a.id));
  const events: NotifEvent[] = curr
    .filter((a) => !prevIds.has(a.id))
    .map((a) => ({
      kind: 'new_task' as const,
      id: a.id,
      course: a.course,
      name: a.name,
      module: a.module,
      dueAtSec: a.duedate,
    }));
  return { events, snapshotValid: true };
}

export function findDueSoon(
  assignments: KulonAssignment[],
  nowMs: number,
  sentKeys: Iterable<string>,
  windowMs: number = DAY_MS,
): { events: NotifEvent[]; newKeys: string[] } {
  const sent = new Set(sentKeys);
  const events: NotifEvent[] = [];
  for (const a of assignments) {
    // Quiz rows ('unknown'/undefined status) tetap kandidat — index quiz Kulon
    // tidak mengekspos attempts; konsisten dengan bucket "Perlu" di app.
    if (a.submissionStatus === 'submitted' || a.submissionStatus === 'graded') {
      continue;
    }
    const dueMs = a.duedate * 1000;
    if (!(dueMs > nowMs)) continue; // duedate=0 atau sudah lewat
    if (dueMs - nowMs > windowMs) continue;
    const key = `${a.id}:${a.duedate}`;
    if (sent.has(key)) continue;
    sent.add(key);
    events.push({
      kind: 'deadline_reached',
      id: a.id,
      course: a.course,
      name: a.name,
      dueAtSec: a.duedate,
    });
  }
  return { events, newKeys: [...sent] };
}

const slotOf = (j: SiapJadwal): JadwalSlot => ({
  // tanggal/waktu opsional di interface SIAP — normalisasi ke '' agar slotKey
  // tidak pernah memuat "undefined".
  tanggal: j.tanggal ?? '',
  waktu: j.waktu ?? '',
  ruang: j.ruang ?? '',
});
const slotKeyOf = (s: JadwalSlot) => `${s.tanggal}|${s.waktu}|${s.ruang}`;
const matkulKeyOf = (j: SiapJadwal) => j.kode || j.matakuliah;

function tallySlots(list: SiapJadwal[]) {
  const m = new Map<string, { slot: JadwalSlot; n: number }>();
  for (const item of list) {
    const s = slotOf(item);
    const k = slotKeyOf(s);
    const e = m.get(k);
    if (e) e.n += 1;
    else m.set(k, { slot: s, n: 1 });
  }
  return m;
}

/** Multiset diff slot: removed = ada di prev tak tertutup curr; added = kebalikannya. */
function multisetDiffSlots(prev: SiapJadwal[], curr: SiapJadwal[]) {
  const diff = (a: SiapJadwal[], b: SiapJadwal[]) => {
    const ma = tallySlots(a);
    const mb = tallySlots(b);
    const out: JadwalSlot[] = [];
    for (const [k, e] of ma) {
      const n = e.n - (mb.get(k)?.n ?? 0);
      for (let i = 0; i < n; i++) out.push(e.slot);
    }
    return out;
  };
  return { removed: diff(prev, curr), added: diff(curr, prev) };
}

const sortByDateTime = (slots: JadwalSlot[]) =>
  [...slots].sort((a, b) =>
    `${a.tanggal}${a.waktu}`.localeCompare(`${b.tanggal}${b.waktu}`),
  );

function fingerprintFor(matkulKey: string, changes: ReschedulePair[]): string {
  return createHash('sha256')
    .update(`${matkulKey}::${JSON.stringify(changes)}`)
    .digest('hex');
}

export function detectReschedules(
  prevSnapshot: SiapJadwal[] | null,
  curr: SiapJadwal[],
  seenFingerprints: Iterable<string>,
): {
  events: NotifEvent[];
  fingerprints: string[];
  snapshotValid: boolean;
} {
  const fingerprints = [...seenFingerprints];
  if (prevSnapshot === null) {
    return { events: [], fingerprints, snapshotValid: true }; // baseline
  }
  if (snapshotSuspect(prevSnapshot.length, curr.length)) {
    return { events: [], fingerprints, snapshotValid: false };
  }
  const groupByMatkul = (list: SiapJadwal[]) => {
    const m = new Map<string, SiapJadwal[]>();
    for (const j of list) {
      const k = matkulKeyOf(j);
      const arr = m.get(k);
      if (arr) arr.push(j);
      else m.set(k, [j]);
    }
    return m;
  };
  const prevBy = groupByMatkul(prevSnapshot);
  const currBy = groupByMatkul(curr);
  const seen = new Set(seenFingerprints);
  const events: NotifEvent[] = [];
  for (const [key, prevList] of prevBy) {
    const currList = currBy.get(key);
    if (!currList) continue; // matkul hilang seluruhnya -> bukan reschedule v1
    const { removed, added } = multisetDiffSlots(prevList, currList);
    if (removed.length === 0 || added.length !== removed.length) continue;
    const remSorted = sortByDateTime(removed);
    const addSorted = sortByDateTime(added);
    const changes: ReschedulePair[] = remSorted.map((before, i) => ({
      before,
      after: addSorted[i],
    }));
    const fp = fingerprintFor(key, changes);
    if (seen.has(fp)) continue;
    seen.add(fp);
    fingerprints.push(fp);
    events.push({
      kind: 'reschedule',
      matkulKey: key,
      matkul: prevList[0]?.matakuliah ?? key,
      changes,
    });
  }
  return { events, fingerprints, snapshotValid: true };
}
