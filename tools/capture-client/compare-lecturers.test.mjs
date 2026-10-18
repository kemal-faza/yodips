import assert from "node:assert/strict";
import test from "node:test";
import {
  cookieHeader,
  gateVerdict,
  summarizeCompare,
} from "./compare-lecturers.mjs";

const baseReport = {
  legacy: {
    ok: true,
    items: [{ kode: "MIK1", dosen: "Dosen X" }],
    durationMs: 1200,
  },
  token: {
    ok: true,
    items: [{ kode: "MIK1", dosen: "Dosen X" }],
    failedSemesters: [],
    durationMs: 900,
  },
  production: {
    ok: true,
    items: [{ kode: "MIK1", dosen: "Dosen X" }],
    durationMs: 5,
  },
  counts: { legacy: 1, token: 1, production: 1 },
  onlyLegacy: [],
  onlyToken: [],
  onlyProduction: [],
  missingProduction: [],
  differentDosen: [],
  differentDosenProduction: [],
  emptyApiDosen: [],
  staleSim: false,
};

test("joins cookies from the host and its parent domain, ignoring others", () => {
  const cookies = [
    { name: "a", value: "1", domain: "siap.undip.ac.id" },
    { name: "b", value: "2", domain: ".undip.ac.id" },
    { name: "c", value: "3", domain: "kulon2.undip.ac.id" },
  ];
  assert.equal(cookieHeader(cookies, "siap.undip.ac.id"), "a=1; b=2");
});

test("passes the gate when both sides agree", () => {
  assert.deepEqual(gateVerdict(baseReport), { pass: true, reason: "setara" });
});

test("fails the gate on onlyLegacy, differentDosen or failed semesters", () => {
  assert.equal(gateVerdict({ ...baseReport, onlyLegacy: ["MIK9"] }).pass, false);
  assert.equal(
    gateVerdict({
      ...baseReport,
      differentDosen: [{ kode: "MIK1", legacy: "A", token: "B" }],
    }).pass,
    false,
  );
  assert.equal(
    gateVerdict({
      ...baseReport,
      token: { ...baseReport.token, failedSemesters: [3] },
    }).pass,
    false,
  );
});

test("fails the gate when a side errored or returned an empty set", () => {
  assert.equal(
    gateVerdict({ ...baseReport, legacy: { ok: false, reason: "no-cookie" } }).pass,
    false,
  );
  assert.equal(
    gateVerdict({
      ...baseReport,
      legacy: { ok: true, items: [] },
      counts: { ...baseReport.counts, legacy: 0 },
    }).pass,
    false,
  );
  assert.equal(
    gateVerdict({
      ...baseReport,
      token: { ok: true, items: [], failedSemesters: [] },
      counts: { ...baseReport.counts, token: 0 },
    }).pass,
    false,
  );
});

test("fails the gate when the production entry point errors, diverges or is a subset", () => {
  assert.equal(
    gateVerdict({
      ...baseReport,
      production: { ok: false, reason: "error" },
    }).pass,
    false,
  );
  assert.equal(
    gateVerdict({
      ...baseReport,
      production: { ok: true, items: [], durationMs: 5 },
      counts: { ...baseReport.counts, production: 0 },
    }).pass,
    false,
  );
  assert.equal(
    gateVerdict({ ...baseReport, onlyProduction: ["MIK9"] }).pass,
    false,
  );
  assert.equal(
    gateVerdict({
      ...baseReport,
      differentDosenProduction: [
        { kode: "MIK1", production: "A", token: "B" },
      ],
    }).pass,
    false,
  );
  // token has 2 codes, production serves only 1 — the lecturers that are missing
  // must fail the gate.
  assert.equal(
    gateVerdict({
      ...baseReport,
      production: {
        ok: true,
        items: [{ kode: "MIK1", dosen: "Dosen X" }],
        durationMs: 5,
      },
      counts: { legacy: 2, token: 2, production: 1 },
      missingProduction: ["MIK2"],
    }).pass,
    false,
  );
});

test("onlyToken alone does not fail the gate", () => {
  assert.equal(gateVerdict({ ...baseReport, onlyToken: ["MIK7"] }).pass, true);
});

test("summary never prints lecturer names", () => {
  const text = summarizeCompare({
    ...baseReport,
    differentDosen: [{ kode: "MIK1", legacy: "Dosen X", token: "Dosen Y" }],
  });
  assert.ok(!text.includes("Dosen X"));
  assert.ok(!text.includes("Dosen Y"));
  assert.ok(text.includes("MIK1"));
});
