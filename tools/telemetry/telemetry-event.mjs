const TELEMETRY_FIELDS = new Set([
  "v",
  "ts",
  "event",
  "cache",
  "backend",
  "freshTtlMs",
  "staleTtlMs",
  "route",
  "outcome",
  "status",
  "durationMs",
  "responseBytes",
  "cacheState",
  "slice",
  "service",
  "operation",
  "reason",
]);

/** Parse only the final structured telemetry object; caller data is discarded. */
export function extractTelemetryEvent(line) {
  if (typeof line !== "string") return null;
  const start = line.indexOf("{");
  const end = line.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(line.slice(start, end + 1));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.event !== "string"
  )
    return null;
  const safe = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (
      TELEMETRY_FIELDS.has(key) &&
      (typeof value === "string" || typeof value === "number")
    )
      safe[key] = value;
  }
  return safe.event ? safe : null;
}
