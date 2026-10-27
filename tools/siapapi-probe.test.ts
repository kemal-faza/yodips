import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  buildQrProbePlan,
  classifyQrProbe,
  probe,
  QR_PROBE_DUMMY_TOKEN,
  redactProbeUrl,
} from "./siapapi-probe";

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

test("qr probe plan stays on the SIAP host and uses only the internal dummy token", () => {
  const plan = buildQrProbePlan();

  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.controls.length, 3);

  for (const target of [...plan.candidates, ...plan.controls]) {
    assert.match(target.url, /^https:\/\/api\.siap\.undip\.ac\.id\/index\.php\//);
    assert.ok(target.url.endsWith(`/${QR_PROBE_DUMMY_TOKEN}`));
  }
});

const observation = (
  label: string,
  status: number,
  allow: string | null = null,
  bodyFingerprint = `body-${label}-${status}`,
) => ({ label, status, allow, bodyFingerprint });

test("qr probe classification compares candidates against both controls", () => {
  const controls = [observation("control-sibling", 404), observation("control-void", 404)];

  assert.equal(classifyQrProbe([observation("plural", 404)], controls).plural, "absent");
  assert.equal(
    classifyQrProbe([observation("plural", 405, "GET, POST")], controls).plural,
    "present",
  );
  assert.equal(classifyQrProbe([observation("plural", 401)], controls).plural, "present");
});

test("qr probe classification refuses to guess on redirects, server errors, and blind controls", () => {
  const controls = [observation("control-sibling", 404), observation("control-void", 404)];

  assert.equal(classifyQrProbe([observation("plural", 302)], controls).plural, "inconclusive");
  assert.equal(classifyQrProbe([observation("plural", 500)], controls).plural, "inconclusive");
  assert.equal(
    classifyQrProbe([observation("plural", 405, "GET")], controls).plural,
    "inconclusive",
  );

  const blind = [observation("control-sibling", 401), observation("control-void", 401)];
  assert.equal(classifyQrProbe([observation("plural", 405, "POST")], blind).plural, "inconclusive");
});

test("qr probe classification treats an identical body as no signal", () => {
  const controls = [observation("control-sibling", 404, null, "same-page")];

  assert.equal(
    classifyQrProbe([observation("plural", 200, null, "same-page")], controls).plural,
    "inconclusive",
  );
});

test("probe honours redirect manual so a redirect cannot replay the request elsewhere", async () => {
  let candidateHits = 0;
  let foreignHits = 0;
  let foreignUrl = "";

  const foreign = createServer((_req, res) => {
    foreignHits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "fail" }));
  });
  const candidate = createServer((req, res) => {
    candidateHits += 1;
    res.writeHead(307, { location: foreignUrl });
    res.end();
  });

  const listen = (server: ReturnType<typeof createServer>) =>
    new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });

  const foreignPort = await listen(foreign);
  foreignUrl = `http://127.0.0.1:${foreignPort}/steal`;
  const candidatePort = await listen(candidate);

  try {
    const result = await probe(
      `http://127.0.0.1:${candidatePort}/index.php/absensi/proses_absen/${QR_PROBE_DUMMY_TOKEN}`,
      "OPTIONS",
      {},
      undefined,
      { redirect: "manual" },
    );

    assert.equal(result.status, 307);
    assert.equal(candidateHits, 1);
    assert.equal(foreignHits, 0);
  } finally {
    await new Promise<void>((resolve) => candidate.close(() => resolve()));
    await new Promise<void>((resolve) => foreign.close(() => resolve()));
  }
});

test("probe reports the Allow header so a 405 can be classified", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response("", {
      status: 405,
      headers: { allow: "POST" },
    })) as typeof fetch;

  try {
    const result = await probe(
      `https://api.siap.undip.ac.id/index.php/absensi/proses_absen/${QR_PROBE_DUMMY_TOKEN}`,
      "OPTIONS",
      {},
      undefined,
      { redirect: "manual" },
    );

    assert.equal(result.status, 405);
    assert.equal(result.allow, "POST");
  } finally {
    global.fetch = originalFetch;
  }
});
