import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export const MAX_LINE_LENGTH = 64 * 1024;
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const INPUT_CHUNK_BYTES = 64 * 1024;
const EVENT_NAMES = ["cache.read", "cache.refresh", "upstream.request"] as const;
const NUMERIC_FIELDS = ["durationMs", "ageMs", "freshTtlMs", "staleTtlMs"] as const;

type EventShape = {
  outcomes: string[];
  required: string[];
  forbidden: string[];
};

type StatusRules = {
  minimum: number;
  maximum: number;
  requiredFor: string[];
  forbiddenFor: string[];
};

type ValidationRules = {
  numeric: { minimum: number; maximum: number };
  upstreamStatus: StatusRules;
  authProbe: { cache: string; backend: string; outcomes: string[]; forbidden: string[] };
  hardExpireReason: string;
  upstreamReasonGroups: Record<string, string[]>;
};

type Contract = {
  schemaVersion: number;
  cacheLabels: string[];
  cacheBackends: string[];
  cacheReadOutcomes: string[];
  cacheRefreshOutcomes: string[];
  cacheRefreshReasons: string[];
  upstreamServices: string[];
  upstreamOutcomes: string[];
  upstreamReasons: string[];
  upstreamRoutes: Array<{ service: string; operation: string; route: string }>;
  eventShapes: Record<string, Record<string, EventShape>>;
  numeric: { minimum: number; maximum: number };
  upstreamStatus: StatusRules;
  authProbe: { cache: string; backend: string; outcomes: string[]; forbidden: string[] };
  hardExpireReason: string;
  upstreamReasonGroups: Record<string, string[]>;
};

export type SafeEvent = JsonRecord & {
  v: number;
  ts: string;
  event: string;
};

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

let contractCache: Contract | undefined;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new Error("Invalid observability contract");
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid observability contract");
  }
  return [...value];
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid observability contract");
  }
  return value;
}

function contractCandidates(): string[] {
  return [
    join(__dirname, "observability-contract.json"),
    join(__dirname, "..", "observability-contract.json"),
    join(process.cwd(), "observability-contract.json"),
    join(process.cwd(), "tools", "observability-contract.json"),
  ];
}

function readContractRaw(): string {
  let raw: string | undefined;
  for (const candidate of contractCandidates()) {
    try {
      raw = readFileSync(candidate, "utf8");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Unable to read observability contract");
      }
    }
  }
  if (raw === undefined) throw new Error("Unable to read observability contract");
  return raw;
}

function parseContractRoot(raw: string): JsonRecord {
  try {
    return requiredRecord(JSON.parse(raw));
  } catch {
    throw new Error("Invalid observability contract");
  }
}

function loadContractCatalog(root: JsonRecord) {
  const schemaVersion = requiredNumber(root.schemaVersion);
  const cacheLabels = stringArray(root.cacheLabels);
  const cacheBackends = stringArray(root.cacheBackends);
  const cacheReadOutcomes = stringArray(root.cacheReadOutcomes);
  const cacheRefreshOutcomes = stringArray(root.cacheRefreshOutcomes);
  const cacheRefreshReasons = stringArray(root.cacheRefreshReasons);
  const upstreamServices = stringArray(root.upstreamServices);
  const upstreamOutcomes = stringArray(root.upstreamOutcomes);
  const upstreamReasons = stringArray(root.upstreamReasons);

  if (
    !Number.isSafeInteger(schemaVersion) ||
    cacheLabels.length === 0 ||
    cacheBackends.length === 0 ||
    cacheReadOutcomes.length === 0 ||
    cacheRefreshOutcomes.length === 0 ||
    cacheRefreshReasons.length === 0 ||
    upstreamServices.length === 0 ||
    upstreamOutcomes.length === 0 ||
    upstreamReasons.length === 0
  ) {
    throw new Error("Invalid observability contract");
  }

  return {
    schemaVersion,
    cacheLabels,
    cacheBackends,
    cacheReadOutcomes,
    cacheRefreshOutcomes,
    cacheRefreshReasons,
    upstreamServices,
    upstreamOutcomes,
    upstreamReasons,
  };
}

function loadRoute(value: unknown, services: string[]): Contract["upstreamRoutes"][number] {
  const route = requiredRecord(value);
  if (
    typeof route.service !== "string" ||
    typeof route.operation !== "string" ||
    typeof route.route !== "string" ||
    !services.includes(route.service)
  ) {
    throw new Error("Invalid observability contract");
  }
  return { service: route.service, operation: route.operation, route: route.route };
}

function loadRoutes(value: unknown, services: string[]): Contract["upstreamRoutes"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Invalid observability contract");
  }
  return value.map((route) => loadRoute(route, services));
}

function loadShape(value: unknown): EventShape {
  const shape = requiredRecord(value);
  const result = {
    outcomes: stringArray(shape.outcomes),
    required: stringArray(shape.required),
    forbidden: stringArray(shape.forbidden),
  };
  if (
    result.outcomes.length === 0 ||
    result.required.some((field) => result.forbidden.includes(field))
  ) {
    throw new Error("Invalid observability contract");
  }
  return result;
}

function loadEventShapes(value: unknown): Contract["eventShapes"] {
  const eventShapesRoot = requiredRecord(value);
  const eventShapes: Record<string, Record<string, EventShape>> = {};
  for (const eventName of EVENT_NAMES) {
    const eventRoot = requiredRecord(eventShapesRoot[eventName]);
    const shapes: Record<string, EventShape> = {};
    for (const [shapeName, shape] of Object.entries(eventRoot)) shapes[shapeName] = loadShape(shape);
    if (Object.keys(shapes).length === 0) throw new Error("Invalid observability contract");
    eventShapes[eventName] = shapes;
  }
  return eventShapes;
}

function validateOutcomeCoverage(
  eventShapes: Contract["eventShapes"],
  catalog: Pick<Contract, "cacheReadOutcomes" | "cacheRefreshOutcomes" | "upstreamOutcomes">,
): void {
  const catalogs = [
    ["cache.read", catalog.cacheReadOutcomes],
    ["cache.refresh", catalog.cacheRefreshOutcomes],
    ["upstream.request", catalog.upstreamOutcomes],
  ] as const;
  for (const [eventName, outcomes] of catalogs) {
    const catalogOutcomes = new Set(outcomes);
    const shapeOutcomes = new Set<string>();
    for (const shape of Object.values(eventShapes[eventName])) {
      for (const outcome of shape.outcomes) {
        if (!catalogOutcomes.has(outcome)) throw new Error("Invalid observability contract");
        shapeOutcomes.add(outcome);
      }
    }
    if (shapeOutcomes.size !== catalogOutcomes.size) throw new Error("Invalid observability contract");
  }
}

function loadNumericRules(value: unknown): { minimum: number; maximum: number } {
  const root = requiredRecord(value);
  const result = {
    minimum: requiredNumber(root.minimum),
    maximum: requiredNumber(root.maximum),
  };
  if (
    !Number.isSafeInteger(result.minimum) ||
    !Number.isSafeInteger(result.maximum) ||
    result.minimum < 0 ||
    result.maximum < result.minimum
  ) {
    throw new Error("Invalid observability contract");
  }
  return result;
}

function loadStatusRules(value: unknown): StatusRules {
  const root = requiredRecord(value);
  const result = {
    minimum: requiredNumber(root.minimum),
    maximum: requiredNumber(root.maximum),
    requiredFor: stringArray(root.requiredFor),
    forbiddenFor: stringArray(root.forbiddenFor),
  };
  if (
    !Number.isSafeInteger(result.minimum) ||
    !Number.isSafeInteger(result.maximum) ||
    result.minimum < 0 ||
    result.maximum < result.minimum ||
    result.requiredFor.some((outcome) => result.forbiddenFor.includes(outcome))
  ) {
    throw new Error("Invalid observability contract");
  }
  return result;
}

function loadAuthProbe(value: unknown): ValidationRules["authProbe"] {
  const root = requiredRecord(value);
  const result = {
    cache: typeof root.cache === "string" ? root.cache : "",
    backend: typeof root.backend === "string" ? root.backend : "",
    outcomes: stringArray(root.outcomes),
    forbidden: stringArray(root.forbidden),
  };
  if (!result.cache || !result.backend || result.outcomes.length === 0) {
    throw new Error("Invalid observability contract");
  }
  return result;
}

function loadReasonGroups(value: unknown): Record<string, string[]> {
  const root = requiredRecord(value);
  const entries = Object.entries(root);
  if (entries.length === 0) throw new Error("Invalid observability contract");
  return Object.fromEntries(entries.map(([name, reasons]) => [name, stringArray(reasons)]));
}

function loadValidationRules(value: unknown): ValidationRules {
  const root = requiredRecord(value);
  const cacheRead = requiredRecord(root.cacheRead);
  const cacheRefresh = requiredRecord(root.cacheRefresh);
  const hardExpire = requiredRecord(cacheRefresh.hardExpire);
  const hardExpireReason = typeof hardExpire.requiredReason === "string" ? hardExpire.requiredReason : "";
  if (!hardExpireReason) throw new Error("Invalid observability contract");
  return {
    numeric: loadNumericRules(root.numeric),
    upstreamStatus: loadStatusRules(root.upstreamStatus),
    authProbe: loadAuthProbe(cacheRead.authProbe),
    hardExpireReason,
    upstreamReasonGroups: loadReasonGroups(root.upstreamReasons),
  };
}

function loadContract(): Contract {
  const root = parseContractRoot(readContractRaw());
  const catalog = loadContractCatalog(root);
  const validationRules = loadValidationRules(root.validationRules);
  const eventShapes = loadEventShapes(root.eventShapes);
  validateOutcomeCoverage(eventShapes, catalog);
  return {
    ...catalog,
    upstreamRoutes: loadRoutes(root.upstreamRoutes, catalog.upstreamServices),
    eventShapes,
    ...validationRules,
  };
}

function getContract(): Contract {
  if (!contractCache) contractCache = loadContract();
  return contractCache;
}

function isSafeNumber(value: unknown, contract: Contract): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= contract.numeric.minimum &&
    value <= contract.numeric.maximum
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function routeMatches(value: JsonRecord, contract: Contract): boolean {
  return contract.upstreamRoutes.some(
    (route) =>
      route.service === value.service &&
      route.operation === value.operation &&
      route.route === value.route,
  );
}

function shapeFor(value: JsonRecord, eventName: string, contract: Contract): EventShape | undefined {
  const shapes = contract.eventShapes[eventName];
  if (!shapes || typeof value.outcome !== "string") return undefined;

  const matches = Object.values(shapes).filter(
    (shape) =>
      shape.outcomes.includes(value.outcome as string) &&
      shape.required.every((field) => has(value, field)) &&
      shape.forbidden.every((field) => !has(value, field)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function validReason(value: JsonRecord, eventName: string, contract: Contract): boolean {
  if (typeof value.reason !== "string") return false;
  if (eventName === "cache.refresh") return contract.cacheRefreshReasons.includes(value.reason);
  if (eventName !== "upstream.request") return false;
  if (typeof value.outcome !== "string" || !contract.upstreamReasons.includes(value.reason)) return false;
  return Object.entries(contract.upstreamReasonGroups).some(
    ([shapeName, reasons]) =>
      contract.eventShapes["upstream.request"]?.[shapeName]?.outcomes.includes(value.outcome as string) &&
      reasons.includes(value.reason as string),
  );
}

function validField(value: JsonRecord, field: string, eventName: string, contract: Contract): boolean {
  if ((NUMERIC_FIELDS as readonly string[]).includes(field)) return isSafeNumber(value[field], contract);
  switch (field) {
    case "cache":
      return typeof value.cache === "string" && contract.cacheLabels.includes(value.cache);
    case "backend":
      return typeof value.backend === "string" && contract.cacheBackends.includes(value.backend);
    case "outcome":
      return (
        typeof value.outcome === "string" &&
        Object.values(contract.eventShapes[eventName] ?? {}).some((shape) =>
          shape.outcomes.includes(value.outcome as string),
        )
      );
    case "service":
      return typeof value.service === "string" && contract.upstreamServices.includes(value.service);
    case "operation":
    case "route":
      return routeMatches(value, contract);
    case "reason":
      return validReason(value, eventName, contract);
    case "status":
      return (
        isSafeNumber(value.status, contract) &&
        value.status >= contract.upstreamStatus.minimum &&
        value.status <= contract.upstreamStatus.maximum
      );
    default:
      return false;
  }
}

function hasValidBase(value: JsonRecord, contract: Contract): boolean {
  return (
    has(value, "v") &&
    value.v === contract.schemaVersion &&
    isSafeNumber(value.v, contract) &&
    has(value, "ts") &&
    isTimestamp(value.ts) &&
    has(value, "event") &&
    typeof value.event === "string"
  );
}

function followsUpstreamStatusRules(value: JsonRecord, contract: Contract): boolean {
  if (value.event !== "upstream.request" || typeof value.outcome !== "string") return true;
  const { requiredFor, forbiddenFor } = contract.upstreamStatus;
  const hasStatus = has(value, "status");
  if (forbiddenFor.includes(value.outcome) && hasStatus) return false;
  if (requiredFor.includes(value.outcome) && (!hasStatus || !validField(value, "status", "upstream.request", contract))) {
    return false;
  }
  return !hasStatus || validField(value, "status", "upstream.request", contract);
}

function followsCacheRules(value: JsonRecord, eventName: string, contract: Contract): boolean {
  if (eventName === "cache.read" && value.cache === contract.authProbe.cache) {
    return (
      value.backend === contract.authProbe.backend &&
      typeof value.outcome === "string" &&
      contract.authProbe.outcomes.includes(value.outcome) &&
      contract.authProbe.forbidden.every((field) => !has(value, field))
    );
  }
  if (eventName === "cache.refresh") {
    if (value.cache === contract.authProbe.cache) return false;
    if (value.outcome === "hard_expire" && value.reason !== contract.hardExpireReason) return false;
  }
  return true;
}

function safeEvent(value: JsonRecord, shape: EventShape, eventName: string): SafeEvent {
  const safe: SafeEvent = { v: value.v as number, ts: value.ts as string, event: eventName };
  for (const field of shape.required) safe[field] = value[field];
  return safe;
}

/** Validate an input object and return only the contract-approved fields. */
export function validateEvent(value: unknown): SafeEvent | undefined {
  let contract: Contract;
  try {
    contract = getContract();
    if (!isRecord(value) || !hasValidBase(value, contract)) return undefined;
    const eventName = value.event as string;
    const shape = shapeFor(value, eventName, contract);
    if (!shape || !shape.outcomes.includes(String(value.outcome))) return undefined;
    if (shape.forbidden.some((field) => has(value, field))) return undefined;
    if (shape.required.some((field) => !has(value, field) || !validField(value, field, eventName, contract))) {
      return undefined;
    }
    if (!followsUpstreamStatusRules(value, contract) || !followsCacheRules(value, eventName, contract)) {
      return undefined;
    }
    return safeEvent(value, shape, eventName);
  } catch {
    return undefined;
  }
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
      if (cache) cache.reads[String(event.outcome)] += 1;
      continue;
    }
    if (event.event === "cache.refresh") {
      const cache = report.cache[String(event.cache)];
      if (!cache) continue;
      cache.refreshes[String(event.outcome)] += 1;
      if (has(event, "reason")) cache.refreshes.reasons[String(event.reason)] += 1;
      continue;
    }
    if (event.event === "upstream.request") {
      const key = `${event.service}.${event.operation}.${event.route}`;
      const group = report.upstream[key];
      if (!group) continue;
      group.outcomes[String(event.outcome)] += 1;
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
