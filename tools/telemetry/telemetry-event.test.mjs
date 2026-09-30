import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractTelemetryEvent } from "./telemetry-event.mjs";

describe("extractTelemetryEvent", () => {
  it("extracts the structured event and drops caller identifiers", () => {
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

  it("keeps cache labels/time and strips unknown fields", () => {
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

  it("rejects lines without a structured telemetry event", () => {
    assert.equal(extractTelemetryEvent("plain log line"), null);
    assert.equal(extractTelemetryEvent('{"v":1,"ts":1}'), null);
    assert.equal(extractTelemetryEvent(null), null);
  });
});
