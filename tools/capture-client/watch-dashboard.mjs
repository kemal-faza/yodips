#!/usr/bin/env node
// Passively watches an authenticated Chrome tab over CDP. The user performs
// cold/warm starts manually; this process only observes navigation and the six
// dashboard slice responses. It never clicks, navigates, or stores response
// bodies, cookies, or tokens.
import { appendFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import {
  classifySlicePath,
  disconnectFromCDP,
  normalizeDashboardPath,
  summarizeSliceEvents,
  validateHttpUrl,
} from './benchmark-dashboard.mjs';

const DEFAULT_SETTLE_MS = 5_000;

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args) {
  return {
    appUrl: argument(args, '--app-url'),
    cdp: argument(args, '--cdp') ?? 'http://127.0.0.1:9223',
    dashboardPath: argument(args, '--dashboard-path') ?? '/',
    output: argument(args, '--output'),
    settleMs: Number(argument(args, '--settle') ?? DEFAULT_SETTLE_MS),
  };
}

export function summarizeWatchCycle(cycle) {
  const slices = summarizeSliceEvents(cycle.events);
  return {
    schemaVersion: 3,
    observedAt: new Date().toISOString(),
    cycle: cycle.number,
    label: cycle.number === 1 ? 'cold-start' : 'warm-start',
    trigger: cycle.trigger,
    startedAt: new Date(cycle.startedAt).toISOString(),
    durationMs: slices.lastSliceMs,
    slices,
  };
}

function usage() {
  return 'Usage: node watch-dashboard.mjs --app-url <spaUrl> [--cdp <url>] [--dashboard-path /] [--settle 5000] [--output report.jsonl]';
}

function responseBytes(response) {
  const contentLength = Number(response.headers()['content-length']);
  return Number.isSafeInteger(contentLength) && contentLength >= 0
    ? Promise.resolve(contentLength)
    : response.body().then((body) => body.byteLength).catch(() => null);
}

function isDashboardUrl(rawUrl, appOrigin, dashboardPath) {
  try {
    const url = new URL(rawUrl);
    return url.origin === appOrigin && url.pathname === dashboardPath;
  } catch {
    return false;
  }
}

/** Attach passive observation to all current and future pages in a context. */
export function attachDashboardWatcher(context, options, onCycle) {
  const states = new Map();
  let cycleNumber = 0;

  const emit = (cycle) => onCycle(summarizeWatchCycle(cycle));

  const finish = (page, reason = 'settled') => {
    const state = states.get(page);
    if (!state) return;
    clearTimeout(state.timer);
    states.delete(page);
    state.cycle.finishReason = reason;
    emit(state.cycle);
  };

  const scheduleFinish = (page) => {
    const state = states.get(page);
    if (!state) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => finish(page), options.settleMs);
  };

  const start = (page, trigger) => {
    if (states.has(page)) finish(page, 'superseded');
    const cycle = { number: ++cycleNumber, trigger, startedAt: Date.now(), events: [] };
    states.set(page, { cycle, timer: null });
    scheduleFinish(page);
  };

  const listeners = new Map();
  const attachPage = (page) => {
    if (listeners.has(page)) return;
    const onNavigated = (frame) => {
      if (frame === page.mainFrame() && isDashboardUrl(page.url(), options.appOrigin, options.dashboardPath)) {
        start(page, 'navigation');
      }
    };
    const onResponse = async (response) => {
      const slice = classifySlicePath(response.url());
      if (!slice || !isDashboardUrl(page.url(), options.appOrigin, options.dashboardPath)) return;
      if (!states.has(page)) start(page, 'slice-response');
      const state = states.get(page);
      if (!state) return;
      state.cycle.events.push({
        slice,
        path: new URL(response.url()).pathname,
        status: response.status(),
        responseBytes: await responseBytes(response),
        elapsedMs: Date.now() - state.cycle.startedAt,
      });
      scheduleFinish(page);
      if (summarizeSliceEvents(state.cycle.events).allSlicesComplete) finish(page, 'all-slices-complete');
    };
    const onClose = () => finish(page, 'page-closed');
    page.on('framenavigated', onNavigated);
    page.on('response', onResponse);
    page.on('close', onClose);
    listeners.set(page, { onNavigated, onResponse, onClose });
  };

  for (const page of context.pages()) attachPage(page);
  const onPage = (page) => attachPage(page);
  context.on('page', onPage);

  return {
    stop() {
      context.off('page', onPage);
      for (const [page, handlers] of listeners) {
        page.off('framenavigated', handlers.onNavigated);
        page.off('response', handlers.onResponse);
        page.off('close', handlers.onClose);
        finish(page, 'watcher-stopped');
      }
      listeners.clear();
    },
  };
}

async function main(options) {
  const appOrigin = validateHttpUrl(options.appUrl);
  const dashboardPath = normalizeDashboardPath(options.dashboardPath);
  if (!appOrigin || !dashboardPath || !Number.isSafeInteger(options.settleMs) || options.settleMs < 1_000) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const browser = await chromium.connectOverCDP(options.cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error('no browser context available');
  if (options.output) writeFileSync(options.output, '', { encoding: 'utf8', mode: 0o600 });
  const watcher = attachDashboardWatcher(context, { appOrigin, dashboardPath, settleMs: options.settleMs }, (report) => {
    const line = JSON.stringify(report);
    console.log(line);
    if (options.output) appendFileSync(options.output, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  });

  console.log(`Watching ${appOrigin}${dashboardPath}. Perform cold start, then warm start in Chrome; press Ctrl-C when done.`);
  await new Promise((resolve) => {
    const stop = () => {
      watcher.stop();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await disconnectFromCDP(browser);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseOptions(process.argv.slice(2));
  if (!options.appUrl) {
    console.error(usage());
    process.exit(2);
  }
  main(options).catch(() => {
    console.error('Dashboard watcher failed. Check the CDP endpoint, authenticated browser context, and dashboard URL.');
    process.exit(1);
  });
}
