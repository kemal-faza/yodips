import { NotifEvent, ReschedulePair } from './detector';

export interface PushCopy {
  title: string;
  body: string;
  collapseKey: string;
  data: Record<string, string>;
}

const fmtDate = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' });
const fmtTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDueDate(dueAtSec: number): string {
  const d = new Date(dueAtSec * 1000);
  return `${fmtDate.format(d)} ${fmtTime.format(d)}`.replace(':', '.');
}

const slotLabel = (s: { tanggal: string; waktu: string; ruang: string }) =>
  `${s.tanggal} ${s.waktu}${s.ruang ? ` ${s.ruang}` : ''}`;

const pairLabel = (c: ReschedulePair) =>
  `${slotLabel(c.before)} ke ${slotLabel(c.after)}`;

export function eventToPush(e: NotifEvent): PushCopy {
  switch (e.kind) {
    case 'new_task': {
      const due = e.dueAtSec > 0 ? ` · due ${formatDueDate(e.dueAtSec)}` : '';
      return {
        title: 'Tugas baru',
        body: `${e.name} · ${e.course}${due}`,
        collapseKey: 'new_task',
        data: { type: 'new_task', target: 'tasks', payload: JSON.stringify({ id: e.id }) },
      };
    }
    case 'reschedule':
      return {
        title: 'Jadwal berubah',
        body: `${e.matkul}: ${e.changes.map(pairLabel).join(', ')}`,
        collapseKey: 'reschedule',
        data: {
          type: 'reschedule',
          target: 'schedule',
          payload: JSON.stringify({ matkulKey: e.matkulKey }),
        },
      };
    case 'deadline_reached':
      return {
        title: 'Deadline 24 jam',
        body: `${e.name} · due ${formatDueDate(e.dueAtSec)}`,
        collapseKey: 'deadline',
        data: {
          type: 'deadline_reached',
          target: 'tasks',
          payload: JSON.stringify({ id: e.id }),
        },
      };
  }
}
