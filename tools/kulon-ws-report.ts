/**
 * Penulis laporan markdown probe Kulon. Pure: string in, string out.
 * Pesan upstream diredaksi sebelum masuk laporan.
 */
import type { DiagnosticEntry, SpotCheckRow } from './kulon-ws-shape';
import type { CoverageRow, InventoryRow, Verdict } from './kulon-ws-verdict';

export interface ReportInput {
  generatedAt: string;
  n: number;
  timelineShape: string;
  hasProgress: boolean;
  extraKeys: string[];
  diagnostics: DiagnosticEntry[];
  spotCheck: SpotCheckRow[];
  inventory: InventoryRow[];
  coverage: CoverageRow[];
  verdict: Verdict;
  reasons: string[];
  pair1Ms: number;
  pair2Ms: number;
  baseline1Ms: number | null;
  baseline2Ms: number | null;
  posts: { timeline: number; assignments: number; submissionStatus: number | null; progress: number };
  token: Record<string, unknown> | null;
  limitations: string[];
}

export function redactUpstream(text: string | null): string {
  if (text === null) return '-';
  return text
    .replace(/MoodleSession[A-Za-z0-9_\-]*=[^;\s]+/g, '[REDACTED-COOKIE]')
    .replace(/wstoken=[^&\s]+/g, '[REDACTED-TOKEN]')
    .replace(/sesskey=[^&\s]+/g, '[REDACTED-SESSKEY]');
}

function orDash(value: string | null): string {
  return value === null ? '-' : value;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push('# Probe Web Service Kulon — Laporan');
  lines.push('');
  lines.push('Digenerate: ' + input.generatedAt);
  lines.push('');
  lines.push('**Verdict: ' + input.verdict + '**');
  lines.push('');
  for (const reason of input.reasons) lines.push('- ' + reason);
  lines.push('');
  lines.push('## Ringkasan jalur');
  lines.push('');
  lines.push('| Item | Nilai |');
  lines.push('| --- | --- |');
  lines.push('| Jumlah kursus (N) | ' + input.n + ' |');
  lines.push('| Bentuk respons batch timeline | ' + input.timelineShape + ' |');
  lines.push('| progress tersedia dari timeline | ' + String(input.hasProgress) + ' |');
  lines.push('| Kunci course yang terlihat | ' + input.extraKeys.join(', ') + ' |');
  lines.push('| Pasangan 1 kandidat | ' + input.pair1Ms + ' ms |');
  lines.push('| Pasangan 1 baseline | ' + (input.baseline1Ms === null ? 'tidak diukur' : input.baseline1Ms + ' ms') + ' |');
  lines.push('| Pasangan 2 kandidat | ' + input.pair2Ms + ' ms |');
  lines.push('| Pasangan 2 baseline | ' + (input.baseline2Ms === null ? 'tidak diukur' : input.baseline2Ms + ' ms') + ' |');
  lines.push('| POST timeline | ' + input.posts.timeline + ' |');
  lines.push('| POST metadata assignment/quiz | ' + input.posts.assignments + ' |');
  lines.push(
    '| POST submissionStatus | ' + (input.posts.submissionStatus === null ? 'tidak dipakai' : input.posts.submissionStatus) + ' |',
  );
  lines.push('| POST progress | ' + input.posts.progress + ' |');
  lines.push('| Jalur token | ' + (input.token === null ? 'tidak dijalankan' : JSON.stringify(input.token)) + ' |');
  lines.push('');
  lines.push('## Diagnostik batch');
  lines.push('');
  lines.push('| methodname | status | error | errorcode | pesan |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const entry of input.diagnostics) {
    lines.push(
      '| ' +
        entry.methodname +
        ' | ' +
        (entry.status === undefined ? '-' : String(entry.status)) +
        ' | ' +
        String(entry.error) +
        ' | ' +
        orDash(entry.errorcode) +
        ' | ' +
        orDash(redactUpstream(entry.message)) +
        ' |',
    );
  }
  lines.push('');
  lines.push('## Spot-check semantik (sampel)');
  lines.push('');
  lines.push('| Kursus | cmid | name (WS) | duedate (WS) |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of input.spotCheck) {
    lines.push('| ' + row.courseId + ' | ' + row.cmid + ' | ' + row.name + ' | ' + row.duedate + ' |');
  }
  lines.push('');
  lines.push('## Inventaris 19 field');
  lines.push('');
  lines.push('| No | Field | Objek | Status | Bukti |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of input.inventory) {
    lines.push('| ' + row.no + ' | ' + row.field + ' | ' + row.object + ' | ' + row.status + ' | ' + row.evidence + ' |');
  }
  lines.push('');
  lines.push('## Cakupan record (cmid) per kursus');
  lines.push('');
  lines.push('| Kursus | assign HTML | assign WS | selisih HTML | selisih WS | quiz HTML | quiz WS | selisih HTML | selisih WS |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of input.coverage) {
    lines.push(
      '| ' +
        row.courseId +
        ' | ' +
        row.assignHtml +
        ' | ' +
        row.assignWs +
        ' | ' +
        (row.assignOnlyHtml.join(',') || '-') +
        ' | ' +
        (row.assignOnlyWs.join(',') || '-') +
        ' | ' +
        row.quizHtml +
        ' | ' +
        row.quizWs +
        ' | ' +
        (row.quizOnlyHtml.join(',') || '-') +
        ' | ' +
        (row.quizOnlyWs.join(',') || '-') +
        ' |',
    );
  }
  lines.push('');
  lines.push('## Yang tidak dibuktikan fase ini');
  lines.push('');
  for (const item of input.limitations) lines.push('- ' + item);
  lines.push('');
  return lines.join('\n');
}
