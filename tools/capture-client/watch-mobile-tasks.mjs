#!/usr/bin/env node

import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { extractTelemetryEvent } from "../telemetry/telemetry-event.mjs";

export const MOBILE_TASK_PATHS = Object.freeze([
  "/api/kulon/courses",
  "/api/kulon/assignments/all",
]);
export const TASK_LIST_PATH = "/api/kulon/assignments/all";

export function parseMobileTaskLogLine(line) {
  const match = line.match(/YODIPS_MOBILE_PERF(?:\([^)]*\))?:\s+(\{.*\})\s*$/);
  if (!match) return null;
  try {
    const event = JSON.parse(match[1]);
    if (
      event?.event !== "mobile.http" ||
      !MOBILE_TASK_PATHS.includes(event.path) ||
      !Number.isSafeInteger(event.ts) ||
      !Number.isSafeInteger(event.durationMs) ||
      event.durationMs < 0
    ) return null;
    return {
      ts: event.ts,
      method: "GET",
      path: event.path,
      outcome: event.outcome === "ok" ? "ok" : "error",
      status: Number.isSafeInteger(event.status) ? event.status : null,
      durationMs: event.durationMs,
      responseBytes:
        Number.isSafeInteger(event.responseBytes) && event.responseBytes >= 0
          ? event.responseBytes
          : null,
    };
  } catch {
    return null;
  }
}

export function summarizeMobileTaskCycle(events, options = {}) {
  const ordered = [...events].sort((left, right) => left.ts - right.ts);
  const firstTs = ordered[0]?.ts ?? null;
  const lastTs = ordered.at(-1)?.ts ?? null;
  const knownBytes = ordered.filter((event) => event.responseBytes !== null);
  const byPath = Object.fromEntries(
    MOBILE_TASK_PATHS.map((path) => [path, ordered.filter((event) => event.path === path)]),
  );
  const missingSlices = MOBILE_TASK_PATHS.filter((path) => byPath[path].length === 0);
  const taskList = byPath[TASK_LIST_PATH];
  const successfulTaskList = taskList.find((event) => event.outcome === "ok" && event.status >= 200 && event.status < 300);
  return {
    schemaVersion: 1,
    scenario: options.scenario ?? null,
    deviceId: options.deviceId ?? null,
    packageName: options.packageName ?? "ac.undip.sso",
    startedAt: firstTs === null ? null : new Date(firstTs).toISOString(),
    completedAt: lastTs === null ? null : new Date(lastTs).toISOString(),
    durationMs: firstTs === null || lastTs === null ? null : lastTs - firstTs,
    complete: Boolean(successfulTaskList),
    taskListObserved: Boolean(taskList.length),
    taskListSucceeded: Boolean(successfulTaskList),
    missingSlices,
    requestCount: ordered.length,
    uniqueSliceCount: MOBILE_TASK_PATHS.length - missingSlices.length,
    duplicateRequestCount: Math.max(0, ordered.length - (MOBILE_TASK_PATHS.length - missingSlices.length)),
    timeToFirstRequestMs: firstTs === null ? null : 0,
    timeToTaskListMs: firstTs === null || !successfulTaskList ? null : successfulTaskList.ts - firstTs,
    responseBytesTotal: knownBytes.length === ordered.length
      ? knownBytes.reduce((total, event) => total + event.responseBytes, 0)
      : null,
    responseBytesKnownCount: knownBytes.length,
    requests: ordered,
    missingMetrics: [
      "timeToUsefulContentMs",
      ...(knownBytes.length === ordered.length ? [] : ["responseBytes"]),
    ],
    backend: options.backend ?? null,
    notes: [
      "Debug-only mobile telemetry records the task-list Kulon paths, status, duration, and response length.",
      "The watcher never reads credentials, authorization headers, cookies, tokens, query parameters, or response bodies.",
      "A cached courses result may produce no courses request; task-list success is the page-load completion signal.",
      "timeToUsefulContentMs is unavailable until a UI marker is added.",
    ],
  };
}

function usage() {
  return [
    "Usage: node watch-mobile-tasks.mjs --scenario <cold-start|warm-start>",
    "       --device <adb-id> [--package ac.undip.sso] [--backend-log backend.log]",
    "       [--timeout 120000] [--settle 1000] [--output report.json]",
  ].join("\n");
}

function parseOptions(argv) {
  const options = { timeoutMs: 120_000, settleMs: 1_000, packageName: "ac.undip.sso" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scenario") options.scenario = argv[++index];
    else if (argument === "--device") options.deviceId = argv[++index];
    else if (argument === "--package") options.packageName = argv[++index];
    else if (argument === "--backend-log") options.backendLog = argv[++index];
    else if (argument === "--timeout") options.timeoutMs = Number(argv[++index]);
    else if (argument === "--settle") options.settleMs = Number(argv[++index]);
    else if (argument === "--output") options.output = argv[++index];
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!["cold-start", "warm-start"].includes(options.scenario)) throw new Error("invalid --scenario");
  if (!options.deviceId) throw new Error("missing --device");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 600_000) throw new Error("invalid --timeout");
  if (!Number.isSafeInteger(options.settleMs) || options.settleMs < 0 || options.settleMs > 10_000) throw new Error("invalid --settle");
  return options;
}

function readBackendEvents(state) {
  if (!state.log || !existsSync(state.log)) return [];
  const bytes = readFileSync(state.log);
  if (bytes.length < state.offset) state.offset = 0;
  const chunk = bytes.subarray(state.offset).toString("utf8");
  state.offset = bytes.length;
  state.pending += chunk;
  const lines = state.pending.split(/\r\n|\n|\r/);
  state.pending = lines.pop() ?? "";
  return lines.map(extractTelemetryEvent).filter(Boolean);
}

function summarizeBackend(events, firstTs, lastTs) {
  if (firstTs === null || lastTs === null) return null;
  const window = events.filter((event) => {
    const timestamp = Date.parse(event.ts ?? "");
    return Number.isFinite(timestamp) && timestamp >= firstTs - 1_000 && timestamp <= lastTs + 1_000;
  });
  const upstreamByOperation = {};
  const upstreamByOutcome = {};
  let upstreamCount = 0;
  for (const event of window) {
    if (event.event !== "upstream.request") continue;
    upstreamCount += 1;
    const operation = typeof event.operation === "string" ? event.operation : "unknown";
    const outcome = typeof event.outcome === "string" ? event.outcome : "unknown";
    upstreamByOperation[operation] = (upstreamByOperation[operation] ?? 0) + 1;
    upstreamByOutcome[outcome] = (upstreamByOutcome[outcome] ?? 0) + 1;
  }
  return { eventCount: window.length, upstreamCount, upstreamByOperation, upstreamByOutcome };
}

export async function watchMobileTasks(options) {
  const backendState = options.backendLog && existsSync(options.backendLog)
    ? { log: options.backendLog, offset: statSync(options.backendLog).size, pending: "" }
    : null;
  const backendEvents = [];
  const mobileEvents = [];
  const startedAt = Date.now();
  let settleTimer = null;
  let timeoutTimer = null;
  let finished = false;
  let resolveFinished;
  let rejectFinished;
  const finishedPromise = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const adb = spawn("adb", ["-s", options.deviceId, "logcat", "-v", "threadtime", "-T", "1", "YODIPS_MOBILE_PERF:I", "*:S"], { stdio: ["ignore", "pipe", "ignore"] });
  const finish = () => {
    if (finished) return;
    finished = true;
    if (settleTimer) clearTimeout(settleTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (!adb.killed) adb.kill("SIGTERM");
    if (backendState) backendEvents.push(...readBackendEvents(backendState));
    const firstTs = mobileEvents[0]?.ts ?? null;
    const lastTs = mobileEvents.at(-1)?.ts ?? null;
    const report = summarizeMobileTaskCycle(mobileEvents, {
      scenario: options.scenario,
      deviceId: options.deviceId,
      packageName: options.packageName,
      backend: summarizeBackend(backendEvents, firstTs, lastTs),
    });
    report.timedOut = !report.taskListObserved;
    if (options.output) {
      writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      chmodSync(options.output, 0o600);
    } else {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    }
    resolveFinished(report);
  };
  const pollBackend = setInterval(() => {
    if (backendState) backendEvents.push(...readBackendEvents(backendState));
  }, 100);
  const onLine = (line) => {
    const event = parseMobileTaskLogLine(line);
    if (!event || event.ts < startedAt - 1_000) return;
    mobileEvents.push(event);
    if (event.path === TASK_LIST_PATH && !settleTimer) {
      settleTimer = setTimeout(finish, options.settleMs);
    }
  };
  let logcatPending = "";
  const onData = (chunk) => {
    logcatPending += chunk.toString("utf8");
    const lines = logcatPending.split(/\r?\n/);
    logcatPending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
  adb.stdout.on("data", onData);
  adb.once("error", (error) => {
    if (!finished) {
      finished = true;
      clearInterval(pollBackend);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      rejectFinished(error);
    }
  });
  timeoutTimer = setTimeout(finish, options.timeoutMs);
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
  const report = await finishedPromise;
  clearInterval(pollBackend);
  process.removeListener("SIGINT", finish);
  process.removeListener("SIGTERM", finish);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseOptions(process.argv.slice(2));
    process.stdout.write("Watching one mobile Tugas load; navigate to Tugas manually.\n");
    await watchMobileTasks(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 2;
  }
}
