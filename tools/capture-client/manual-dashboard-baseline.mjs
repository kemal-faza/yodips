#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { extractTelemetryEvent } from "../telemetry/telemetry-event.mjs";

const DASHBOARD_ROUTE = "GET /api/dashboard";
const SCENARIOS = new Set(["first-post-login", "cold-reload", "warm-reload"]);

function usage() {
  return [
    "Usage: node manual-dashboard-baseline.mjs --log <backend.log> --scenario <first-post-login|cold-reload|warm-reload>",
    "       [--timeout 120000] [--settle 500] [--output report.json]",
  ].join("\n");
}

function parseOptions(argv) {
  const options = { timeoutMs: 120_000, settleMs: 500 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--log") options.log = argv[++index];
    else if (argument === "--scenario") options.scenario = argv[++index];
    else if (argument === "--timeout")
      options.timeoutMs = Number(argv[++index]);
    else if (argument === "--settle") options.settleMs = Number(argv[++index]);
    else if (argument === "--output") options.output = argv[++index];
    else throw new Error("unknown option");
  }
  if (!options.log || !SCENARIOS.has(options.scenario))
    throw new Error("missing or invalid log/scenario");
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 600_000
  )
    throw new Error("invalid timeout");
  if (
    !Number.isSafeInteger(options.settleMs) ||
    options.settleMs < 0 ||
    options.settleMs > 10_000
  )
    throw new Error("invalid settle window");
  return options;
}

function numeric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function summarizeUpstream(events) {
  const byRoute = {};
  for (const event of events) {
    if (event.event !== "upstream.request" || typeof event.route !== "string")
      continue;
    const key = `${event.service}.${event.operation}.${event.route}`;
    const current = byRoute[key] ?? {
      count: 0,
      durationMs: null,
      outcome: event.outcome ?? "unknown",
      status: event.status ?? null,
    };
    current.count += 1;
    current.durationMs = numeric(event.durationMs);
    current.outcome = event.outcome ?? current.outcome;
    current.status = event.status ?? current.status;
    byRoute[key] = current;
  }
  return {
    count: Object.values(byRoute).reduce(
      (total, route) => total + route.count,
      0,
    ),
    byRoute,
  };
}

export function summarizeEvents(events) {
  const dashboard = { request: null, slices: {} };
  for (const event of events) {
    if (
      event.event === "dashboard.request" &&
      event.route === DASHBOARD_ROUTE &&
      !dashboard.request
    ) {
      dashboard.request = {
        outcome: event.outcome ?? "unknown",
        status: event.status ?? null,
        durationMs: numeric(event.durationMs),
        responseBytes: numeric(event.responseBytes),
        cacheState: event.cacheState ?? "unknown",
      };
    }
    if (
      event.event === "dashboard.slice" &&
      event.route === DASHBOARD_ROUTE &&
      typeof event.slice === "string"
    ) {
      dashboard.slices[event.slice] = {
        outcome: event.outcome ?? "unknown",
        status: event.status ?? null,
        durationMs: numeric(event.durationMs),
      };
    }
  }
  return { dashboard, upstream: summarizeUpstream(events) };
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

function writeReport(report, output) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output)
    writeFileSync(output, serialized, { encoding: "utf8", mode: 0o600 });
  else process.stdout.write(serialized);
}

export async function runManualBaseline(options) {
  const startedAt = Date.now();
  const state = {
    log: options.log,
    offset: statSync(options.log).size,
    pending: "",
  };
  const events = [];
  let dashboardSeenAt = null;
  let usefulContentAt = null;
  let done;
  const completion = new Promise((resolve) => {
    done = resolve;
  });
  const readline = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const usefulPrompt = readline
    ? new Promise((resolve) => {
        readline.question(
          "Login/refresh manually. Press Enter when useful Dashboard content is visible: ",
          () => resolve(Date.now()),
        );
      })
    : Promise.resolve(null);
  usefulPrompt.then((value) => {
    usefulContentAt = value;
  });

  const poll = setInterval(() => {
    for (const line of readNewLines(state)) {
      const event = extractTelemetryEvent(line);
      if (!event) continue;
      events.push(event);
      if (
        event.event === "dashboard.request" &&
        event.route === DASHBOARD_ROUTE &&
        dashboardSeenAt === null
      ) {
        dashboardSeenAt = Date.now();
        setTimeout(() => done(), options.settleMs);
      }
    }
  }, 100);
  const timeout = setTimeout(() => done(), options.timeoutMs);
  await completion;
  clearInterval(poll);
  clearTimeout(timeout);
  readline?.close();

  const summary = summarizeEvents(events);
  const report = {
    schemaVersion: 1,
    scenario: options.scenario,
    complete: Boolean(summary.dashboard.request),
    startedAt: new Date(startedAt).toISOString(),
    wallClockUntilDashboardRequestMs:
      dashboardSeenAt === null ? null : dashboardSeenAt - startedAt,
    manualUsefulContentMs:
      usefulContentAt === null ? null : usefulContentAt - startedAt,
    dashboard: summary.dashboard,
    upstream: summary.upstream,
    notes: [
      "Manual login/redirect time is reported separately and is not compared with the <5 second dashboard target.",
      "Dashboard and upstream telemetry contain only low-cardinality metrics; credentials, cookies, JWTs, response bodies, and PII are discarded.",
      "Run against a redirected backend log file or a log captured with: npm run start:dev > /tmp/yodips-backend.log 2>&1.",
    ],
  };
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const report = await runManualBaseline(options);
    writeReport(report, options.output);
    process.exitCode = report.complete ? 0 : 1;
  } catch {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
  }
}
