import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeWatchReport } from "./watch-dashboard.mjs";

function loadScenario(scenario, slices = {}) {
  return { scenario, slices: { allSlicesComplete: true, ...slices } };
}

describe("dashboard watcher helpers", () => {
  it("reports a healthy cold/warm load and route cache reuse", () => {
    const report = summarizeWatchReport({
      measuredAt: "2026-09-18T00:00:00.000Z",
      scenarios: [
        loadScenario("cold-reload"),
        loadScenario("warm-reload"),
        {
          scenario: "route-reuse",
          routes: {
            dashboardToProfile: { reusedWithoutNetwork: true },
            profileToDashboard: { reusedWithoutNetwork: true },
            dashboardToKulon: { reusedWithoutNetwork: true },
          },
        },
      ],
    });
    assert.equal(report.ok, true);
  });

  it("fails when a slice is missing or a route refetches", () => {
    const report = summarizeWatchReport({
      measuredAt: "2026-09-18T00:00:00.000Z",
      scenarios: [
        loadScenario("cold-reload", { allSlicesComplete: false }),
        loadScenario("warm-reload"),
        {
          scenario: "route-reuse",
          routes: {
            dashboardToProfile: { reusedWithoutNetwork: false },
            profileToDashboard: { reusedWithoutNetwork: true },
            dashboardToKulon: { reusedWithoutNetwork: true },
          },
        },
      ],
    });
    assert.equal(report.ok, false);
  });
});
