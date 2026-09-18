import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTelemetryEvent,
  summarizeDashboardCycle,
} from "./watch-dashboard-log.mjs";

const PRIMARY_CACHES = [
  "siap.profile",
  "siap.khs",
  "siap.irs",
  "siap.jadwal",
  "kulon.courses",
  "kulon.assignments_all",
];

function reads(outcome) {
  return PRIMARY_CACHES.map((cache) => ({
    event: "cache.read",
    cache,
    backend: "memory",
    outcome,
    durationMs: 0,
    ts: "2026-09-18T12:00:00.000Z",
  }));
}

function refreshes(outcome = "ok") {
  return PRIMARY_CACHES.map((cache, index) => ({
    event: "cache.refresh",
    cache,
    backend: "memory",
    outcome,
    durationMs: index + 1,
    ts: `2026-09-18T12:00:0${index + 1}.000Z`,
  }));
}

describe("backend dashboard log watcher helpers", () => {
  it("keeps telemetry fields, strips identifiers, and recognizes cache labels", () => {
    assert.deepEqual(
      extractTelemetryEvent(
        '[Nest] {"v":1,"ts":"2026-09-18T12:00:00.000Z","event":"cache.read","cache":"kulon.courses","backend":"memory","outcome":"miss","durationMs":0,"sub":"24060121130000"}',
      ),
      {
        v: 1,
        ts: "2026-09-18T12:00:00.000Z",
        event: "cache.read",
        cache: "kulon.courses",
        backend: "memory",
        outcome: "miss",
        durationMs: 0,
      },
    );
  });

  it("summarizes a complete cold six-slice cycle and assignment fan-out", () => {
    const report = summarizeDashboardCycle([
      ...reads("miss"),
      ...refreshes(),
      {
        event: "upstream.request",
        service: "kulon",
        operation: "assignments_index",
        route: "GET /mod/assign/index.php",
        outcome: "ok",
        status: 200,
        durationMs: 12,
        ts: "2026-09-18T12:00:02.000Z",
      },
    ]);

    assert.equal(report.classification, "cold-start");
    assert.equal(report.complete, true);
    assert.equal(report.success, true);
    assert.equal(report.slices.length, 6);
    assert.equal(report.upstream.count, 1);
    assert.equal(report.upstream.byOperation.assignments_index, 1);
    assert.equal(report.upstream.courseContentCount, 0);
    assert.equal(JSON.stringify(report).includes("24060121130000"), false);
  });

  it("recognizes a warm cycle without requiring refresh events", () => {
    const report = summarizeDashboardCycle(reads("fresh"));

    assert.equal(report.classification, "warm-start");
    assert.equal(report.complete, true);
    assert.equal(report.success, true);
    assert.deepEqual(report.cache.refreshes, {});
    assert.equal(report.upstream.count, 0);
  });

  it("marks a mixed cache cycle instead of calling it cold or warm", () => {
    const report = summarizeDashboardCycle([
      ...reads("miss").slice(0, 3),
      ...reads("fresh").slice(3),
      ...refreshes().slice(0, 3),
    ]);

    assert.equal(report.classification, "mixed-start");
    assert.equal(report.complete, true);
    assert.equal(report.success, true);
  });
});
