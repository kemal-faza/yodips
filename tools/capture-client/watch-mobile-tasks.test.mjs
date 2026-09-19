import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_TASK_PATHS, parseMobileTaskLogLine, summarizeMobileTaskCycle } from "./watch-mobile-tasks.mjs";

test("parses threadtime task telemetry and keeps only normalized paths", () => {
  const event = parseMobileTaskLogLine(
    '09-18 22:00:00.000 I/YODIPS_MOBILE_PERF( 123): {"v":1,"event":"mobile.http","ts":1726693200000,"method":"GET","path":"/api/kulon/assignments/all","outcome":"ok","status":200,"durationMs":123,"responseBytes":456}',
  );
  assert.deepEqual(event, {
    ts: 1726693200000,
    method: "GET",
    path: "/api/kulon/assignments/all",
    outcome: "ok",
    status: 200,
    durationMs: 123,
    responseBytes: 456,
  });
  assert.equal(parseMobileTaskLogLine('I/YODIPS_MOBILE_PERF: {"event":"mobile.http","path":"/api/kulon/assignments/42/detail"}'), null);
});

test("summarizes sequential courses and assignments task load", () => {
  const events = [
    { ts: 1726693200000, method: "GET", path: MOBILE_TASK_PATHS[0], outcome: "ok", status: 200, durationMs: 820, responseBytes: 1000 },
    { ts: 1726693200820, method: "GET", path: MOBILE_TASK_PATHS[1], outcome: "ok", status: 200, durationMs: 4120, responseBytes: 5000 },
  ];
  const report = summarizeMobileTaskCycle(events, { scenario: "cold-start", deviceId: "emulator-5554" });
  assert.equal(report.complete, true);
  assert.equal(report.taskListSucceeded, true);
  assert.equal(report.timeToTaskListMs, 820);
  assert.equal(report.durationMs, 820);
  assert.equal(report.responseBytesTotal, 6000);
  assert.deepEqual(report.missingSlices, []);
});

test("treats cached courses as a partial-but-useful task observation", () => {
  const report = summarizeMobileTaskCycle([
    { ts: 1726693200000, method: "GET", path: "/api/kulon/assignments/all", outcome: "ok", status: 200, durationMs: 2500, responseBytes: null },
  ], { scenario: "warm-start" });
  assert.equal(report.complete, true);
  assert.deepEqual(report.missingSlices, ["/api/kulon/courses"]);
  assert.equal(report.timedOut, undefined);
  assert.ok(report.missingMetrics.includes("responseBytes"));
});
