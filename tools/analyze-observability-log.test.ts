import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateEvents,
  analyzeText,
  MAX_INPUT_BYTES,
  MAX_LINE_LENGTH,
  nearestRank,
  parseEventLine,
  stableJson,
  validateEvent,
  type SafeEvent,
} from "./analyze-observability-log";

const ts = "2026-09-01T00:00:00.000Z";
const siapProfileRoute = "GET /pages/mhs/dashboard";
const cacheRead = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  ts,
  event: "cache.read",
  cache: "siap.profile",
  backend: "memory",
  outcome: "miss",
  durationMs: 9,
  ...overrides,
});

const upstream = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  ts,
  event: "upstream.request",
  service: "siap",
  operation: "profile_page",
  route: siapProfileRoute,
  outcome: "ok",
  status: 200,
  durationMs: 9,
  ...overrides,
});

function runCli(args: string[], input?: string) {
  const cli = join(__dirname, "analyze-observability-log.js");
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: join(__dirname, ".."),
    input,
    encoding: "utf8",
  });
}

describe("observability event parser", () => {
  it("classifies each input line exactly once", () => {
    const report = analyzeText(
      [
        "ordinary Nest line",
        `prefix {"nested":{"x":1}} ${JSON.stringify(upstream())}`,
        "{broken",
      ].join("\n"),
    );

    assert.deepEqual(report.lines, { events: 1, ignoredLines: 1, malformedEvents: 1 });
    assert.equal(report.upstream["siap.profile_page.GET /pages/mhs/dashboard"].durationMs.p50, 9);
  });

  it("chooses a valid candidate even when an invalid candidate is to its right", () => {
    const valid = upstream({ durationMs: 11 });
    const invalidSchema = { ...upstream(), outcome: "not-an-outcome" };
    const result = parseEventLine(`prefix ${JSON.stringify(valid)} ${JSON.stringify(invalidSchema)}`);

    assert.deepEqual(result, { kind: "event", event: valid });
    assert.deepEqual(parseEventLine(`${JSON.stringify(valid)} {not-json}`), {
      kind: "event",
      event: valid,
    });
  });

  it("does not accept an event before non-object text that ends in a brace", () => {
    const valid = JSON.stringify(upstream());

    assert.deepEqual(parseEventLine(`${valid} junk}`), { kind: "malformed" });
  });

  it("continues past schema-invalid nested objects to the valid outer object", () => {
    const valid = { ...cacheRead(), nested: { secret: "must not echo" } };
    const result = parseEventLine(`prefix ${JSON.stringify(valid)}`);

    assert.deepEqual(result, {
      kind: "event",
      event: cacheRead(),
    });
  });

  it("rejects JSON candidates that do not end the trimmed line", () => {
    assert.deepEqual(parseEventLine(`${JSON.stringify(upstream())} trailing`), { kind: "ignored" });
    assert.deepEqual(parseEventLine("ordinary text"), { kind: "ignored" });
  });

  it("does not scan an oversized object-looking line", () => {
    const oversizedLine = `${JSON.stringify(upstream())}${"x".repeat(MAX_LINE_LENGTH)} }`;

    assert.deepEqual(parseEventLine(oversizedLine), { kind: "malformed" });
    assert.deepEqual(analyzeText(oversizedLine).lines, {
      events: 0,
      ignoredLines: 0,
      malformedEvents: 1,
    });
  });

  it("marks parseable-invalid and unparseable object suffixes as malformed", () => {
    assert.deepEqual(parseEventLine(JSON.stringify({ v: 1, ts, event: "unknown" })), { kind: "malformed" });
    assert.deepEqual(parseEventLine("prefix {not-json}"), { kind: "malformed" });
    assert.deepEqual(parseEventLine("{broken"), { kind: "malformed" });
  });
});

describe("strict event validation", () => {
  it("accepts every conditional cache.read shape", () => {
    const events = [
      cacheRead({ outcome: "hit" }),
      cacheRead({ outcome: "miss" }),
      cacheRead({ freshTtlMs: 300_000, staleTtlMs: 600_000 }),
      cacheRead({ outcome: "fresh", ageMs: 1, freshTtlMs: 2, staleTtlMs: 3 }),
      cacheRead({ outcome: "stale", ageMs: 1, freshTtlMs: 2, staleTtlMs: 3 }),
      cacheRead({ outcome: "expired", ageMs: 1, freshTtlMs: 2, staleTtlMs: 3 }),
      cacheRead({ cache: "auth.probe", outcome: "hit" }),
      cacheRead({ cache: "auth.probe", outcome: "miss" }),
    ];

    for (const event of events) assert.ok(validateEvent(event));
  });

  it("accepts every cache.refresh conditional shape and all refresh reasons", () => {
    assert.ok(
      validateEvent({
        v: 1,
        ts,
        event: "cache.refresh",
        cache: "siap.profile",
        backend: "memory",
        outcome: "started",
        freshTtlMs: 1,
        staleTtlMs: 2,
      }),
    );
    assert.ok(
      validateEvent({
        v: 1,
        ts,
        event: "cache.refresh",
        cache: "siap.profile",
        backend: "memory",
        outcome: "ok",
        freshTtlMs: 1,
        staleTtlMs: 2,
        durationMs: 3,
      }),
    );
    for (const reason of ["dead-session", "transient", "unexpected", "unknown"]) {
      assert.ok(
        validateEvent({
          v: 1,
          ts,
          event: "cache.refresh",
          cache: "siap.profile",
          backend: "memory",
          outcome: "error",
          freshTtlMs: 1,
          staleTtlMs: 2,
          durationMs: 3,
          reason,
        }),
      );
    }
    assert.ok(
      validateEvent({
        v: 1,
        ts,
        event: "cache.refresh",
        cache: "siap.profile",
        backend: "memory",
        outcome: "hard_expire",
        freshTtlMs: 1,
        staleTtlMs: 2,
        durationMs: 3,
        reason: "dead-session",
      }),
    );
  });

  it("accepts all upstream outcomes with their conditional fields", () => {
    const networkError = upstream({ outcome: "network_error", reason: "fetch-threw" });
    delete networkError.status;
    const events = [
      upstream({ outcome: "ok" }),
      upstream({ outcome: "http_error", status: 502, reason: "http-not-ok" }),
      networkError,
      upstream({ outcome: "parse_error", status: 200, reason: "malformed-json" }),
      upstream({ outcome: "stale", status: 401, reason: "login-redirect" }),
    ];

    for (const event of events) assert.ok(validateEvent(event));
  });

  it("follows contract status requiredFor and forbiddenFor rules", () => {
    const networkError = upstream({ outcome: "network_error", reason: "fetch-threw" });
    const parseErrorWithoutStatus = upstream({ outcome: "parse_error", reason: "malformed-json" });
    delete networkError.status;
    delete parseErrorWithoutStatus.status;

    assert.ok(validateEvent(upstream({ outcome: "parse_error", status: 204, reason: "malformed-json" })));
    assert.ok(validateEvent(networkError));
    assert.equal(validateEvent(upstream({ outcome: "network_error", status: 503, reason: "fetch-threw" })), undefined);
    assert.equal(validateEvent(parseErrorWithoutStatus), undefined);
  });

  it("enforces status, duration, route, and conditional-field rules", () => {
    const invalid = [
      upstream({ status: 99 }),
      upstream({ status: 600 }),
      upstream({ status: 200.5 }),
      upstream({ durationMs: -1 }),
      upstream({ durationMs: Number.POSITIVE_INFINITY }),
      upstream({ outcome: "network_error", status: 500, reason: "fetch-threw" }),
      upstream({ outcome: "ok", reason: "unknown" }),
      upstream({ outcome: "http_error", reason: "stale" }),
      upstream({ route: "GET /pages/mhs/dashboard?nim=1" }),
      cacheRead({ outcome: "fresh", ageMs: 1, freshTtlMs: 2 }),
      cacheRead({ outcome: "miss", freshTtlMs: 2, staleTtlMs: 3, ageMs: 1 }),
      {
        v: 1,
        ts,
        event: "cache.refresh",
        cache: "auth.probe",
        backend: "memory",
        outcome: "started",
        freshTtlMs: 1,
        staleTtlMs: 2,
      },
      {
        v: 1,
        ts,
        event: "cache.refresh",
        cache: "siap.profile",
        backend: "memory",
        outcome: "hard_expire",
        freshTtlMs: 1,
        staleTtlMs: 2,
        durationMs: 3,
        reason: "transient",
      },
    ];

    for (const event of invalid) assert.equal(validateEvent(event), undefined);
  });

  it("omits unknown input properties rather than echoing them", () => {
    const result = validateEvent({ ...upstream(), unknown: "secret", nested: { token: "secret" } });

    assert.deepEqual(result, upstream());
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
});

describe("aggregation and deterministic formatting", () => {
  it("initializes cache counters, all refresh reasons, and empty upstream groups", () => {
    const report = aggregateEvents([]);

    assert.deepEqual(report.cache["siap.profile"].reads, {
      expired: 0,
      fresh: 0,
      hit: 0,
      miss: 0,
      stale: 0,
    });
    assert.deepEqual(report.cache["siap.profile"].refreshes.reasons, {
      "dead-session": 0,
      transient: 0,
      unexpected: 0,
      unknown: 0,
    });
    const empty = report.upstream["microsoft.token_exchange.POST /oauth2/v2.0/token"];
    assert.deepEqual(empty.durationMs, { p50: null, p95: null });
    assert.deepEqual(empty.outcomes, {
      http_error: 0,
      network_error: 0,
      ok: 0,
      parse_error: 0,
      stale: 0,
    });
  });

  it("aggregates cache outcomes and nearest-rank upstream percentiles", () => {
    const events = [
      validateEvent(cacheRead({ outcome: "miss", durationMs: 1 })) as SafeEvent,
      validateEvent(cacheRead({ outcome: "hit", durationMs: 2 })) as SafeEvent,
      validateEvent({
        v: 1,
        ts,
        event: "cache.refresh",
        cache: "siap.profile",
        backend: "memory",
        outcome: "error",
        freshTtlMs: 1,
        staleTtlMs: 2,
        durationMs: 3,
        reason: "unexpected",
      }) as SafeEvent,
      validateEvent(upstream({ durationMs: 1 })) as SafeEvent,
      validateEvent(upstream({ durationMs: 2 })) as SafeEvent,
      validateEvent(upstream({ durationMs: 3 })) as SafeEvent,
      validateEvent(upstream({ durationMs: 4 })) as SafeEvent,
      validateEvent(upstream({ durationMs: 5 })) as SafeEvent,
    ];
    const report = aggregateEvents(events);
    const cache = report.cache["siap.profile"];
    const group = report.upstream["siap.profile_page.GET /pages/mhs/dashboard"];

    assert.equal(cache.reads.miss, 1);
    assert.equal(cache.reads.hit, 1);
    assert.equal(cache.refreshes.error, 1);
    assert.equal(cache.refreshes.reasons.unexpected, 1);
    assert.deepEqual(group.durationMs, { p50: 3, p95: 5 });
    assert.equal(group.outcomes.ok, 5);
  });

  it("uses nearest-rank percentiles", () => {
    assert.equal(nearestRank([], 0.5), null);
    assert.equal(nearestRank([1, 2], 0.5), 1);
    assert.equal(nearestRank([1, 2], 0.95), 2);
    assert.equal(nearestRank([1, 2, 3, 4, 5], 0.95), 5);
  });

  it("recursively sorts object keys while preserving array order", () => {
    assert.equal(
      stableJson({ z: { b: 2, a: 1 }, a: [{ z: 3, a: 4 }] }),
      '{\n  "a": [\n    {\n      "a": 4,\n      "z": 3\n    }\n  ],\n  "z": {\n    "a": 1,\n    "b": 2\n  }\n}\n',
    );
  });
});

describe("observability analyzer CLI", () => {
  it("reads stdin with no arguments and with '-' and writes report only to stdout", () => {
    const event = `${JSON.stringify(cacheRead({ outcome: "miss", freshTtlMs: 300_000, staleTtlMs: 600_000, durationMs: 1 }))}\n`;
    for (const args of [[], ["-"]]) {
      const result = runCli(args, event);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.lines.events, 1);
      assert.equal(report.cache["siap.profile"].reads.miss, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(report, "unknown"), false);
    }
  });

  it("reads one UTF-8 file", () => {
    const directory = mkdtempSync(join(tmpdir(), "observability-analyzer-"));
    const inputPath = join(directory, "events.log");
    try {
      writeFileSync(inputPath, JSON.stringify(upstream()), "utf8");
      const result = runCli([inputPath]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(JSON.parse(result.stdout).lines.events, 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns exit 2 with stderr diagnostics for argument and I/O errors", () => {
    for (const args of [["one", "two"], ["/definitely/not/readable/events.log"]]) {
      const result = runCli(args, "");
      assert.equal(result.status, 2);
      assert.notEqual(result.stderr, "");
      assert.equal(result.stdout, "");
    }
  });

  it("treats malformed input as report data and still exits zero", () => {
    const result = runCli([], "{broken\nordinary\n");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout).lines, {
      events: 0,
      ignoredLines: 1,
      malformedEvents: 1,
    });
  });

  it("returns exit 2 with no stdout for oversized input", () => {
    const sentinel = "OVERSIZE_INPUT_MUST_NOT_ECHO";
    const input = `${"x".repeat(MAX_INPUT_BYTES)}${sentinel}`;
    const result = runCli([], input);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(sentinel), false);
  });
});
