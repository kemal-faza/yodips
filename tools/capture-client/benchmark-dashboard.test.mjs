import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeDashboardPath,
  percentile,
  validateHttpUrl,
} from "./benchmark-dashboard.mjs";

describe("dashboard benchmark helpers", () => {
  it("accepts only credential-free HTTP(S) app URLs", () => {
    assert.equal(
      validateHttpUrl("http://localhost:5173/"),
      "http://localhost:5173",
    );
    assert.equal(validateHttpUrl("https://example.test/app?token=secret"), null);
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
});
