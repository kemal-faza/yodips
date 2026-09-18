#!/usr/bin/env node
// Measures the slice-aware web dashboard against an already authenticated
// Chrome connected through CDP. It never prints/stores cookies, JWTs, or
// response bodies.
// Usage:
//   node benchmark-dashboard.mjs --app-url http://localhost:5173
//     [--cdp http://127.0.0.1:9223]
//     [--scenario all|first-post-login|cold-reload|warm-reload|refresh|route-reuse]
//     [--output report.json]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const DASHBOARD_PATH = '/';
const DEFAULT_TIMEOUT_MS = 30_000;
const ALL_SLICES = ['profile', 'khs', 'irs', 'jadwal', 'courses', 'assignments'];
const DYNAMIC_SLICES = ['irs', 'jadwal', 'courses', 'assignments'];
const SLICE_PATHS = Object.freeze({
  profile: '/api/siap/profile',
  khs: '/api/siap/khs',
  irs: '/api/siap/irs',
  jadwal: '/api/siap/jadwal',
  courses: '/api/kulon/courses',
  assignments: '/api/kulon/assignments/all',
});

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args) {
  return {
    appUrl: argument(args, '--app-url'),
    cdp: argument(args, '--cdp') ?? 'http://127.0.0.1:9223',
    dashboardPath: argument(args, '--dashboard-path') ?? DASHBOARD_PATH,
    output: argument(args, '--output'),
    scenario: argument(args, '--scenario') ?? 'all',
    timeoutMs: Number(argument(args, '--timeout') ?? DEFAULT_TIMEOUT_MS),
  };
}

export function validateHttpUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}` || url.origin;
}

export function normalizeDashboardPath(raw) {
  if (!raw || !raw.startsWith('/') || raw.includes('?') || raw.includes('#'))
    return null;
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(1, Math.ceil(sorted.length * p)) - 1];
}

export function classifySlicePath(rawPath) {
  const pathname = rawPath instanceof URL ? rawPath.pathname : rawPath;
  return Object.entries(SLICE_PATHS).find(([, path]) => path === pathname)?.[0] ?? null;
}

export function summarizeSliceEvents(events) {
  const bySlice = {};
  for (const event of events) {
    if (!event.slice || bySlice[event.slice]) continue;
    bySlice[event.slice] = {
      path: event.path,
      status: event.status,
      responseBytes: event.responseBytes,
      elapsedMs: event.elapsedMs,
    };
  }
  const elapsed = Object.values(bySlice)
    .map((event) => event.elapsedMs)
    .filter((value) => Number.isSafeInteger(value));
  const dynamicElapsed = DYNAMIC_SLICES
    .map((slice) => bySlice[slice]?.elapsedMs)
    .filter((value) => Number.isSafeInteger(value));
  return {
    requestCount: events.length,
    completedSlices: Object.keys(bySlice),
    missingSlices: ALL_SLICES.filter((slice) => !bySlice[slice]),
    allSlicesComplete: ALL_SLICES.every((slice) => bySlice[slice]),
    firstSliceMs: elapsed.length ? Math.min(...elapsed) : null,
    lastSliceMs: elapsed.length ? Math.max(...elapsed) : null,
    firstDynamicSliceMs: dynamicElapsed.length ? Math.min(...dynamicElapsed) : null,
    lastDynamicSliceMs: dynamicElapsed.length ? Math.max(...dynamicElapsed) : null,
    bySlice,
  };
}

/** Detach Playwright from an externally-owned browser without closing Chrome. */
export async function disconnectFromCDP(browser) {
  if (typeof browser?.disconnect === 'function') {
    await browser.disconnect();
    return;
  }
  const connection = browser?._connection;
  if (connection && typeof connection.close === 'function') {
    connection.close();
    return;
  }
  throw new Error('Playwright runtime cannot detach from the CDP browser safely');
}

function usage() {
  return 'Usage: node benchmark-dashboard.mjs --app-url <spaUrl> [--cdp <url>] [--scenario all|first-post-login|cold-reload|warm-reload|refresh|route-reuse] [--dashboard-path /] [--timeout 30000] [--output report.json]';
}

function safeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUsefulContent(page, timeoutMs) {
  const selectors = ['[data-test="greeting"]', '[data-test="siap-empty"]'];
  const candidates = selectors.map((selector) =>
    page.locator(selector)
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => selector),
  );
  try {
    return await Promise.race(candidates);
  } catch {
    return null;
  }
}

async function waitForDashboardSettled(page, timeoutMs) {
  try {
    await page.locator('[data-test="stats-loading"]')
      .waitFor({ state: 'hidden', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function attachSliceCollector(page) {
  const events = [];
  const responseHandler = async (response) => {
    const url = new URL(response.url());
    const slice = classifySlicePath(url);
    if (!slice) return;
    let responseBytes = Number(response.headers()['content-length']);
    if (!Number.isSafeInteger(responseBytes) || responseBytes < 0) {
      try {
        // Read only to count bytes; never retain or write the body.
        responseBytes = (await response.body()).byteLength;
      } catch {
        responseBytes = null;
      }
    }
    events.push({
      slice,
      path: url.pathname,
      status: response.status(),
      responseBytes,
      elapsedMs: Date.now() - collectorStartedAt,
    });
  };
  let collectorStartedAt = Date.now();
  page.on('response', responseHandler);
  return {
    events,
    markStart() {
      collectorStartedAt = Date.now();
      return events.length;
    },
    async waitFor(marker, expected, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const seen = new Set(events.slice(marker).map((event) => event.slice));
        if (expected.every((slice) => seen.has(slice))) return events.slice(marker);
        await delay(25);
      }
      return events.slice(marker);
    },
    detach() {
      page.off('response', responseHandler);
    },
  };
}

async function installRequestMarker(page, cacheState) {
  const routeHandler = async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-yodips-cache-state': cacheState,
      },
    });
  };
  await page.route('**/api/**', routeHandler);
  return async () => page.unroute('**/api/**', routeHandler);
}

async function measureDashboardLoad(context, dashboardUrl, scenario, timeoutMs, existingPage, navigation = 'goto') {
  const page = existingPage ?? await context.newPage();
  const collector = attachSliceCollector(page);
  const removeRoute = await installRequestMarker(page, scenario === 'warm-reload' ? 'warm' : 'cold');
  const startedAt = Date.now();
  const marker = collector.markStart();
  const usefulPromise = waitForUsefulContent(page, timeoutMs)
    .then((selector) => ({ selector, elapsedMs: Date.now() - startedAt }));
  try {
    if (navigation === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } else {
      await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    }
    const [useful, sliceEvents] = await Promise.all([
      usefulPromise,
      collector.waitFor(marker, ALL_SLICES, timeoutMs),
    ]);
    const dashboardSettled = await waitForDashboardSettled(page, Math.min(timeoutMs, 2_000));
    return {
      scenario,
      usefulContent: useful,
      dashboardSettled,
      slices: summarizeSliceEvents(sliceEvents),
      timeToCompleteMs: Date.now() - startedAt,
    };
  } finally {
    collector.detach();
    await removeRoute();
    if (!existingPage) await page.close();
  }
}

async function measureRefresh(page, timeoutMs) {
  const collector = attachSliceCollector(page);
  const removeRoute = await installRequestMarker(page, 'dashboard-refresh');
  const marker = collector.markStart();
  const startedAt = Date.now();
  try {
    await page.locator('[data-test="dashboard-refresh"]').click({ timeout: timeoutMs });
    const events = await collector.waitFor(marker, DYNAMIC_SLICES, timeoutMs);
    // Give an unexpected profile/KHS request a short window to appear.
    await delay(Math.min(500, timeoutMs));
    const allEvents = collector.events.slice(marker);
    const slowSliceRequests = allEvents
      .filter((event) => event.slice === 'profile' || event.slice === 'khs')
      .map((event) => event.slice);
    return {
      scenario: 'refresh',
      dynamicSlices: summarizeSliceEvents(events),
      slowSliceRequests,
      refreshedOnlyDynamic: slowSliceRequests.length === 0 &&
        DYNAMIC_SLICES.every((slice) => events.some((event) => event.slice === slice)),
      timeToCompleteMs: Date.now() - startedAt,
    };
  } finally {
    collector.detach();
    await removeRoute();
  }
}

async function waitForPath(page, suffix, timeoutMs) {
  await page.waitForFunction((expected) => window.location.pathname.endsWith(expected), suffix, { timeout: timeoutMs });
}

async function measureRouteReuse(page, timeoutMs) {
  const collector = attachSliceCollector(page);
  const removeRoute = await installRequestMarker(page, 'route-reuse');
  try {
    const profileMarker = collector.markStart();
    await page.locator('[data-test="avatar-profile"]').click({ timeout: timeoutMs });
    await waitForPath(page, '/profile', timeoutMs);
    await delay(300);
    const profileEvents = collector.events.slice(profileMarker);

    const dashboardMarker = collector.markStart();
    await page.locator('[data-test="nav-item"][data-path="/"]').click({ timeout: timeoutMs });
    await waitForPath(page, '/', timeoutMs);
    await delay(300);
    const dashboardEvents = collector.events.slice(dashboardMarker);

    const kulonMarker = collector.markStart();
    await page.locator('[data-test="nav-item"][data-path="/kulon/dashboard"]').click({ timeout: timeoutMs });
    await waitForPath(page, '/kulon/dashboard', timeoutMs);
    await delay(300);
    const kulonEvents = collector.events.slice(kulonMarker);

    const relevant = (events) => events.map((event) => event.slice);
    return {
      scenario: 'route-reuse',
      dashboardToProfile: {
        relevantRequests: relevant(profileEvents),
        reusedWithoutNetwork: profileEvents.length === 0,
      },
      profileToDashboard: {
        relevantRequests: relevant(dashboardEvents),
        reusedWithoutNetwork: dashboardEvents.length === 0,
      },
      dashboardToKulon: {
        relevantRequests: relevant(kulonEvents),
        reusedWithoutNetwork: kulonEvents.length === 0,
      },
    };
  } finally {
    collector.detach();
    await removeRoute();
  }
}

async function withPage(context, callback) {
  const page = await context.newPage();
  try {
    return await callback(page);
  } finally {
    await page.close();
  }
}

async function runScenario(context, dashboardUrl, scenario, timeoutMs) {
  if (scenario === 'first-post-login' || scenario === 'cold-reload') {
    return withPage(context, (page) => measureDashboardLoad(context, dashboardUrl, scenario, timeoutMs, page));
  }
  if (scenario === 'warm-reload') {
    return withPage(context, async (page) => {
      await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return measureDashboardLoad(context, dashboardUrl, scenario, timeoutMs, page, 'reload');
    });
  }
  if (scenario === 'refresh') {
    return withPage(context, async (page) => {
      const baseline = await measureDashboardLoad(context, dashboardUrl, 'cold-reload', timeoutMs, page);
      return {
        scenario,
        baseline,
        refresh: await measureRefresh(page, timeoutMs),
      };
    });
  }
  if (scenario === 'route-reuse') {
    return withPage(context, async (page) => {
      const baseline = await measureDashboardLoad(context, dashboardUrl, 'cold-reload', timeoutMs, page);
      return {
        scenario,
        baseline,
        routes: await measureRouteReuse(page, timeoutMs),
      };
    });
  }
  throw new Error('unknown benchmark scenario');
}

export async function runBenchmark(options) {
  const appBaseUrl = validateHttpUrl(options.appUrl);
  const dashboardPath = normalizeDashboardPath(options.dashboardPath ?? DASHBOARD_PATH);
  if (!appBaseUrl || !dashboardPath)
    throw new Error('app URL/path must be an absolute HTTP(S) URL without credentials, query, or fragment');
  const validScenarios = ['all', 'first-post-login', 'cold-reload', 'warm-reload', 'refresh', 'route-reuse'];
  if (!validScenarios.includes(options.scenario)) throw new Error('unknown benchmark scenario');
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000)
    throw new Error('timeout must be between 1000 and 120000 milliseconds');

  const browser = await chromium.connectOverCDP(options.cdp);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('no browser context available');
    const dashboardUrl = `${appBaseUrl}${dashboardPath === '/' ? '/' : dashboardPath}`;
    const scenarios = options.scenario === 'all'
      ? ['first-post-login', 'cold-reload', 'warm-reload', 'refresh', 'route-reuse']
      : [options.scenario];
    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(context, dashboardUrl, scenario, options.timeoutMs));
    }
    return {
      schemaVersion: 2,
      measuredAt: new Date().toISOString(),
      dashboardPath,
      slices: SLICE_PATHS,
      scenarios: results,
      notes: [
        'Timers start at browser navigation/click; login, OIDC, and MFA are excluded.',
        'Cold/warm describe browser lifecycle only. They do not claim backend caches were cleared.',
        'responseBytes are counted in memory and response bodies are never written to the report.',
        'A successful refresh must request exactly IRS, jadwal, courses, and assignments; Profile/KHS must be absent.',
        'Route-reuse checks that Dashboard→Profile and Dashboard→Kulon reuse the already-populated per-slice cache.',
      ],
    };
  } finally {
    await disconnectFromCDP(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseOptions(process.argv.slice(2));
  if (!options.appUrl) {
    console.error(usage());
    process.exit(2);
  }
  try {
    const report = await runBenchmark(options);
    const output = safeJson(report);
    if (options.output) writeFileSync(options.output, output, { encoding: 'utf8', mode: 0o600 });
    else process.stdout.write(output);
  } catch {
    console.error('Dashboard slice benchmark failed. Check the CDP endpoint, authenticated browser context, and dashboard URL.');
    process.exit(1);
  }
}
