import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySlicePath,
  disconnectFromCDP,
  normalizeDashboardPath,
  percentile,
  summarizeSliceEvents,
  validateHttpUrl,
} from "./benchmark-dashboard.mjs";

describe("dashboard benchmark helpers", () => {
  it("accepts only credential-free HTTP(S) app URLs", () => {
    assert.equal(
      validateHttpUrl("http://localhost:5173/"),
      "http://localhost:5173",
    );
    assert.equal(
      validateHttpUrl("https://example.test/app?token=secret"),
      null,
    );
    assert.equal(validateHttpUrl("https://user:pass@example.test"), null);
    assert.equal(validateHttpUrl("https://example.test/#token"), null);
    assert.equal(validateHttpUrl("file:///tmp/app"), null);
  });

  it("normalizes a route path and rejects query/fragment transport", () => {
    assert.equal(normalizeDashboardPath("/"), "/");
    assert.equal(normalizeDashboardPath("/dashboard/"), "/dashboard");
    assert.equal(normalizeDashboardPath("/dashboard?token=secret"), null);
    assert.equal(normalizeDashboardPath("dashboard"), null);
  });

  it("uses deterministic nearest-rank percentiles", () => {
    assert.equal(percentile([20, 10, 30, 40], 0.5), 20);
    assert.equal(percentile([20, 10, 30, 40], 0.95), 40);
    assert.equal(percentile([], 0.5), null);
  });

  it("classifies the six production dashboard slice endpoints", () => {
    assert.equal(classifySlicePath("/api/siap/profile"), "profile");
    assert.equal(
      classifySlicePath(new URL("https://example.test/api/kulon/courses/summary")),
      "courses",
    );
    assert.equal(classifySlicePath("/api/dashboard"), null);
  });

  it("summarizes slice completion and exposes missing slices", () => {
    const report = summarizeSliceEvents([
      { slice: "irs", path: "/api/siap/irs", status: 200, responseBytes: 12, elapsedMs: 30 },
      { slice: "profile", path: "/api/siap/profile", status: 200, responseBytes: 20, elapsedMs: 80 },
      { slice: "irs", path: "/api/siap/irs", status: 200, responseBytes: 15, elapsedMs: 90 },
    ]);
    assert.equal(report.requestCount, 3);
    assert.deepEqual(report.completedSlices, ["irs", "profile"]);
    assert.deepEqual(report.missingSlices, ["khs", "jadwal", "courses", "assignments"]);
    assert.equal(report.firstSliceMs, 30);
    assert.equal(report.lastSliceMs, 80);
    assert.equal(report.firstDynamicSliceMs, 30);
    assert.equal(report.lastDynamicSliceMs, 30);
    assert.equal(report.allSlicesComplete, false);
    assert.equal(report.bySlice.irs.responseBytes, 12);
  });

  it("detaches from an externally-owned CDP browser without calling close", async () => {
    let detached = false;
    let closed = false;
    await disconnectFromCDP({
      close: () => {
        closed = true;
      },
      _connection: {
        close: () => {
          detached = true;
        },
      },
    });
    assert.equal(detached, true);
    assert.equal(closed, false);
  });
});
