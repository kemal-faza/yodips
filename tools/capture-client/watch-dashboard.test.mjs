import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeWatchCycle } from "./watch-dashboard.mjs";

const events = [
  { slice: "profile", path: "/api/siap/profile", status: 200, responseBytes: 10, elapsedMs: 40 },
  { slice: "khs", path: "/api/siap/khs", status: 200, responseBytes: 11, elapsedMs: 50 },
  { slice: "irs", path: "/api/siap/irs", status: 200, responseBytes: 12, elapsedMs: 30 },
  { slice: "jadwal", path: "/api/siap/jadwal", status: 200, responseBytes: 13, elapsedMs: 20 },
  { slice: "courses", path: "/api/kulon/courses/summary", status: 200, responseBytes: 14, elapsedMs: 60 },
  { slice: "assignments", path: "/api/kulon/assignments/all", status: 200, responseBytes: 15, elapsedMs: 70 },
];

function cycle(number, cycleEvents = events) {
  return { number, trigger: "navigation", startedAt: Date.parse("2026-09-18T00:00:00.000Z"), events: cycleEvents };
}

describe("dashboard watcher helpers", () => {
  it("labels the first observed load cold and later loads warm", () => {
    const cold = summarizeWatchCycle(cycle(1));
    const warm = summarizeWatchCycle(cycle(2, events.slice(0, 4)));
    assert.equal(cold.label, "cold-start");
    assert.equal(cold.slices.allSlicesComplete, true);
    assert.equal(cold.durationMs, 70);
    assert.equal(warm.label, "warm-start");
    assert.equal(warm.slices.missingSlices.length, 2);
  });

  it("preserves status, bytes, and dynamic completion timing", () => {
    const report = summarizeWatchCycle(cycle(1));
    assert.equal(report.slices.requestCount, 6);
    assert.equal(report.slices.firstDynamicSliceMs, 20);
    assert.equal(report.slices.lastDynamicSliceMs, 70);
    assert.equal(report.slices.bySlice.assignments.responseBytes, 15);
  });
});
