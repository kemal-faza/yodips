#!/usr/bin/env node
// Measures safe browser-side dashboard timings against an already authenticated
// Chrome connected through CDP. It never prints/stores cookies, JWTs, or bodies.
// Usage:
//   node benchmark-dashboard.mjs --app-url http://localhost:5173 [--cdp http://127.0.0.1:9223]
//     [--scenario all|first-post-login|cold-reload|warm-reload] [--output report.json]
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const DASHBOARD_PATH = "/";
const DEFAULT_TIMEOUT_MS = 30_000;

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions() {
  const args = process.argv.slice(2);
  return {
    appUrl: argument(args, "--app-url"),
    cdp: argument(args, "--cdp") ?? "http://127.0.0.1:9223",
    dashboardPath: argument(args, "--dashboard-path") ?? DASHBOARD_PATH,
    output: argument(args, "--output"),
    scenario: argument(args, "--scenario") ?? "all",
    timeoutMs: Number(argument(args, "--timeout") ?? DEFAULT_TIMEOUT_MS),
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
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}` || url.origin;
}

export function normalizeDashboardPath(raw) {
  if (!raw || !raw.startsWith("/") || raw.includes("?") || raw.includes("#"))
    return null;
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(1, Math.ceil(sorted.length * p)) - 1];
}

function usage() {
  return "Usage: node benchmark-dashboard.mjs --app-url <spaUrl> [--cdp <url>] [--scenario all|first-post-login|cold-reload|warm-reload] [--dashboard-path /] [--output report.json]";
}

function safeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function waitForUsefulContent(page, timeoutMs) {
  const selectors = ['[data-test="greeting"]', '[data-test="siap-empty"]'];
  const candidates = selectors.map((selector) =>
    page
      .locator(selector)
      .waitFor({ state: "visible", timeout: timeoutMs })
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
    await page
      .locator('[data-test="stats-loading"]')
      .waitFor({ state: "hidden", timeout: timeoutMs });
    return true;
  } catch {
    // A partial upstream failure may not render the loading marker. The API
    // response timing remains the completion fallback in that case.
    return false;
  }
}

async function measureScenario(
  context,
  dashboardUrl,
  scenario,
  timeoutMs,
  existingPage,
  navigation = "goto",
) {
  const page = existingPage ?? (await context.newPage());
  const cacheState = scenario === "warm-reload" ? "warm" : "cold";
  const startedAt = Date.now();
  let dashboardResponse;
  let responseResolve;
  const responsePromise = new Promise((resolve) => {
    responseResolve = resolve;
  });

  const routeHandler = async (route) => {
    const headers = {
      ...route.request().headers(),
      "x-yodips-cache-state": cacheState,
    };
    await route.continue({ headers });
  };
  await page.route("**/api/dashboard", routeHandler);
  const responseHandler = async (response) => {
    const request = response.request();
    if (
      request.method() !== "GET" ||
      !new URL(response.url()).pathname.endsWith("/api/dashboard")
    )
      return;
    let bytes = Number(response.headers()["content-length"]);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      try {
        bytes = (await response.body()).byteLength;
      } catch {
        bytes = null;
      }
    }
    dashboardResponse = {
      status: response.status(),
      responseBytes: bytes,
      contentLength: response.headers()["content-length"] ?? null,
      elapsedMs: Date.now() - startedAt,
    };
    responseResolve(dashboardResponse);
  };
  page.on("response", responseHandler);

  try {
    const navigationPromise =
      navigation === "reload"
        ? page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs })
        : page.goto(dashboardUrl, {
            waitUntil: "domcontentloaded",
            timeout: timeoutMs,
          });
    const usefulPromise = waitForUsefulContent(page, timeoutMs).then(
      (selector) => ({ selector, elapsedMs: Date.now() - startedAt }),
    );
    await navigationPromise;
    const useful = await usefulPromise;
    const response = await Promise.race([
      responsePromise,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const dashboardSettled = await waitForDashboardSettled(page, Math.min(timeoutMs, 2_000));
    return {
      scenario,
      cacheState,
      backendCacheState: "unknown",
      usefulContent: useful,
      dashboardResponse: response ?? dashboardResponse ?? null,
      dashboardSettled,
      timeToCompleteMs: Date.now() - startedAt,
    };
  } finally {
    page.off("response", responseHandler);
    await page.unroute("**/api/dashboard", routeHandler);
    if (!existingPage) await page.close();
  }
}

export async function runBenchmark(options) {
  const appBaseUrl = validateHttpUrl(options.appUrl);
  const dashboardPath = normalizeDashboardPath(
    options.dashboardPath ?? DASHBOARD_PATH,
  );
  if (!appBaseUrl || !dashboardPath)
    throw new Error(
      "app URL/path must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
  if (
    !["all", "first-post-login", "cold-reload", "warm-reload"].includes(
      options.scenario,
    )
  ) {
    throw new Error("unknown benchmark scenario");
  }
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 120_000
  ) {
    throw new Error("timeout must be between 1000 and 120000 milliseconds");
  }

  const browser = await chromium.connectOverCDP(options.cdp);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("no browser context available");
    const dashboardUrl = `${appBaseUrl}${dashboardPath === "/" ? "/" : dashboardPath}`;
    const runs = [];
    if (options.scenario === "all") {
      runs.push(
        await measureScenario(
          context,
          dashboardUrl,
          "first-post-login",
          options.timeoutMs,
        ),
      );
      const page = await context.newPage();
      try {
        runs.push(
          await measureScenario(
            context,
            dashboardUrl,
            "cold-reload",
            options.timeoutMs,
            page,
          ),
        );
        runs.push(
          await measureScenario(
            context,
            dashboardUrl,
            "warm-reload",
            options.timeoutMs,
            page,
            "reload",
          ),
        );
      } finally {
        await page.close();
      }
    } else if (options.scenario === "warm-reload") {
      const page = await context.newPage();
      try {
        await page.goto(dashboardUrl, {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs,
        });
        runs.push(
          await measureScenario(
            context,
            dashboardUrl,
            "warm-reload",
            options.timeoutMs,
            page,
            "reload",
          ),
        );
      } finally {
        await page.close();
      }
    } else {
      runs.push(
        await measureScenario(
          context,
          dashboardUrl,
          options.scenario,
          options.timeoutMs,
        ),
      );
    }
    return {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      dashboardPath,
      scenarios: runs,
      notes: [
        "Timer starts when the benchmark navigation begins; OIDC/MFA is excluded.",
        "cold/warm describes browser lifecycle and the measurement header; backend cache state remains unknown unless the server environment is reset separately.",
        "Response bodies are measured in memory and never written to the report.",
      ],
    };
  } finally {
    await browser.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseOptions();
  if (!options.appUrl) {
    console.error(usage());
    process.exit(2);
  }
  try {
    const report = await runBenchmark(options);
    const output = safeJson(report);
    if (options.output)
      writeFileSync(options.output, output, { encoding: "utf8", mode: 0o600 });
    else process.stdout.write(output);
  } catch {
    console.error(
      "Dashboard benchmark failed. Check the CDP endpoint, authenticated browser context, and dashboard URL.",
    );
    process.exit(1);
  }
}
