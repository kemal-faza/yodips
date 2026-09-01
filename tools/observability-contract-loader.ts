import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

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

export type Contract = {
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

function loadStatusRules(value: unknown, upstreamOutcomes: readonly string[]): StatusRules {
  const root = requiredRecord(value);
  const result = {
    minimum: requiredNumber(root.minimum),
    maximum: requiredNumber(root.maximum),
    requiredFor: stringArray(root.requiredFor),
    forbiddenFor: stringArray(root.forbiddenFor),
  };
  const knownOutcomes = new Set(upstreamOutcomes);
  if (
    !Number.isSafeInteger(result.minimum) ||
    !Number.isSafeInteger(result.maximum) ||
    result.minimum < 100 ||
    result.maximum > 599 ||
    result.maximum < result.minimum ||
    result.requiredFor.some((outcome) => result.forbiddenFor.includes(outcome)) ||
    result.requiredFor.some((outcome) => !knownOutcomes.has(outcome)) ||
    result.forbiddenFor.some((outcome) => !knownOutcomes.has(outcome))
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

function loadReasonGroups(
  value: unknown,
  eventShapes: Contract["eventShapes"],
  upstreamReasons: readonly string[],
): Record<string, string[]> {
  const root = requiredRecord(value);
  const entries = Object.entries(root);
  if (entries.length === 0) throw new Error("Invalid observability contract");
  const knownReasons = new Set(upstreamReasons);
  const groups: Record<string, string[]> = {};
  for (const [name, value] of entries) {
    const reasons = stringArray(value);
    if (!eventShapes["upstream.request"][name] || reasons.length === 0) {
      throw new Error("Invalid observability contract");
    }
    if (reasons.some((reason) => !knownReasons.has(reason))) {
      throw new Error("Invalid observability contract");
    }
    groups[name] = reasons;
  }
  return groups;
}

function loadValidationRules(
  value: unknown,
  eventShapes: Contract["eventShapes"],
  upstreamReasons: readonly string[],
  upstreamOutcomes: readonly string[],
): ValidationRules {
  const root = requiredRecord(value);
  const cacheRead = requiredRecord(root.cacheRead);
  const cacheRefresh = requiredRecord(root.cacheRefresh);
  const hardExpire = requiredRecord(cacheRefresh.hardExpire);
  const hardExpireReason = typeof hardExpire.requiredReason === "string" ? hardExpire.requiredReason : "";
  if (!hardExpireReason) throw new Error("Invalid observability contract");
  return {
    numeric: loadNumericRules(root.numeric),
    upstreamStatus: loadStatusRules(root.upstreamStatus, upstreamOutcomes),
    authProbe: loadAuthProbe(cacheRead.authProbe),
    hardExpireReason,
    upstreamReasonGroups: loadReasonGroups(root.upstreamReasons, eventShapes, upstreamReasons),
  };
}

export function validateContract(value: unknown): Contract {
  const root = requiredRecord(value);
  const catalog = loadContractCatalog(root);
  const eventShapes = loadEventShapes(root.eventShapes);
  validateOutcomeCoverage(eventShapes, catalog);
  const validationRules = loadValidationRules(
    root.validationRules,
    eventShapes,
    catalog.upstreamReasons,
    catalog.upstreamOutcomes,
  );
  return {
    ...catalog,
    upstreamRoutes: loadRoutes(root.upstreamRoutes, catalog.upstreamServices),
    eventShapes,
    ...validationRules,
  };
}

function loadContract(): Contract {
  return validateContract(parseContractRoot(readContractRaw()));
}

export function getContract(): Contract {
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
  if (
    requiredFor.includes(value.outcome) &&
    (!hasStatus || !validField(value, "status", "upstream.request", contract))
  ) {
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
