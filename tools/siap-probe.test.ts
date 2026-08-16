/**
 * Unit test untuk spike-probe harness (node test runner, bukan jest).
 * Jalankan: node --import ts-node/register --test siap-probe.test.ts
 * (lihat package.json script + README).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probe, listCandidateUrls } from "./siap-probe";

type FakeResponse = {
  status: number;
  url: string;
  headers: { get: (k: string) => string | null };
  clone: () => { arrayBuffer: () => Promise<ArrayBuffer> };
};

function fakeRes(opts: {
  status?: number;
  url?: string;
  body?: string;
  contentType?: string;
}): FakeResponse {
  const { status = 200, url = "", body = "", contentType = "text/html" } = opts;
  const enc = new TextEncoder().encode(body);
  return {
    status,
    url,
    headers: {
      get: (k: string) => (k === "content-type" ? contentType : null),
    },
    clone: () => ({
      arrayBuffer: async () =>
        enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength),
    }),
  };
}

function withFetch(
  mock: () => unknown,
  fn: () => Promise<void>,
): Promise<void> {
  const orig = (globalThis as any).fetch;
  (globalThis as any).fetch = mock;
  try {
    return fn();
  } finally {
    (globalThis as any).fetch = orig;
  }
}

describe("siap-probe", () => {
  it("exposes probe() returning a Promise<ProbeResponse>", () => {
    assert.equal(typeof probe, "function");
    assert.ok(probe("https://siap.undip.ac.id/x", {}) instanceof Promise);
  });

  it("lists candidate URLs without duplicates", () => {
    const urls = listCandidateUrls();
    assert.ok(urls.length >= 5, "expect >=5 candidate URLs");
    assert.equal(new Set(urls).size, urls.length, "no duplicate URLs");
  });

  it("sends the CI guard header + session cookie on every probe", async () => {
    const orig = (globalThis as any).fetch;
    let capturedInit: any = null;
    (globalThis as any).fetch = async (_url: unknown, init?: any) => {
      capturedInit = init;
      return fakeRes({ status: 200 });
    };
    try {
      process.env.SIAP_SESSION_COOKIE = "sia_app_session=P1";
      const r = await probe("https://siap.undip.ac.id/x", { method: "GET" });
      assert.equal(r.status, 200);
      assert.equal(capturedInit.headers["X-Requested-With"], "XMLHttpRequest");
      assert.equal(capturedInit.headers["Cookie"], "sia_app_session=P1");
    } finally {
      delete process.env.SIAP_SESSION_COOKIE;
      (globalThis as any).fetch = orig;
    }
  });

  it("maps a 200 HTML response to a PreviewResponse with stripped preview", async () => {
    await withFetch(
      () =>
        fakeRes({
          status: 200,
          body: "<html><h1>Hi</h1> Berita jadwal</html>",
          contentType: "text/html",
        }),
      async () => {
        const r = await probe("https://siap.undip.ac.id/jadwal", {
          method: "GET",
        });
        assert.equal(r.status, 200);
        assert.equal(r.isLoginRedirect, false);
        assert.equal(r.contentType, "text/html");
        assert.match(r.preview, /Berita jadwal/);
      },
    );
  });

  it("flags a login redirect", async () => {
    await withFetch(
      () => fakeRes({ status: 200, url: "https://sso.undip.ac.id/user/login" }),
      async () => {
        const r = await probe("https://siap.undip.ac.id/jadwal", {
          method: "GET",
        });
        assert.equal(r.isLoginRedirect, true);
      },
    );
  });

  it("returns FETCH_ERR preview when fetch throws", async () => {
    await withFetch(
      () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        const r = await probe("https://siap.undip.ac.id/x", { method: "GET" });
        assert.equal(r.status, 0);
        assert.match(r.preview, /FETCH_ERR/);
      },
    );
  });
});
