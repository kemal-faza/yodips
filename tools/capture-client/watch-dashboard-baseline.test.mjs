import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildBaselineReport,
  startBackendCycleWatcher,
  summarizeBrowserCycle,
  validateScenario,
} from "./watch-dashboard-baseline.mjs";

const events = [
  { slice: "profile", path: "/api/siap/profile", status: 200, responseBytes: 100, elapsedMs: 180 },
  { slice: "khs", path: "/api/siap/khs", status: 200, responseBytes: 200, elapsedMs: 290 },
  { slice: "irs", path: "/api/siap/irs", status: 200, responseBytes: 80, elapsedMs: 210 },
  { slice: "jadwal", path: "/api/siap/jadwal", status: 200, responseBytes: 70, elapsedMs: 160 },
  { slice: "courses", path: "/api/kulon/courses/summary", status: 200, responseBytes: 120, elapsedMs: 350 },
  { slice: "assignments", path: "/api/kulon/assignments/all", status: 200, responseBytes: 130, elapsedMs: 410 },
];

describe("dashboard baseline watcher helpers", () => {
  it("summarizes useful-content, completion, request count, and response bytes", () => {
    const report = summarizeBrowserCycle({
      startedAt: Date.parse("2026-09-18T00:00:00.000Z"),
      usefulContent: { selector: '[data-test="greeting"]', elapsedMs: 125 },
      events: [...events, events[0]],
    });

    assert.equal(report.timeToUsefulContentMs, 125);
    assert.equal(report.timeToCompleteMs, 410);
    assert.equal(report.requestCount, 7);
    assert.equal(report.responseBytesTotal, 800);
    assert.equal(report.responseBytesKnownCount, 7);
    assert.equal(report.slices.allSlicesComplete, true);
  });

  it("accepts only the baseline scenarios", () => {
    assert.equal(validateScenario("first-post-login"), "first-post-login");
    assert.equal(validateScenario("cold-reload"), "cold-reload");
    assert.equal(validateScenario("warm-reload"), "warm-reload");
    assert.throws(() => validateScenario("route-reuse"));
  });

  it("marks missing browser metrics instead of claiming a complete capture", () => {
    const report = summarizeBrowserCycle({
      startedAt: Date.now(),
      usefulContent: null,
      events: events.map((event) => ({ ...event, responseBytes: null })),
    });

    assert.equal(report.complete, true);
    assert.equal(report.captureComplete, false);
    assert.deepEqual(report.missingMetrics, ["timeToUsefulContentMs", "responseBytes"]);
    assert.equal(report.responseBytesComplete, false);
  });

  it("keeps backend-only reports partial when CDP metrics are unavailable", () => {
    const report = buildBaselineReport({
      scenario: "cold-reload",
      startedAt: Date.parse("2026-09-18T00:00:00.000Z"),
      backend: { complete: true },
      browserReport: null,
      browserUnavailable: "cdp-unavailable",
    });

    assert.equal(report.backendComplete, true);
    assert.equal(report.complete, false);
    assert.equal(report.browser.unavailableReason, "cdp-unavailable");
    assert.deepEqual(report.browser.missingMetrics, [
      "dashboardCycle",
      "timeToUsefulContentMs",
      "responseBytes",
    ]);
  });

  it("times out from EOF even when no dashboard event arrives", async () => {
    const directory = mkdtempSync(join(tmpdir(), "yodips-baseline-test-"));
    const log = join(directory, "backend.log");
    writeFileSync(log, "");
    try {
      const watcher = startBackendCycleWatcher({ log, timeoutMs: 25, settleMs: 0 });
      const report = await watcher.promise;
      assert.equal(report.complete, false);
      assert.deepEqual(report.missingSlices, [
        "siap.profile",
        "siap.khs",
        "siap.irs",
        "siap.jadwal",
        "kulon.courses",
        "kulon.assignments_all",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
