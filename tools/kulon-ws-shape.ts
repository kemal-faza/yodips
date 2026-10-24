/**
 * Pembentuk murni untuk probe web-service Kulon.
 * Fixture-in, result-out: tanpa fetch, env, maupun filesystem.
 */

export interface BatchEntry {
  index: number;
  methodname: string;
  args: Record<string, unknown>;
}

export type BatchOutcome =
  | { shape: 'positional'; results: unknown[] }
  | { shape: 'keyed'; results: unknown[] }
  | { shape: 'shape-unknown'; reason: string };

export function mapBatchResponse(body: unknown, expectedCount: number): BatchOutcome {
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
    return { shape: 'shape-unknown', reason: 'expectedCount harus bilangan bulat > 0' };
  }
  if (Array.isArray(body)) {
    if (body.length !== expectedCount) {
      return { shape: 'shape-unknown', reason: 'panjang array ' + body.length + ' != ' + expectedCount };
    }
    return { shape: 'positional', results: body };
  }
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const results: unknown[] = [];
    for (let i = 0; i < expectedCount; i += 1) {
      const key = String(i);
      if (!(key in record)) {
        return { shape: 'shape-unknown', reason: 'kunci ' + key + ' tidak ada' };
      }
      results.push(record[key]);
    }
    return { shape: 'keyed', results };
  }
  return { shape: 'shape-unknown', reason: 'body bukan object' };
}

export interface EntryError {
  error: boolean;
  errorcode: string | null;
  message: string | null;
}

export interface DiagnosticEntry {
  methodname: string;
  error: boolean;
  errorcode: string | null;
  message: string | null;
  /** Kode HTTP untuk panggilan REST; tidak diisi untuk AJAX batch. */
  status?: number;
}

export interface SpotCheckRow {
  courseId: number;
  cmid: number;
  name: string;
  duedate: string;
}

export function readEntryError(result: unknown): EntryError {
  const record = result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const exception =
    record.exception !== null && typeof record.exception === 'object'
      ? (record.exception as Record<string, unknown>)
      : {};
  const errorcode = typeof record.errorcode === 'string' ? record.errorcode : null;
  let message: string | null = null;
  if (typeof exception.message === 'string') message = exception.message;
  else if (typeof record.message === 'string') message = record.message;
  return { error: record.error === true, errorcode, message };
}

interface HrefId {
  href: string;
  id: number;
}

function hrefIds(html: string): HrefId[] {
  const ids: HrefId[] = [];
  const pattern = /href="([^"]*view\.php\?[^"]*?\bid=(\d+)[^"]*)"/g;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match !== null) {
    ids.push({ href: match[1], id: Number(match[2]) });
    match = pattern.exec(html);
  }
  return ids;
}

function isModuleHref(href: string, kind: 'assign' | 'quiz'): boolean {
  const queryIndex = href.indexOf('?');
  const path = queryIndex === -1 ? href : href.slice(0, queryIndex);
  if (path === 'view.php') return true;
  return path.endsWith('/mod/' + kind + '/view.php');
}

export function extractCmidSet(html: string, kind: 'assign' | 'quiz'): number[] {
  const found = new Set<number>();
  for (const entry of hrefIds(html)) {
    if (isModuleHref(entry.href, kind)) found.add(entry.id);
  }
  return Array.from(found).sort((a, b) => a - b);
}

export function diffSets(left: number[], right: number[]): { onlyLeft: number[]; onlyRight: number[] } {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    onlyLeft: left.filter((n) => !rightSet.has(n)),
    onlyRight: right.filter((n) => !leftSet.has(n)),
  };
}
