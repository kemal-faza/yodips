import { closeSync, openSync, readSync } from "node:fs";
import {
  getContract,
  validateContract,
  validateEvent,
  type Contract,
  type SafeEvent,
} from "./observability-contract-loader";

export { validateContract, validateEvent } from "./observability-contract-loader";
export type { Contract, SafeEvent } from "./observability-contract-loader";

type JsonRecord = Record<string, unknown>;

export const MAX_LINE_LENGTH = 64 * 1024;
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const INPUT_CHUNK_BYTES = 64 * 1024;

export type LineResult =
  | { kind: "event"; event: SafeEvent }
  | { kind: "ignored" }
  | { kind: "malformed" };

type CacheAggregate = {
  reads: Record<string, number>;
  refreshes: Record<string, number> & { reasons: Record<string, number> };
};

type UpstreamAggregate = {
  outcomes: Record<string, number>;
  durationMs: { p50: number | null; p95: number | null };
};

export type AnalysisReport = {
  schemaVersion: number;
  lines: { events: number; ignoredLines: number; malformedEvents: number };
  cache: Record<string, CacheAggregate>;
  upstream: Record<string, UpstreamAggregate>;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

type ObjectSpan = { start: number; end: number };

type SpanScan = {
  spans: ObjectSpan[];
  hasOpeningBrace: boolean;
};

function scanBalancedSpans(line: string): SpanScan {
  const stack: number[] = [];
  const spans: ObjectSpan[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      stack.push(index);
    } else if (character === "}") {
      if (stack.length === 0) continue;
      const start = stack.pop() as number;
      if (stack.length === 0) spans.push({ start, end: index });
    }
  }
  return { spans, hasOpeningBrace: spans.length > 0 || stack.length > 0 };
}

function isWhitespace(line: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (!/\s/.test(line[index])) return false;
  }
  return true;
}

function suffixCandidateSpans(line: string, spans: ObjectSpan[]): ObjectSpan[] {
  if (spans.length === 0) return [];
  const eligible: boolean[] = new Array(spans.length).fill(false);
  let suffixIsValid = isWhitespace(line, spans[spans.length - 1].end + 1, line.length);
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    eligible[index] = suffixIsValid;
    if (index > 0) {
      suffixIsValid =
        suffixIsValid && isWhitespace(line, spans[index - 1].end + 1, spans[index].start);
    }
  }
  const candidates: ObjectSpan[] = [];
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    if (eligible[index]) candidates.push(spans[index]);
  }
  return candidates;
}

function parseLeadingObject(trimmed: string): LineResult {
  const scan = scanBalancedSpans(trimmed);
  const candidate = scan.spans.find((span) => span.start === 0);
  if (!candidate) return { kind: "malformed" };
  try {
    if (validateEvent(JSON.parse(trimmed.slice(0, candidate.end + 1)))) return { kind: "ignored" };
  } catch {
    // An object-looking parse failure is classified as malformed below.
  }
  return { kind: "malformed" };
}

function oversizedLine(line: string): boolean {
  return line.length > MAX_LINE_LENGTH || Buffer.byteLength(line, "utf8") > MAX_LINE_LENGTH;
}

/** Parse one log line, scanning JSON object candidates from right to left. */
export function parseEventLine(line: string): LineResult {
  if (typeof line !== "string") return { kind: "malformed" };
  if (oversizedLine(line)) return { kind: "malformed" };
  const trimmed = line.trim();
  if (!trimmed.endsWith("}")) {
    if (!trimmed.startsWith("{")) return { kind: "ignored" };
    return parseLeadingObject(trimmed);
  }

  const scan = scanBalancedSpans(trimmed);
  const candidates = suffixCandidateSpans(trimmed, scan.spans);
  let sawCandidate = false;
  for (const span of candidates) {
    const candidate = trimmed.slice(span.start, span.end + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      sawCandidate = true;
      continue;
    }
    sawCandidate = true;
    const event = validateEvent(parsed);
    if (event) return { kind: "event", event };
  }
  return sawCandidate || scan.hasOpeningBrace ? { kind: "malformed" } : { kind: "ignored" };
}

function zeroCounts(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of [...values].sort()) result[value] = 0;
  return result;
}

function incrementCounter(counters: Record<string, number>, key: string): void {
  const current = counters[key];
  if (!Number.isFinite(current)) throw new Error("Invalid observability contract");
  const next = current + 1;
  if (!Number.isFinite(next)) throw new Error("Invalid observability contract");
  counters[key] = next;
}

function routeKey(route: { service: string; operation: string; route: string }): string {
  return `${route.service}.${route.operation}.${route.route}`;
}

function createReport(contract: Contract): AnalysisReport {
  const cache: Record<string, CacheAggregate> = {};
  for (const label of [...contract.cacheLabels].sort()) {
    cache[label] = {
      reads: zeroCounts(contract.cacheReadOutcomes),
      refreshes: Object.assign(zeroCounts(contract.cacheRefreshOutcomes), {
        reasons: zeroCounts(contract.cacheRefreshReasons),
      }),
    };
  }

  const upstream: Record<string, UpstreamAggregate> = {};
  for (const route of [...contract.upstreamRoutes].sort((a, b) => {
    const left = routeKey(a);
    const right = routeKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  })) {
    upstream[routeKey(route)] = {
      outcomes: zeroCounts(contract.upstreamOutcomes),
      durationMs: { p50: null, p95: null },
    };
  }
  return {
    schemaVersion: contract.schemaVersion,
    lines: { events: 0, ignoredLines: 0, malformedEvents: 0 },
    cache,
    upstream,
  };
}

/** Return the nearest-rank percentile, or null for an empty sample. */
export function nearestRank(values: number[], p: 0.5 | 0.95): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1];
}

/** Aggregate already parsed events into a deterministic, contract-shaped report. */
export function aggregateEvents(events: readonly unknown[]): AnalysisReport {
  const contract = getContract();
  const report = createReport(contract);
  const durations = new Map<string, number[]>();

  for (const candidate of events) {
    const event = validateEvent(candidate);
    if (!event) continue;
    if (event.event === "cache.read") {
      const cache = report.cache[String(event.cache)];
      if (!cache) throw new Error("Invalid observability contract");
      incrementCounter(cache.reads, String(event.outcome));
      continue;
    }
    if (event.event === "cache.refresh") {
      const cache = report.cache[String(event.cache)];
      if (!cache) throw new Error("Invalid observability contract");
      incrementCounter(cache.refreshes, String(event.outcome));
      if (has(event, "reason")) incrementCounter(cache.refreshes.reasons, String(event.reason));
      continue;
    }
    if (event.event === "upstream.request") {
      const key = `${event.service}.${event.operation}.${event.route}`;
      const group = report.upstream[key];
      if (!group) throw new Error("Invalid observability contract");
      incrementCounter(group.outcomes, String(event.outcome));
      const sample = durations.get(key) ?? [];
      sample.push(event.durationMs as number);
      durations.set(key, sample);
    }
  }

  for (const [key, values] of durations) {
    report.upstream[key].durationMs = {
      p50: nearestRank(values, 0.5),
      p95: nearestRank(values, 0.95),
    };
  }
  return report;
}

/** Analyze newline-delimited log text. */
export function analyzeText(text: string): AnalysisReport {
  if (typeof text !== "string") throw new Error("Invalid input");
  if (Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES) throw new Error("Input too large");
  const events: SafeEvent[] = [];
  const report = createReport(getContract());
  const lines = text === "" ? [] : text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    const result = parseEventLine(line);
    if (result.kind === "event") {
      report.lines.events += 1;
      events.push(result.event);
    } else if (result.kind === "ignored") {
      report.lines.ignoredLines += 1;
    } else {
      report.lines.malformedEvents += 1;
    }
  }

  const aggregate = aggregateEvents(events);
  report.cache = aggregate.cache;
  report.upstream = aggregate.upstream;
  return report;
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!isRecord(value)) return value;
  const sorted: JsonRecord = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortRecursively(value[key]);
  return sorted;
}

/** Serialize a report with recursively sorted object keys. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortRecursively(value), null, 2)}\n`;
}

function readInput(argument?: string): string {
  const source: string | number = argument === undefined || argument === "-" ? 0 : argument;
  let fileDescriptor = 0;
  let shouldClose = false;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    if (typeof source === "string") {
      fileDescriptor = openSync(source, "r");
      shouldClose = true;
    }
    const buffer = Buffer.alloc(INPUT_CHUNK_BYTES);
    while (totalBytes <= MAX_INPUT_BYTES) {
      const remaining = MAX_INPUT_BYTES + 1 - totalBytes;
      const bytesRead = readSync(fileDescriptor, buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      if (totalBytes > MAX_INPUT_BYTES) throw new Error("Input too large");
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    if (shouldClose) closeSync(fileDescriptor);
  }
}

/** Run the standalone analyzer CLI. Returns the process exit code. */
export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.length > 1) {
    process.stderr.write("Expected zero or one input argument (a file path or -).\n");
    return 2;
  }

  try {
    const input = readInput(argv[0]);
    process.stdout.write(stableJson(analyzeText(input)));
    return 0;
  } catch {
    process.stderr.write(
      argv.length === 0 || argv[0] === "-"
        ? "Unable to read or analyze standard input.\n"
        : "Unable to read or analyze the input file.\n",
    );
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
