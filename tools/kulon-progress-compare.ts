/**
 * Alat baca-saja: bandingkan nilai 'progress' dari payload batch timeline Kulon
 * dengan progress yang dihitung jalur produksi (core_courseformat_get_state ->
 * fallback /course/view.php -> parseSectionProgress). Cookie hanya dibaca dari
 * env/file dan tidak pernah dicetak atau ditulis ke artefak.
 *
 * Catatan build: parser produksi dimuat saat runtime lewat loadProductionParsers(),
 * bukan import statis. Import relatif ke luar tools/ ikut masuk program tsc,
 * menggeser rootDir ke akar repo, dan memindahkan semua artefak .tmp-test ke
 * .tmp-test/tools/ sehingga jalur test legacy hilang; require hasil kompilasi juga
 * akan menunjuk tools/backend (bukan backend/). Loader ini memakai modul yang sama
 * persis (backend/src/kulon/kulon-parse.ts), tanpa salinan logika parsing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ajaxBatch, fetchHtmlPage, fetchSesskey, type FetchLike } from './kulon-ws-http';
import { mapBatchResponse, readEntryError, type BatchEntry } from './kulon-ws-shape';

const TIMELINE_METHOD = 'core_course_get_enrolled_courses_by_timeline_classification';
const STATE_METHOD = 'core_courseformat_get_state';
const TIMELINE_CLASSIFICATIONS = ['inprogress', 'all', 'hidden'] as const;
const COURSE_CONCURRENCY = 4;
const REPORT_NAME = '2026-10-24-kulon-progress-compare.md';
const DEFAULT_OUT_DIR = resolve(__dirname, '..', 'docs', 'probe');

export type TimelineStatus = 'inprogress' | 'past';
export type RowSource = 'state' | 'html' | 'error';
export type Classification =
  | 'equal'
  | 'past-coerced'
  | 'differ'
  | 'timeline-missing'
  | 'production-missing'
  | 'both-missing'
  | 'scrape-error';

const CLASSIFICATIONS: Classification[] = [
  'equal',
  'past-coerced',
  'differ',
  'timeline-missing',
  'production-missing',
  'both-missing',
  'scrape-error',
];

export interface ComparisonInput {
  courseId: number;
  timelineStatus: TimelineStatus;
  timelineProgress: number | null;
  productionProgress: number | undefined;
  source: RowSource;
  /** true bila objek course timeline punya kunci 'hasprogress' bernilai true. */
  hasProgress: boolean;
}

export interface ComparedRow extends ComparisonInput {
  classification: Classification;
}

export type ClassificationCounts = { [key in Classification]: number };

export interface ProgressSummary {
  total: number;
  counts: ClassificationCounts;
  byStatus: { inprogress: ClassificationCounts; past: ClassificationCounts };
}

export interface CompareDeps {
  fetchImpl: FetchLike;
  env: Record<string, string | undefined>;
  now: () => number;
  writeFile: (path: string, content: string) => void;
}

export interface CompareResult {
  summary: ProgressSummary;
  reportPath: string;
  report: string;
}

export interface CompareProgressResult {
  rows: ComparedRow[];
  summary: ProgressSummary;
}

interface SectionView {
  id: number;
  label: string;
  dateRange?: string;
}

interface CourseContentView {
  sections: SectionView[];
}

interface ProductionParsers {
  mapCourseStateJson: (raw: unknown, courseId: number) => CourseContentView;
  parseContentHtml: (html: string, courseId: number) => CourseContentView;
  parseSectionProgress: (
    sections: SectionView[],
    now?: Date,
    opts?: { isPast?: boolean },
  ) => number | undefined;
}

let cachedParsers: ProductionParsers | null = null;

function productionParserModulePath(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = resolve(dir, 'backend', 'src', 'kulon', 'kulon-parse');
    if (existsSync(candidate + '.ts')) return candidate;
    dir = dirname(dir);
  }
  throw new Error('modul parser produksi tidak ditemukan: backend/src/kulon/kulon-parse.ts');
}

function registerRuntimeTypeScript(): void {
  // ts-node sudah dependency dev tools/ (runner test resmi). Registrasi ini hanya
  // terpakai saat alat dijalankan dari artefak .tmp-test oleh node polos.
  require('ts-node').register({
    transpileOnly: true,
    compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true },
  });
}

/** Muat tiga fungsi parser produksi apa adanya (tanpa salinan logika). */
export function loadProductionParsers(): ProductionParsers {
  if (cachedParsers !== null) return cachedParsers;
  const modulePath = productionParserModulePath();
  let loaded: unknown;
  try {
    loaded = require(modulePath) as unknown;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw error;
    registerRuntimeTypeScript();
    loaded = require(modulePath) as unknown;
  }
  const record = loaded !== null && typeof loaded === 'object' ? (loaded as Record<string, unknown>) : {};
  const candidate = {
    mapCourseStateJson: record.mapCourseStateJson,
    parseContentHtml: record.parseContentHtml,
    parseSectionProgress: record.parseSectionProgress,
  };
  if (
    typeof candidate.mapCourseStateJson !== 'function' ||
    typeof candidate.parseContentHtml !== 'function' ||
    typeof candidate.parseSectionProgress !== 'function'
  ) {
    throw new Error('ekspor parser produksi tidak lengkap di ' + modulePath);
  }
  cachedParsers = candidate as ProductionParsers;
  return cachedParsers;
}

function emptyCounts(): ClassificationCounts {
  return {
    equal: 0,
    'past-coerced': 0,
    differ: 0,
    'timeline-missing': 0,
    'production-missing': 0,
    'both-missing': 0,
    'scrape-error': 0,
  };
}

/**
 * Urutan klasifikasi (eksplisit, deterministik):
 * 1. source 'error' -> scrape-error.
 * 2. timeline null + produksi undefined -> both-missing.
 * 3. timeline null + produksi angka -> timeline-missing.
 * 4. timeline angka + produksi undefined -> production-missing.
 * 5. keduanya angka: sama -> equal (termasuk kursus past yang sama-sama 100).
 * 6. berbeda, kursus past, produksi 100 -> past-coerced (coercion isPast).
 * 7. selain itu -> differ.
 */
function classify(input: ComparisonInput): Classification {
  if (input.source === 'error') return 'scrape-error';
  const timeline = input.timelineProgress;
  const production = input.productionProgress;
  if (timeline === null && production === undefined) return 'both-missing';
  if (timeline === null) return 'timeline-missing';
  if (production === undefined) return 'production-missing';
  if (timeline === production) return 'equal';
  if (input.timelineStatus === 'past' && production === 100) return 'past-coerced';
  return 'differ';
}

/** Klasifikasi murni + ringkasan; baris selalu urut menaik berdasarkan courseId. */
export function compareProgress(inputs: ComparisonInput[]): CompareProgressResult {
  const rows: ComparedRow[] = inputs
    .map((input) => ({ ...input, classification: classify(input) }))
    .sort((left, right) => left.courseId - right.courseId);
  const counts = emptyCounts();
  const byStatus = { inprogress: emptyCounts(), past: emptyCounts() };
  for (const row of rows) {
    counts[row.classification] += 1;
    byStatus[row.timelineStatus][row.classification] += 1;
  }
  return { rows, summary: { total: rows.length, counts, byStatus } };
}

function readCookie(deps: CompareDeps): string {
  const file = deps.env.KULON_SESSION_COOKIE_FILE;
  if (file !== undefined && file.length > 0) return readFileSync(file, 'utf8').trim();
  const direct = deps.env.KULON_SESSION_COOKIE;
  if (direct !== undefined && direct.length > 0) return direct.trim();
  throw new Error('KULON_SESSION_COOKIE_FILE atau KULON_SESSION_COOKIE wajib diisi');
}

function outDir(deps: CompareDeps): string {
  const configured = deps.env.KULON_PROBE_OUT;
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_OUT_DIR;
}

interface TimelineCourse {
  id: number;
  timelineStatus: TimelineStatus;
  record: Record<string, unknown>;
}

function readCourseList(result: unknown): Array<Record<string, unknown>> {
  const record = result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const data =
    record.data !== null && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : {};
  const courses = data.courses;
  if (!Array.isArray(courses)) return [];
  return courses.filter(
    (course): course is Record<string, unknown> => course !== null && typeof course === 'object',
  );
}

async function fetchTimelineCourses(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
): Promise<TimelineCourse[]> {
  const entries: BatchEntry[] = TIMELINE_CLASSIFICATIONS.map((classification, index) => ({
    index,
    methodname: TIMELINE_METHOD,
    args: { classification, limit: 0, offset: 0, sort: 'fullname' },
  }));
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const mapped = mapBatchResponse(response.body, entries.length);
  if (mapped.shape === 'shape-unknown') {
    throw new Error('batch timeline tidak dikenali: ' + mapped.reason);
  }
  const buckets = mapped.results.map(readCourseList);
  const inprogressIds = new Set<number>();
  for (const course of buckets[0]) {
    const id = Number(course.id);
    if (Number.isFinite(id)) inprogressIds.add(id);
  }
  const merged = new Map<number, Record<string, unknown>>();
  // Produksi menggabungkan hidden lalu visible, first-wins by id (kulon.service.ts:569-574).
  for (const course of buckets[2].concat(buckets[1])) {
    const id = Number(course.id);
    if (!Number.isFinite(id) || merged.has(id)) continue;
    merged.set(id, course);
  }
  const courses: TimelineCourse[] = [];
  for (const [id, record] of merged.entries()) {
    courses.push({ id, timelineStatus: inprogressIds.has(id) ? 'inprogress' : 'past', record });
  }
  return courses.sort((left, right) => left.id - right.id);
}

function readEntryData(result: unknown): unknown {
  if (result === null || typeof result !== 'object') return null;
  const data = (result as Record<string, unknown>).data;
  return data === undefined ? null : data;
}

function readTimelineProgress(record: Record<string, unknown>): number | null {
  const value = record.progress;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchCourseState(
  fetchImpl: FetchLike,
  cookie: string,
  sesskey: string,
  courseId: number,
): Promise<CourseContentView> {
  // Index WAJIB 0: index non-nol menghasilkan objek ber-kunci, bukan array posisional.
  const entries: BatchEntry[] = [{ index: 0, methodname: STATE_METHOD, args: { courseid: courseId } }];
  const response = await ajaxBatch(fetchImpl, cookie, sesskey, entries);
  const mapped = mapBatchResponse(response.body, 1);
  if (mapped.shape === 'shape-unknown') {
    throw new Error('respons get_state tidak dikenali: ' + mapped.reason);
  }
  const entryError = readEntryError(mapped.results[0]);
  if (entryError.error) {
    throw new Error('get_state gagal: ' + (entryError.errorcode === null ? 'tanpa errorcode' : entryError.errorcode));
  }
  // Produksi membaca 'data' entri (bukan amplop {error, data}) — lihat
  // kulon-upstream.session.ts ajax() yang mengembalikan first.data.
  const raw = readEntryData(mapped.results[0]);
  // Produksi menolak 200 yang tidak berbentuk state (kulon.service.ts:1045-1047)
  // supaya fallback HTML tetap jalan.
  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as { section?: unknown }).section)) {
    throw new Error('bentuk state tidak dikenali');
  }
  return loadProductionParsers().mapCourseStateJson(raw, courseId);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index]);
    }
  };
  const workers: Array<Promise<void>> = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function compareCourse(
  deps: CompareDeps,
  cookie: string,
  sesskey: string,
  course: TimelineCourse,
  now: Date,
): Promise<ComparisonInput> {
  const timelineProgress = readTimelineProgress(course.record);
  const hasProgress = course.record.hasprogress === true;
  const isPast = course.timelineStatus === 'past';
  const base = {
    courseId: course.id,
    timelineStatus: course.timelineStatus,
    timelineProgress,
    hasProgress,
  };
  try {
    const content = await fetchCourseState(deps.fetchImpl, cookie, sesskey, course.id);
    return {
      ...base,
      productionProgress: loadProductionParsers().parseSectionProgress(content.sections, now, { isPast }),
      source: 'state',
    };
  } catch {
    // State JSON gagal: fallback HTML, sama seperti fetchCourseContent produksi.
  }
  try {
    const page = await fetchHtmlPage(deps.fetchImpl, cookie, '/course/view.php?id=' + course.id);
    // fetchKulonPage produksi menolak respons non-OK; samakan di sini.
    if (page.status < 200 || page.status >= 300) {
      throw new Error('HTML course/view.php status ' + page.status);
    }
    const content = loadProductionParsers().parseContentHtml(page.html, course.id);
    return {
      ...base,
      productionProgress: loadProductionParsers().parseSectionProgress(content.sections, now, { isPast }),
      source: 'html',
    };
  } catch {
    return { ...base, productionProgress: undefined, source: 'error' };
  }
}

function progressCell(value: number | null | undefined): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}

function renderCompareReport(compared: CompareProgressResult): string {
  const { rows, summary } = compared;
  const inprogressTotal = rows.filter((row) => row.timelineStatus === 'inprogress').length;
  const pastTotal = rows.filter((row) => row.timelineStatus === 'past').length;
  const hasProgressCount = rows.filter((row) => row.hasProgress).length;
  const lines: string[] = [
    '# Kulon: progress timeline vs scrape produksi (2026-10-24)',
    '',
    'Alat baca-saja. Per kursus: timelineProgress dari payload batch timeline Kulon,',
    'productionProgress dari jalur produksi (core_courseformat_get_state -> fallback',
    '/course/view.php -> parseSectionProgress). Cookie tidak pernah ditulis ke laporan ini.',
    '',
    '## Pertanyaan adopsi',
    '',
    '- Kursus inprogress yang cocok persis (equal): ' +
      summary.byStatus.inprogress.equal +
      ' dari ' +
      inprogressTotal +
      '.',
    '- Kursus inprogress yang berbeda (differ): ' +
      summary.byStatus.inprogress.differ +
      ' dari ' +
      inprogressTotal +
      '.',
    '- Kursus past yang berubah makna karena coercion 100 (past-coerced): ' +
      summary.byStatus.past['past-coerced'] +
      ' dari ' +
      pastTotal +
      '.',
    '',
    'Total kursus: ' +
      summary.total +
      ' (inprogress ' +
      inprogressTotal +
      ', past ' +
      pastTotal +
      '). Kunci hasprogress true: ' +
      hasProgressCount +
      ' dari ' +
      summary.total +
      '.',
    '',
    '## Ringkasan klasifikasi',
    '',
    '| klasifikasi | inprogress | past | total |',
    '| --- | --- | --- | --- |',
  ];
  for (const classification of CLASSIFICATIONS) {
    lines.push(
      '| ' +
        classification +
        ' | ' +
        summary.byStatus.inprogress[classification] +
        ' | ' +
        summary.byStatus.past[classification] +
        ' | ' +
        summary.counts[classification] +
        ' |',
    );
  }
  lines.push('', '## Tabel per kursus', '');
  lines.push('| courseId | timelineStatus | timelineProgress | productionProgress | source | classification |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      '| ' +
        row.courseId +
        ' | ' +
        row.timelineStatus +
        ' | ' +
        progressCell(row.timelineProgress) +
        ' | ' +
        progressCell(row.productionProgress) +
        ' | ' +
        row.source +
        ' | ' +
        row.classification +
        ' |',
    );
  }
  return lines.join('\n') + '\n';
}

export async function runCompare(deps: CompareDeps): Promise<CompareResult> {
  const cookie = readCookie(deps);
  const session = await fetchSesskey(deps.fetchImpl, cookie);
  if (!session.ok) {
    throw new Error('sesi Kulon tidak valid: ' + session.reason);
  }
  // Gagal cepat sebelum menyentuh jaringan bila parser produksi tidak termuat.
  loadProductionParsers();
  const courses = await fetchTimelineCourses(deps.fetchImpl, cookie, session.sesskey);
  const now = new Date(deps.now());
  const inputs = await mapWithConcurrency(courses, COURSE_CONCURRENCY, (course) =>
    compareCourse(deps, cookie, session.sesskey, course, now),
  );
  const compared = compareProgress(inputs);
  const report = renderCompareReport(compared);
  const reportPath = outDir(deps) + '/' + REPORT_NAME;
  deps.writeFile(reportPath, report);
  return { summary: compared.summary, reportPath, report };
}

function summaryLines(summary: ProgressSummary): string[] {
  return [
    'total: ' + summary.total,
    'equal: ' + summary.counts.equal,
    'past-coerced: ' + summary.counts['past-coerced'],
    'differ: ' + summary.counts.differ,
    'timeline-missing: ' + summary.counts['timeline-missing'],
    'production-missing: ' + summary.counts['production-missing'],
    'both-missing: ' + summary.counts['both-missing'],
    'scrape-error: ' + summary.counts['scrape-error'],
    'inprogress equal: ' + summary.byStatus.inprogress.equal,
    'inprogress differ: ' + summary.byStatus.inprogress.differ,
    'past coerced: ' + summary.byStatus.past['past-coerced'],
  ];
}

async function main(): Promise<void> {
  const result = await runCompare({
    fetchImpl: (url, init) => fetch(url, init),
    env: process.env,
    now: () => Date.now(),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
    },
  });
  for (const line of summaryLines(result.summary)) process.stdout.write(line + '\n');
  process.stdout.write('laporan: ' + result.reportPath + '\n');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('pembanding gagal: ' + message + '\n');
    process.exitCode = 1;
  });
}
