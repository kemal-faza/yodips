export function pageWindow(current: number, total: number, side = 1): (number | '…')[] {
  if (total <= 0) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  // Current is wedged against the leading edge — no distinct window to show.
  if (current - side <= 1) return [1, '…', total];
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - side);
  const end = Math.min(total - 1, current + side);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

/** Ukuran halaman daftar tugas mobile (mirror TASK_PAGE_SIZE TasksScreen.kt). */
export const TASK_PAGE_SIZE = 15;

/**
 * Slice satu halaman dari list TERURUT; `remaining` untuk footer
 * "Muat lebih banyak". Murni agar paginasi mudah dites (paritas Kotlin).
 */
export function pagedTasks<T>(list: T[], showCount: number): { page: T[]; remaining: number } {
  const safe = Math.max(0, Math.floor(showCount));
  const page = list.slice(0, safe);
  return { page, remaining: list.length - page.length };
}