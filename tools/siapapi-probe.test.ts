import assert from "node:assert/strict";
import { test } from "node:test";
import { probe, redactProbeUrl } from "./siapapi-probe";

test("redacts attendance QR tokens and query values from probe URLs", () => {
  const redacted = redactProbeUrl(
    "https://api.siap.undip.ac.id/index.php/absen/proses_absen/qr-secret?nim=private#fragment",
  );

  assert.equal(
    redacted,
    "https://api.siap.undip.ac.id/index.php/absen/proses_absen/[redacted]",
  );
  assert.doesNotMatch(redacted, /qr-secret|private|fragment/);
});

test("probe returns redacted URLs and response previews without logging request bodies", async () => {
  const originalFetch = global.fetch;
  const qrToken = "qr-secret-value";
  let request: RequestInit | undefined;
  global.fetch = (async (_input, init) => {
    request = init;
    return new Response(JSON.stringify({ message: qrToken }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await probe(
      `https://api.siap.undip.ac.id/index.php/absen/proses_absen/${qrToken}?ticket=query-secret`,
      "POST",
      { "Content-Type": "application/x-www-form-urlencoded" },
      "app_ver=24",
    );

    assert.equal(request?.method, "POST");
    assert.equal(request?.body, "app_ver=24");
    assert.equal(result.status, 401);
    assert.doesNotMatch(JSON.stringify(result), /qr-secret-value|query-secret/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("invalid probe URLs are never returned verbatim", () => {
  assert.equal(redactProbeUrl("not-a-url?token=secret"), "[redacted-url]");
});

test("fetch failures do not expose transport error details", async () => {
  const originalFetch = global.fetch;
  const qrToken = "qr-secret-value";
  global.fetch = (async () => {
    throw new Error(`failed to fetch /proses_absen/${qrToken}`);
  }) as typeof fetch;

  try {
    const result = await probe(
      `https://api.siap.undip.ac.id/index.php/absen/proses_absen/${qrToken}`,
      "POST",
    );

    assert.equal(result.preview, "FETCH_ERR: request failed");
    assert.doesNotMatch(JSON.stringify(result), /qr-secret-value/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("response body read failures return a redacted structured result", async () => {
  const originalFetch = global.fetch;
  const qrToken = "qr-secret-value";
  global.fetch = (async () => ({
    status: 502,
    headers: new Headers({ "content-type": "application/json" }),
    clone: () => ({
      text: async () => {
        throw new Error(`body unavailable for ${qrToken}`);
      },
    }),
  })) as unknown as typeof fetch;

  try {
    const result = await probe(
      `https://api.siap.undip.ac.id/index.php/absen/proses_absen/${qrToken}`,
      "POST",
    );

    assert.equal(result.status, 502);
    assert.equal(result.preview, "BODY_READ_ERR: response body unavailable");
    assert.doesNotMatch(JSON.stringify(result), /qr-secret-value/);
  } finally {
    global.fetch = originalFetch;
  }
});
