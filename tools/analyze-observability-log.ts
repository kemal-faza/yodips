import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

type EventShape = {
  outcomes: string[];
  required: string[];
  forbidden: string[];
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
  upstreamStatus: { minimum: number; maximum: number };
  authProbe: { cache: string; backend: string; outcomes: string[]; forbidden: string[] };
  hardExpireReason: string;
  upstreamReasonGroups: {
    httpError: string[];
    networkError: string[];
    parseError: string[];
    stale: string[];
  };
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

function loadContract(): Contract {
  const candidates = [
    join(__dirname, "observability-contract.json"),
    join(__dirname, "..", "observability-contract.json"),
    join(process.cwd(), "observability-contract.json"),
    join(process.cwd(), "tools", "observability-contract.json"),
  ];
  let raw: string | undefined;
  for (const candidate of candidates) {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid observability contract");
  }
  const root = requiredRecord(parsed);
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

  const upstreamRoutesValue = root.upstreamRoutes;
  if (!Array.isArray(upstreamRoutesValue) || upstreamRoutesValue.length === 0) {
    throw new Error("Invalid observability contract");
  }
  const upstreamRoutes = upstreamRoutesValue.map((value) => {
    const route = requiredRecord(value);
    if (
      typeof route.service !== "string" ||
      typeof route.operation !== "string" ||
      typeof route.route !== "string" ||
      !upstreamServices.includes(route.service)
    ) {
      throw new Error("Invalid observability contract");
    }
    return { service: route.service, operation: route.operation, route: route.route };
  });

  const eventShapesRoot = requiredRecord(root.eventShapes);
  const eventShapes: Record<string, Record<string, EventShape>> = {};
  for (const eventName of ["cache.read", "cache.refresh", "upstream.request"]) {
    const eventRoot = requiredRecord(eventShapesRoot[eventName]);
    const shapes: Record<string, EventShape> = {};
    for (const [shapeName, value] of Object.entries(eventRoot)) {
      const shape = requiredRecord(value);
      shapes[shapeName] = {
        outcomes: stringArray(shape.outcomes),
        required: stringArray(shape.required),
        forbidden: stringArray(shape.forbidden),
      };
    }
    if (Object.keys(shapes).length === 0) throw new Error("Invalid observability contract");
    eventShapes[eventName] = shapes;
  }

  const validationRules = requiredRecord(root.validationRules);
  const numericRoot = requiredRecord(validationRules.numeric);
  const numeric = {
    minimum: requiredNumber(numericRoot.minimum),
    maximum: requiredNumber(numericRoot.maximum),
  };
  const upstreamStatusRoot = requiredRecord(validationRules.upstreamStatus);
  const upstreamStatus = {
    minimum: requiredNumber(upstreamStatusRoot.minimum),
    maximum: requiredNumber(upstreamStatusRoot.maximum),
  };
  if (numeric.minimum < 0 || numeric.maximum < numeric.minimum || upstreamStatus.minimum < 100) {
    throw new Error("Invalid observability contract");
  }

  const authProbeRoot = requiredRecord(requiredRecord(validationRules.cacheRead).authProbe);
  const authProbe = {
    cache: typeof authProbeRoot.cache === "string" ? authProbeRoot.cache : "",
    backend: typeof authProbeRoot.backend === "string" ? authProbeRoot.backend : "",
    outcomes: stringArray(authProbeRoot.outcomes),
    forbidden: stringArray(authProbeRoot.forbidden),
  };
  const hardExpireRoot = requiredRecord(requiredRecord(validationRules.cacheRefresh).hardExpire);
  const hardExpireReason =
    typeof hardExpireRoot.requiredReason === "string" ? hardExpireRoot.requiredReason : "";
  const upstreamReasonsRoot = requiredRecord(validationRules.upstreamReasons);
  const upstreamReasonGroups = {
    httpError: stringArray(upstreamReasonsRoot.httpError),
    networkError: stringArray(upstreamReasonsRoot.networkError),
    parseError: stringArray(upstreamReasonsRoot.parseError),
    stale: stringArray(upstreamReasonsRoot.stale),
  };
  if (!authProbe.cache || !authProbe.backend || !hardExpireReason) {
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
    upstreamRoutes,
    eventShapes,
    numeric,
    upstreamStatus,
    authProbe,
    hardExpireReason,
    upstreamReasonGroups,
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

  if (eventName === "cache.read") {
    if (value.outcome === "miss" && (has(value, "ageMs") || has(value, "freshTtlMs") || has(value, "staleTtlMs"))) {
      return shapes.staleMiss;
    }
    if (value.outcome === "fresh" || value.outcome === "stale" || value.outcome === "expired") {
      return shapes.existing;
    }
    return shapes.plain;
  }
  if (eventName === "cache.refresh") {
    if (value.outcome === "started") return shapes.started;
    if (value.outcome === "ok") return shapes.ok;
    if (value.outcome === "error" || value.outcome === "hard_expire") return shapes.terminal;
    return undefined;
  }
  const shapeName =
    value.outcome === "http_error"
      ? "httpError"
      : value.outcome === "network_error"
        ? "networkError"
        : value.outcome === "parse_error"
          ? "parseError"
          : value.outcome;
  return shapes[shapeName];
}

function validReason(value: JsonRecord, eventName: string, contract: Contract): boolean {
  if (typeof value.reason !== "string") return false;
  if (eventName === "cache.refresh") return contract.cacheRefreshReasons.includes(value.reason);
  if (eventName !== "upstream.request") return false;
  if (!contract.upstreamReasons.includes(value.reason)) return false;
  switch (value.outcome) {
    case "http_error":
      return contract.upstreamReasonGroups.httpError.includes(value.reason);
    case "network_error":
      return contract.upstreamReasonGroups.networkError.includes(value.reason);
    case "parse_error":
      return contract.upstreamReasonGroups.parseError.includes(value.reason);
    case "stale":
      return contract.upstreamReasonGroups.stale.includes(value.reason);
    default:
      return false;
  }
}

function validField(value: JsonRecord, field: string, eventName: string, contract: Contract): boolean {
  switch (field) {
    case "cache":
      return typeof value.cache === "string" && contract.cacheLabels.includes(value.cache);
    case "backend":
      return typeof value.backend === "string" && contract.cacheBackends.includes(value.backend);
    case "outcome":
      if (eventName === "cache.read") return typeof value.outcome === "string" && contract.cacheReadOutcomes.includes(value.outcome);
      if (eventName === "cache.refresh") return typeof value.outcome === "string" && contract.cacheRefreshOutcomes.includes(value.outcome);
      return typeof value.outcome === "string" && contract.upstreamOutcomes.includes(value.outcome);
    case "service":
      return typeof value.service === "string" && contract.upstreamServices.includes(value.service);
    case "operation":
    case "route":
      return routeMatches(value, contract);
    case "reason":
      return validReason(value, eventName, contract);
    case "durationMs":
    case "ageMs":
    case "freshTtlMs":
    case "staleTtlMs":
      return isSafeNumber(value[field], contract);
    case "status":
      return (
        isSafeNumber(value.status, contract) &&
        value.status >= contract.upstreamStatus.minimum &&
        value.status <= contract.upstreamStatus.maximum
      );
    default:
      return true;
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

    if (eventName === "cache.read" && value.cache === contract.authProbe.cache) {
      if (
        value.backend !== contract.authProbe.backend ||
        typeof value.outcome !== "string" ||
        !contract.authProbe.outcomes.includes(value.outcome) ||
        contract.authProbe.forbidden.some((field) => has(value, field))
      ) {
        return undefined;
      }
    }
    if (eventName === "cache.refresh" && value.cache === contract.authProbe.cache) return undefined;
    if (
      eventName === "cache.refresh" &&
      value.outcome === "hard_expire" &&
      value.reason !== contract.hardExpireReason
    ) {
      return undefined;
    }
    if (
      eventName === "upstream.request" &&
      value.outcome !== "network_error" &&
      (!has(value, "status") || !validField(value, "status", eventName, contract))
    ) {
      return undefined;
    }
    if (eventName === "upstream.request" && value.outcome === "network_error" && has(value, "status")) {
      return undefined;
    }

    const safe: SafeEvent = { v: value.v as number, ts: value.ts as string, event: eventName };
    for (const field of shape.required) safe[field] = value[field];
    return safe;
  } catch {
    return undefined;
  }
}

function matchingObjectEnd(line: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < line.length; index += 1) {
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
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return undefined;
    }
  }
  return undefined;
}

function objectCandidates(line: string): string[] {
  const candidates: string[] = [];
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index] !== "{") continue;
    const end = matchingObjectEnd(line, index);
    if (end !== undefined) candidates.push(line.slice(index, end + 1));
  }
  return candidates;
}

/** Parse one log line, scanning JSON object candidates from right to left. */
export function parseEventLine(line: string): LineResult {
  const trimmed = line.trim();
  if (!trimmed.endsWith("}")) {
    if (!trimmed.startsWith("{")) return { kind: "ignored" };
    const end = matchingObjectEnd(trimmed, 0);
    if (end !== undefined) {
      try {
        const parsed = JSON.parse(trimmed.slice(0, end + 1));
        if (validateEvent(parsed)) return { kind: "ignored" };
      } catch {
        // A non-suffix candidate is not an event; the object-looking failure is malformed below.
      }
    }
    return { kind: "malformed" };
  }

  const candidates = objectCandidates(trimmed);
  let sawCandidate = false;
  for (const candidate of candidates) {
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
  return sawCandidate || trimmed.includes("{") ? { kind: "malformed" } : { kind: "ignored" };
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

/** Run the standalone analyzer CLI. Returns the process exit code. */
export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.length > 1) {
    process.stderr.write("Expected zero or one input argument (a file path or -).\n");
    return 2;
  }

  try {
    const input = argv.length === 0 || argv[0] === "-" ? readFileSync(0, "utf8") : readFileSync(argv[0], "utf8");
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
