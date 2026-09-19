import assert from "node:assert/strict";
import test from "node:test";
import { parseMobileLogLine, summarizeMobileCycle } from "./watch-mobile-dashboard.mjs";

const paths = [
  "/api/siap/profile",
  "/api/siap/irs",
  "/api/siap/khs",
  "/api/siap/jadwal",
];

test("parses low-cardinality mobile log lines without retaining secrets", () => {
  const event = parseMobileLogLine(
    '09-18 21:00:00.000 I/YODIPS_MOBILE_PERF: {"v":1,"event":"mobile.http","ts":1726693200000,"method":"GET","path":"/api/siap/khs","outcome":"ok","status":200,"durationMs":42,"responseBytes":128}',
  );
  assert.deepEqual(event, {
    ts: 1726693200000,
    method: "GET",
    path: "/api/siap/khs",
    outcome: "ok",
    status: 200,
    durationMs: 42,
    responseBytes: 128,
  });
});

test("summarizes all mobile SIAP slices and duplicate requests", () => {
  const events = paths.map((path, index) => ({
    ts: 1726693200000 + index * 50,
    method: "GET",
    path,
    outcome: "ok",
    status: 200,
    durationMs: 20 + index,
    responseBytes: 100 + index,
  }));
  events.push({ ...events[2], ts: events[2].ts + 100, durationMs: 21 });
  const report = summarizeMobileCycle(events, { scenario: "cold-start", deviceId: "emulator-5554" });
  assert.equal(report.complete, true);
  assert.equal(report.requestCount, 5);
  assert.equal(report.duplicateRequestCount, 1);
  assert.equal(report.responseBytesTotal, 508);
  assert.deepEqual(report.missingSlices, []);
});
