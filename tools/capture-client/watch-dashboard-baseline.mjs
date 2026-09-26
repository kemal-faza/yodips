#!/usr/bin/env node
// Captures one cold/warm/first-post-login Dashboard baseline without driving the browser.
// Backend telemetry supplies cache/upstream counts; optional CDP observation supplies
// useful-content timing and browser response bytes. Bodies, cookies, JWTs, and PII are
// never written to the report.
import {
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { chromium } from "playwright-core";
import {
  classifySlicePath,
  disconnectFromCDP,
  normalizeDashboardPath,
  summarizeSliceEvents,
  validateHttpUrl,
} from "./benchmark-dashboard.mjs";
import {
  PRIMARY_CACHES,
  summarizeDashboardCycle,
} from "./watch-dashboard-log.mjs";
import { extractTelemetryEvent } from "../telemetry/telemetry-event.mjs";

const SCENARIOS = new Set(["first-post-login", "cold-reload", "warm-reload"]);
const USEFUL_SELECTORS = [
  '[data-test="greeting"]',
  '[data-test="siap-empty"]',
];

export function validateScenario(value) {
  if (!SCENARIOS.has(value)) throw new Error("invalid scenario");
  return value;
}

export function summarizeBrowserCycle(cycle) {
  const slices = summarizeSliceEvents(cycle.events);
  const knownBytes = cycle.events
    .map((event) => event.responseBytes)
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  const responseBytesComplete = cycle.events.length > 0 && knownBytes.length === cycle.events.length;
  const missingMetrics = [];
  if (!cycle.usefulContent) missingMetrics.push("timeToUsefulContentMs");
  if (!responseBytesComplete) missingMetrics.push("responseBytes");
  return {
    available: true,
    complete: slices.allSlicesComplete,
    captureComplete: slices.allSlicesComplete && missingMetrics.length === 0,
    missingMetrics,
    startedAt: new Date(cycle.startedAt).toISOString(),
    usefulContent: cycle.usefulContent ?? null,
    timeToUsefulContentMs: cycle.usefulContent?.elapsedMs ?? null,
    timeToCompleteMs: slices.allSlicesComplete ? slices.lastSliceMs : null,
    requestCount: slices.requestCount,
    responseBytesTotal: knownBytes.length ? knownBytes.reduce((sum, value) => sum + value, 0) : null,
    responseBytesKnownCount: knownBytes.length,
    responseBytesComplete,
    slices,
  };
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args) {
  const options = {
    timeoutMs: Number(argument(args, "--timeout") ?? 120_000),
    settleMs: Number(argument(args, "--settle") ?? 500),
    manualUseful: args.includes("--manual-useful"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--log") options.log = args[++index];
    else if (value === "--scenario") options.scenario = args[++index];
    else if (value === "--app-url") options.appUrl = args[++index];
    else if (value === "--cdp") options.cdp = args[++index];
    else if (value === "--dashboard-path") options.dashboardPath = args[++index];
    else if (value === "--timeout") options.timeoutMs = Number(args[++index]);
    else if (value === "--settle") options.settleMs = Number(args[++index]);
    else if (value === "--output") options.output = args[++index];
    else if (value === "--manual-useful") continue;
    else throw new Error("unknown option");
  }
  if (!options.log) throw new Error("missing log path");
  validateScenario(options.scenario);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 600_000)
    throw new Error("invalid timeout");
  if (!Number.isSafeInteger(options.settleMs) || options.settleMs < 0 || options.settleMs > 10_000)
    throw new Error("invalid settle window");
  if (options.appUrl && !validateHttpUrl(options.appUrl)) throw new Error("invalid app URL");
  if (options.dashboardPath && !normalizeDashboardPath(options.dashboardPath)) throw new Error("invalid dashboard path");
  if (options.cdp && !options.appUrl) throw new Error("app URL is required with CDP");
  return options;
}

function usage() {
  return [
    "Usage: node watch-dashboard-baseline.mjs --log <backend.log> --scenario <first-post-login|cold-reload|warm-reload>",
    "       [--app-url <spaUrl> --cdp <cdpUrl>] [--manual-useful]",
    "       [--dashboard-path /] [--timeout 120000] [--settle 500] [--output report.json]",
  ].join("\n");
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

function isPrimaryRead(event) {
  return event.event === "cache.read" && PRIMARY_CACHES.includes(event.cache);
}

/** Start a passive backend-log cycle tracker; it begins at the current EOF. */
export function startBackendCycleWatcher(options) {
  if (!existsSync(options.log)) throw new Error("log file does not exist");
  const state = { log: options.log, offset: statSync(options.log).size, pending: "" };
  let active = null;
  let settleTimer = null;
  let timeoutTimer = null;
  let stopped = false;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  const cleanup = () => {
    clearInterval(poll);
    if (settleTimer) clearTimeout(settleTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    resolveResult(active ? summarizeDashboardCycle(active.events) : {
      schemaVersion: 1,
      complete: false,
      success: false,
      missingSlices: [...PRIMARY_CACHES],
      missingRefreshes: [],
      upstream: { count: 0, byOperation: {}, byOutcome: {}, courseContentCount: 0 },
    });
  };
  const scheduleFinish = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(finish, options.settleMs);
  };
  timeoutTimer = setTimeout(finish, options.timeoutMs);
  const poll = setInterval(() => {
    for (const line of readNewLines(state)) {
      const event = extractTelemetryEvent(line);
      if (!event) continue;
      if (!active) {
        if (!isPrimaryRead(event)) continue;
        active = { events: [] };
      }
      active.events.push(event);
      if (summarizeDashboardCycle(active.events).complete) scheduleFinish();
    }
  }, 100);
  return { promise: result, stop: finish };
}

function responseBytes(response) {
  const contentLength = Number(response.headers()["content-length"]);
  if (Number.isSafeInteger(contentLength) && contentLength >= 0) return Promise.resolve(contentLength);
  // Do not await response.body() here. CDP can leave streamed/chunked bodies
  // pending indefinitely, which would keep a one-shot capture alive after the
  // backend cycle has completed. Unknown sizes are reported as unavailable.
  return Promise.resolve(null);
}

function isDashboardUrl(rawUrl, origin, path) {
  try {
    const url = new URL(rawUrl);
    return url.origin === origin && url.pathname === path;
  } catch {
    return false;
  }
}

async function usefulContent(page, timeoutMs) {
  const candidates = USEFUL_SELECTORS.map(async (selector) => {
    await page.locator(selector).waitFor({ state: "visible", timeout: timeoutMs });
    return selector;
  });
  try {
    const selector = await Promise.any(candidates);
    return { selector, elapsedMs: null };
  } catch {
    return null;
  }
}

/** Observe the next Dashboard navigation/response cycle without driving Chrome. */
export function startBrowserCycleWatcher(context, options) {
  let cycle = null;
  let stopped = false;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const listeners = new Map();
  let timeoutTimer;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeoutTimer);
    if (cycle?.settleTimer) clearTimeout(cycle.settleTimer);
    for (const [page, handlers] of listeners) {
      page.off("framenavigated", handlers.onNavigated);
      page.off("response", handlers.onResponse);
      page.off("close", handlers.onClose);
    }
    context.off("page", onPage);
    resolveResult(cycle ? summarizeBrowserCycle(cycle) : {
      available: true,
      complete: false,
      captureComplete: false,
      missingMetrics: ["dashboardCycle"],
      usefulContent: null,
      timeToUsefulContentMs: null,
      timeToCompleteMs: null,
      requestCount: 0,
      responseBytesTotal: null,
      responseBytesKnownCount: 0,
      responseBytesComplete: false,
      slices: summarizeSliceEvents([]),
    });
  };
  const scheduleFinish = () => {
    if (!cycle || cycle.settleTimer) return;
    cycle.settleTimer = setTimeout(finish, options.settleMs);
  };
  const start = (page) => {
    if (cycle || !isDashboardUrl(page.url(), options.appOrigin, options.dashboardPath)) return;
    cycle = {
      page,
      startedAt: Date.now(),
      events: [],
      usefulContent: null,
      usefulContentSettled: false,
      settleTimer: null,
    };
    usefulContent(page, options.timeoutMs).then((value) => {
      if (!cycle || cycle.page !== page) return;
      cycle.usefulContentSettled = true;
      if (value) cycle.usefulContent = { selector: value.selector, elapsedMs: Date.now() - cycle.startedAt };
      if (summarizeSliceEvents(cycle.events).allSlicesComplete) scheduleFinish();
    });
    timeoutTimer = setTimeout(finish, options.timeoutMs);
  };
  const onPage = (page) => attachPage(page);
  const attachPage = (page) => {
    if (listeners.has(page)) return;
    const onNavigated = (frame) => {
      if (frame === page.mainFrame()) start(page);
    };
    const onResponse = async (response) => {
      if (stopped) return;
      const slice = classifySlicePath(response.url());
      if (!slice) return;
      // A login flow can fetch the first Dashboard slices before the SPA
      // updates the URL from /login to /. These endpoint paths are scoped to
      // this app and are sufficient to identify the observed Dashboard cycle.
      start(page);
      if (!cycle || cycle.page !== page) return;
      cycle.events.push({
        slice,
        path: new URL(response.url()).pathname,
        status: response.status(),
        responseBytes: await responseBytes(response),
        elapsedMs: Date.now() - cycle.startedAt,
      });
      if (summarizeSliceEvents(cycle.events).allSlicesComplete) scheduleFinish();
    };
    const onClose = () => {
      if (cycle?.page === page) finish();
    };
    page.on("framenavigated", onNavigated);
    page.on("response", onResponse);
    page.on("close", onClose);
    listeners.set(page, { onNavigated, onResponse, onClose });
    // If the watcher attaches after the SPA already reached Dashboard, begin
    // collecting the next slice responses (for example, a warm reload).
    start(page);
  };
  for (const page of context.pages()) attachPage(page);
  context.on("page", onPage);
  return { promise: result, stop: finish };
}

async function manualUsefulContent(timeoutMs) {
  if (!process.stdin.isTTY) return null;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const startedAt = Date.now();
  let timeoutId;
  const input = new Promise((resolve) => readline.question(
    "Perform the scenario manually. Press Enter when useful Dashboard content is visible: ",
    () => resolve(Date.now() - startedAt),
  ));
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });
  const value = await Promise.race([input, timeout]);
  clearTimeout(timeoutId);
  readline.close();
  return value;
}

function writeReport(report, output) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    writeFileSync(output, serialized, { encoding: "utf8", mode: 0o600 });
    chmodSync(output, 0o600);
  } else process.stdout.write(serialized);
}

function unavailableBrowserReport(manualUsefulContentMs, browserUnavailable) {
  return {
    available: false,
    complete: false,
    captureComplete: false,
    missingMetrics: ["dashboardCycle", "timeToUsefulContentMs", "responseBytes"],
    timeToUsefulContentMs: manualUsefulContentMs,
    timeToCompleteMs: null,
    responseBytesTotal: null,
    responseBytesKnownCount: 0,
    responseBytesComplete: false,
    manualUsefulContentMs,
    unavailableReason: browserUnavailable ?? "cdp-not-configured",
  };
}

/** Build the report while keeping backend-only captures explicitly partial. */
export function buildBaselineReport({
  scenario,
  startedAt,
  backend,
  browserReport,
  manualUsefulContentMs = null,
  browserUnavailable = null,
}) {
  return {
    schemaVersion: 1,
    scenario: validateScenario(scenario),
    complete: backend.complete && Boolean(browserReport?.captureComplete),
    backendComplete: backend.complete,
    observedAt: new Date().toISOString(),
    watcherStartedAt: new Date(startedAt).toISOString(),
    backend,
    browser: browserReport ?? unavailableBrowserReport(manualUsefulContentMs, browserUnavailable),
    notes: [
      "Backend metrics start at the first primary cache.read after the watcher reaches EOF; login/redirect probes before that are excluded.",
      "CDP is required for browser useful-content timing and response bytes. --manual-useful records only a user-entered useful-content marker when CDP is unavailable.",
      "The watcher is passive: it does not navigate, click, read credentials, retain cookies/JWTs, or persist response bodies.",
      "complete is true only when the backend cycle, all six browser slices, useful-content timing, and every browser response byte count are available.",
    ],
  };
}

export async function runBaseline(options) {
  const scenario = validateScenario(options.scenario);
  const startedAt = Date.now();
  const backendWatcher = startBackendCycleWatcher(options);
  let browserWatcher = null;
  let browser = null;
  let browserUnavailable = null;
  if (options.appUrl && options.cdp) {
    try {
      browser = await chromium.connectOverCDP(options.cdp);
      const context = browser.contexts()[0];
      if (!context) throw new Error("no browser context");
      browserWatcher = startBrowserCycleWatcher(context, {
        appOrigin: validateHttpUrl(options.appUrl),
        dashboardPath: normalizeDashboardPath(options.dashboardPath ?? "/"),
        timeoutMs: options.timeoutMs,
      });
    } catch {
      browserUnavailable = "cdp-unavailable";
    }
  }
  const manualUseful = !browserWatcher && options.manualUseful
    ? manualUsefulContent(options.timeoutMs)
    : Promise.resolve(null);
  const [backend, browserReport, manualUsefulContentMs] = await Promise.all([
    backendWatcher.promise,
    browserWatcher?.promise ?? Promise.resolve(null),
    manualUseful,
  ]);
  browserWatcher?.stop();
  if (browser) await disconnectFromCDP(browser);
  return buildBaselineReport({
    scenario,
    startedAt,
    backend,
    browserReport: browserReport ?? unavailableBrowserReport(manualUsefulContentMs, browserUnavailable),
    manualUsefulContentMs,
    browserUnavailable,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseOptions(process.argv.slice(2));
    process.stderr.write("Watching one Dashboard baseline cycle; perform the scenario manually.\n");
    const report = await runBaseline(options);
    writeReport(report, options.output);
  } catch {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
  }
}
