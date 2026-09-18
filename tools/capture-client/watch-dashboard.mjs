#!/usr/bin/env node
// Continuously validates the slice-aware dashboard in an already authenticated
// Chrome session. It records JSONL summaries only; credentials and response
// bodies never leave the browser.
import { appendFileSync, writeFileSync } from 'node:fs';
import { runBenchmark } from './benchmark-dashboard.mjs';

const DEFAULT_INTERVAL_MS = 30_000;

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args) {
  return {
    appUrl: argument(args, '--app-url'),
    cdp: argument(args, '--cdp') ?? 'http://127.0.0.1:9223',
    dashboardPath: argument(args, '--dashboard-path') ?? '/',
    intervalMs: Number(argument(args, '--interval') ?? DEFAULT_INTERVAL_MS),
    iterations: Number(argument(args, '--iterations') ?? 0),
    output: argument(args, '--output'),
    timeoutMs: Number(argument(args, '--timeout') ?? 30_000),
  };
}

export function summarizeWatchReport(report) {
  const cold = report.scenarios.find((scenario) => scenario.scenario === 'cold-reload');
  const warm = report.scenarios.find((scenario) => scenario.scenario === 'warm-reload');
  const routes = report.scenarios.find((scenario) => scenario.scenario === 'route-reuse')?.routes;
  const routeChecks = routes
    ? [routes.dashboardToProfile, routes.profileToDashboard, routes.dashboardToKulon]
    : [];
  return {
    measuredAt: report.measuredAt,
    ok: Boolean(
      cold?.slices.allSlicesComplete &&
      warm?.slices.allSlicesComplete &&
      routeChecks.length === 3 &&
      routeChecks.every((check) => check.reusedWithoutNetwork),
    ),
    cold: cold?.slices ?? null,
    warm: warm?.slices ?? null,
    routeReuse: routes ?? null,
  };
}

function usage() {
  return 'Usage: node watch-dashboard.mjs --app-url <spaUrl> [--cdp <url>] [--interval 30000] [--iterations 0] [--output report.jsonl]';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(options) {
  if (!options.appUrl || !Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1_000 ||
      !Number.isSafeInteger(options.iterations) || options.iterations < 0) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.output) writeFileSync(options.output, '', { encoding: 'utf8', mode: 0o600 });
  let run = 0;
  while (options.iterations === 0 || run < options.iterations) {
    run += 1;
    let entry;
    try {
      const report = await runBenchmark({
        appUrl: options.appUrl,
        cdp: options.cdp,
        dashboardPath: options.dashboardPath,
        scenario: 'all',
        timeoutMs: options.timeoutMs,
      });
      entry = { run, ...summarizeWatchReport(report) };
      console.log(JSON.stringify(entry));
    } catch {
      entry = { run, measuredAt: new Date().toISOString(), ok: false, error: 'dashboard check failed' };
      console.error(JSON.stringify(entry));
    }
    if (options.output) appendFileSync(options.output, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (options.iterations !== 0 && run >= options.iterations) break;
    await delay(options.intervalMs);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(parseOptions(process.argv.slice(2)));
}
