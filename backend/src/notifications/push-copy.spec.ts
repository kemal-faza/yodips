import { eventToPush, formatDueDate } from './push-copy';

describe('eventToPush', () => {
  it('new_task: collapseKey/target/data benar', () => {
    const p = eventToPush({
      kind: 'new_task', id: 5, course: 'PWL', name: 'Quiz 2', module: 'quiz', dueAtSec: 1756000000,
    });
    expect(p.collapseKey).toBe('new_task');
    expect(p.title).toBe('Tugas baru');
    expect(p.body).toContain('Quiz 2');
    // Deadline 1756000000 = 2025-08-24T01:46:40Z = 24 Agu 08.46 WIB.
    expect(p.body).toContain('due 24 Agu 08.46');
    expect(p.data['type']).toBe('new_task');
    expect(p.data['target']).toBe('tasks');
  });

  it('reschedule: body memuat matkul + pasangan before/after', () => {
    const p = eventToPush({
      kind: 'reschedule', matkulKey: 'MIK1', matkul: 'Pembelajaran Mesin',
      changes: [{
        before: { tanggal: '2026-08-17', waktu: '09:40', ruang: 'A301' },
        after: { tanggal: '2026-08-19', waktu: '09:40', ruang: 'A301' },
      }],
    });
    expect(p.title).toBe('Jadwal berubah');
    expect(p.body).toContain('Pembelajaran Mesin');
    expect(p.body).toContain('2026-08-17');
    expect(p.body).toContain('2026-08-19');
    expect(p.data['target']).toBe('schedule');
  });

  it('deadline_reached memuat nama tugas + due', () => {
    const p = eventToPush({
      kind: 'deadline_reached', id: 9, course: 'PWL', name: 'Laporan IRS', dueAtSec: 1756000000,
    });
    expect(p.title).toBe('Deadline 24 jam');
    expect(p.body).toContain('Laporan IRS');
    expect(p.body).toContain('due 24 Agu 08.46');
    expect(p.data['type']).toBe('deadline_reached');
  });

  it('formatDueDate berbentuk "DD MMM HH.MM" dalam WIB, bukan TZ server', () => {
    expect(formatDueDate(1756072500)).toMatch(/^\d{1,2} \w{3} \d{2}\.\d{2}$/);
    // 2025-08-24T21:55:00Z = 25 Agu 04.55 WIB; di server UTC tampil 24 Agu 21.55.
    expect(formatDueDate(1756072500)).toBe('25 Agu 04.55');
  });
});
