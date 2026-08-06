const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HOUR = 3600;
const DAY = 86400;
const THIRTY_DAYS = 30 * DAY;

/** Relative Indonesian deadline label: "5 menit lagi", "3 jam lalu", "besok", "5 hari lagi", "3 hari lalu", else "12 Des 2026". Missing deadline → "Tanpa deadline". */
export function formatRelativeDate(duedateSec: number, nowMs?: number): string {
  if (!duedateSec || duedateSec <= 0) return 'Tanpa deadline';
  const now = nowMs ?? Date.now();
  const diffSec = Math.round(duedateSec * 1000 - now) / 1000;
  const abs = Math.abs(diffSec);
  const future = diffSec >= 0;

  if (abs < HOUR) {
    const m = Math.max(1, Math.floor(abs / 60));
    return future ? `${m} menit lagi` : `${m} menit lalu`;
  }
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    return future ? `${h} jam lagi` : `${h} jam lalu`;
  }
  if (abs < THIRTY_DAYS) {
    const d = Math.floor(abs / DAY);
    if (d === 0) return future ? 'hari ini' : 'hari ini';
    if (d === 1) return future ? 'besok' : 'kemarin';
    return future ? `${d} hari lagi` : `${d} hari lalu`;
  }
  const dt = new Date(duedateSec * 1000);
  return `${dt.getDate()} ${ID_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
