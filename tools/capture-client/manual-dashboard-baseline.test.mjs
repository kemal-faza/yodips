import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTelemetryEvent,
  summarizeEvents,
} from "./manual-dashboard-baseline.mjs";

describe("manual dashboard baseline helpers", () => {
  it("extracts only a structured telemetry event from a prefixed log line", () => {
    assert.deepEqual(
      extractTelemetryEvent(
        '[Nest] [telemetry] {"v":1,"event":"dashboard.request","route":"GET /api/dashboard","outcome":"ok","status":200,"durationMs":42,"responseBytes":128,"cacheState":"unknown","sub":"24060121130000"}',
      ),
      {
        v: 1,
        event: "dashboard.request",
        route: "GET /api/dashboard",
        outcome: "ok",
        status: 200,
        durationMs: 42,
        responseBytes: 128,
        cacheState: "unknown",
      },
    );
  });

  it("summarizes dashboard, slice, and upstream events without raw fields", () => {
    const report = summarizeEvents([
      {
        event: "dashboard.request",
        route: "GET /api/dashboard",
        outcome: "ok",
        status: 200,
        durationMs: 42,
        responseBytes: 128,
        cacheState: "unknown",
      },
      {
        event: "dashboard.slice",
        route: "GET /api/dashboard",
        slice: "profile",
        outcome: "ok",
        status: 200,
        durationMs: 10,
      },
      {
        event: "upstream.request",
        service: "siap",
        operation: "profile_page",
        route: "GET /pages/mhs/dashboard",
        outcome: "ok",
        status: 200,
        durationMs: 20,
      },
    ]);

    assert.deepEqual(report.dashboard.request, {
      outcome: "ok",
      status: 200,
      durationMs: 42,
      responseBytes: 128,
      cacheState: "unknown",
    });
    assert.deepEqual(report.dashboard.slices.profile, {
      outcome: "ok",
      status: 200,
      durationMs: 10,
    });
    assert.deepEqual(report.upstream, {
      count: 1,
      byRoute: {
        "siap.profile_page.GET /pages/mhs/dashboard": {
          count: 1,
          durationMs: 20,
          outcome: "ok",
          status: 200,
        },
      },
    });
    assert.equal(JSON.stringify(report).includes("24060121130000"), false);
  });
});
