#!/usr/bin/env node
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extractTelemetryEvent } from "./manual-dashboard-baseline.mjs";

export { extractTelemetryEvent };

export const PRIMARY_CACHES = Object.freeze([
  "siap.profile",
  "siap.khs",
  "siap.irs",
  "siap.jadwal",
  "kulon.courses",
  "kulon.assignments_all",
]);

const FRESH_READS = new Set(["fresh", "hit"]);
const REFRESH_NEEDED_READS = new Set(["miss", "stale", "expired"]);
const TERMINAL_REFRESHES = new Set(["ok", "error", "hard_expire"]);

function usage() {
  return [
    "Usage: node watch-dashboard-log.mjs --log <backend.log>",
    "       [--timeout 120000] [--settle 500] [--output report.jsonl]",
  ].join("\n");
}

function parseOptions(argv) {
  const options = { timeoutMs: 120_000, settleMs: 500 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--log") options.log = argv[++index];
    else if (argument === "--timeout") options.timeoutMs = Number(argv[++index]);
    else if (argument === "--settle") options.settleMs = Number(argv[++index]);
    else if (argument === "--output") options.output = argv[++index];
    else throw new Error("unknown option");
  }
  if (!options.log) throw new Error("missing log path");
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 600_000
  ) throw new Error("invalid timeout");
  if (
    !Number.isSafeInteger(options.settleMs) ||
    options.settleMs < 0 ||
    options.settleMs > 10_000
  ) throw new Error("invalid settle window");
  return options;
}

function numberOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function eventTime(event) {
  if (typeof event.ts !== "string") return null;
  const timestamp = Date.parse(event.ts);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function eventSummary(event) {
  return {
    outcome: typeof event.outcome === "string" ? event.outcome : "unknown",
    status: numberOrNull(event.status),
    durationMs: numberOrNull(event.durationMs),
    reason: typeof event.reason === "string" ? event.reason : null,
    ts: typeof event.ts === "string" ? event.ts : null,
  };
}

function orderedObject(values) {
  return Object.fromEntries(
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function deduplicateAdjacentEvents(events) {
  const unique = [];
  let previous = null;
  for (const event of events) {
    const fingerprint = JSON.stringify(event);
    if (fingerprint === previous) continue;
    unique.push(event);
    previous = fingerprint;
  }
  return unique;
}

/** Summarize one six-slice cache cycle without retaining identifiers or bodies. */
export function summarizeDashboardCycle(events) {
  events = deduplicateAdjacentEvents(events);
  const reads = {};
  const refreshes = {};
  const upstreamByOperation = {};
  const upstreamByOutcome = {};
  let upstreamCount = 0;
  let courseContentCount = 0;
  const timestamps = events.map(eventTime).filter((value) => value !== null);

  for (const event of events) {
    if (
      event.event === "cache.read" &&
      PRIMARY_CACHES.includes(event.cache) &&
      !reads[event.cache]
    ) {
      reads[event.cache] = eventSummary(event);
    }
    if (
      event.event === "cache.refresh" &&
      PRIMARY_CACHES.includes(event.cache) &&
      TERMINAL_REFRESHES.has(event.outcome) &&
      !refreshes[event.cache]
    ) {
      refreshes[event.cache] = eventSummary(event);
    }
    if (event.event !== "upstream.request") continue;
    upstreamCount += 1;
    const operation = typeof event.operation === "string" ? event.operation : "unknown";
    const outcome = typeof event.outcome === "string" ? event.outcome : "unknown";
    upstreamByOperation[operation] = (upstreamByOperation[operation] ?? 0) + 1;
    upstreamByOutcome[outcome] = (upstreamByOutcome[outcome] ?? 0) + 1;
    if (operation === "course_content") courseContentCount += 1;
  }

  const missingSlices = PRIMARY_CACHES.filter((cache) => !reads[cache]);
  const requiredRefreshes = PRIMARY_CACHES.filter((cache) => {
    const outcome = reads[cache]?.outcome;
    return !FRESH_READS.has(outcome);
  });
  const missingRefreshes = requiredRefreshes.filter((cache) => !refreshes[cache]);
  const allReads = missingSlices.length === 0;
  const complete = allReads && missingRefreshes.length === 0;
  const outcomes = PRIMARY_CACHES.map((cache) => reads[cache]?.outcome);
  const isWarm = allReads && outcomes.every((outcome) => FRESH_READS.has(outcome));
  const isCold = allReads && outcomes.every((outcome) => REFRESH_NEEDED_READS.has(outcome));
  const classification = isWarm
    ? "warm-start"
    : isCold
      ? "cold-start"
      : "mixed-start";
  const success = complete && requiredRefreshes.every(
    (cache) => refreshes[cache]?.outcome === "ok",
  );
  const firstAt = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const lastAt = timestamps.length > 0 ? Math.max(...timestamps) : null;

  return {
    schemaVersion: 1,
    classification,
    complete,
    success,
    startedAt: firstAt === null ? null : new Date(firstAt).toISOString(),
    completedAt: lastAt === null ? null : new Date(lastAt).toISOString(),
    durationMs: firstAt === null || lastAt === null ? null : lastAt - firstAt,
    missingSlices,
    missingRefreshes,
    slices: PRIMARY_CACHES.map((cache) => ({
      cache,
      read: reads[cache] ?? null,
      refresh: refreshes[cache] ?? null,
    })),
    cache: {
      reads: orderedObject(reads),
      refreshes: orderedObject(refreshes),
    },
    upstream: {
      count: upstreamCount,
      byOperation: orderedObject(upstreamByOperation),
      byOutcome: orderedObject(upstreamByOutcome),
      courseContentCount,
    },
    notes: [
      "Cache label kulon.courses covers both public and Dashboard summary service paths; courseContentCount verifies whether progress scraping occurred.",
      "The watcher stores only low-cardinality telemetry fields; identifiers, credentials, cookies, JWTs, and response bodies are discarded.",
    ],
  };
}

function readNewLines(state) {
  if (!existsSync(state.log)) return [];
  const bytes = readFileSync(state.log);
  if (bytes.length < state.offset) state.offset = 0;
  const chunk = bytes.subarray(state.offset).toString("utf8");
  state.offset = bytes.length;
  state.pending += chunk;
  const lines = state.pending.split(/\r\n|\n|\r/);
  state.pending = lines.pop() ?? "";
  return lines;
}

function appendReport(report, output) {
  const serialized = `${JSON.stringify(report)}\n`;
  if (!output) {
    process.stdout.write(serialized);
    return;
  }
  appendFileSync(output, serialized, { encoding: "utf8", mode: 0o600 });
  chmodSync(output, 0o600);
}

function isPrimaryRead(event) {
  return event.event === "cache.read" && PRIMARY_CACHES.includes(event.cache);
}

/** Watch a backend log until SIGINT, emitting one JSONL report per cycle. */
export async function runDashboardLogWatcher(options) {
  if (!existsSync(options.log)) throw new Error("log file does not exist");
  const state = { log: options.log, offset: statSync(options.log).size, pending: "" };
  let active = null;
  let settleTimer = null;
  let timeoutTimer = null;
  let stopped = false;
  let resolveStopped;
  const stoppedPromise = new Promise((resolve) => { resolveStopped = resolve; });

  const finish = () => {
    if (!active) return;
    if (settleTimer) clearTimeout(settleTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    appendReport(summarizeDashboardCycle(active.events), options.output);
    active = null;
    settleTimer = null;
    timeoutTimer = null;
  };

  const poll = setInterval(() => {
    for (const line of readNewLines(state)) {
      const event = extractTelemetryEvent(line);
      if (!event) continue;
      if (!active) {
        if (!isPrimaryRead(event)) continue;
        active = { events: [], startedAt: Date.now() };
        timeoutTimer = setTimeout(finish, options.timeoutMs);
      }
      active.events.push(event);
      const summary = summarizeDashboardCycle(active.events);
      if (summary.complete && !settleTimer) {
        settleTimer = setTimeout(finish, options.settleMs);
      }
    }
  }, 100);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(poll);
    if (active) finish();
    resolveStopped();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await stoppedPromise;
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseOptions(process.argv.slice(2));
    process.stderr.write("Watching backend telemetry; press Ctrl-C to finish.\n");
    await runDashboardLogWatcher(options);
  } catch {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
  }
}
