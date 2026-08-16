/// <reference types="node" />
/**
 * Spike probe harness untuk discover URL SIAP jadwal/kehadiran/QR.
 * Memakai cookie session SIAP live + header X-Requested-With (guard CI).
 * TIDAK menebak hasil — hanya men-dump preview respons mentah untuk dianalisis.
 *
 * Konsumsi env:
 *   SIAP_SESSION_COOKIE  — raw `sia_app_session=...; ...` dari session SIAP live
 *   BACKEND_BASE_URL     — default `http://localhost:3000` (tidak dipakai probe langsung)
 *
 * Driver CLI: `npx ts-node tools/siap-probe.ts <jadwal|kehadiran|qr>` — loop
 * kandidat URL untuk kategori tersebut dan dump preview tiap respons.
 */
export interface ProbeResponse {
  url: string;
  status: number;
  contentType: string | null;
  preview: string;
  isLoginRedirect: boolean;
  bytes: number;
}

async function readPreview(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.clone().arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

/**
 * Seed kandidat URL untuk probe. CATATAN: kandidat ini BELUM TERBUKTI — path
 * di bawah adalah tebakan berlabel; jangan perlakukan sebagai semi-verified.
 * Path yang benar-benar fresh didapat dari probe itu sendiri. Referensi path
 * yang TERBUKTI (untuk mempelajari bentuk): `siap.service.ts` memakai
 * `https://siap.undip.ac.id/irs/mhs/irs/get_irs` dan
 * `.../pages/mhs/dashboard/ajax/*` (getNotifications).
 */
export function listCandidateUrls(): string[] {
  return [
    "https://siap.undip.ac.id/jadwal",
    "https://siap.undip.ac.id/jadwal/mhs",
    "https://siap.undip.ac.id/jadwal/kuliah",
    "https://siap.undip.ac.id/jadwal/mhs/jadwal",
    "https://siap.undip.ac.id/irs/mhs/jadwal",
    "https://siap.undip.ac.id/kehadiran",
    "https://siap.undip.ac.id/absensi",
    "https://siap.undip.ac.id/presensi/mhs",
    "https://siap.undip.ac.id/absensi/mhs",
  ];
}

/** Probe satu URL, dump preview. */
export async function probe(
  url: string,
  init: RequestInit,
): Promise<ProbeResponse> {
  const cookie = process.env.SIAP_SESSION_COOKIE ?? "";
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Cookie: cookie,
        "X-Requested-With": "XMLHttpRequest",
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    return {
      url,
      status: 0,
      contentType: null,
      preview: `FETCH_ERR: ${(e as Error).message}`,
      isLoginRedirect: false,
      bytes: 0,
    };
  }
  const isLoginRedirect = /\/login(?:\/|$)/i.test(res.url ?? "");
  return {
    url,
    status: res.status,
    contentType: res.headers.get("content-type"),
    preview: await readPreview(res),
    isLoginRedirect,
    bytes: Number(res.headers.get("content-length") ?? 0),
  };
}

// Track buffer for the Node --test runner.
declare const console: { log(...args: unknown[]): void };

if (require.main === module) {
  const category = process.argv[2] ?? "jadwal";
  const filter = (() => {
    switch (category) {
      case "kehadiran":
      case "absensi":
        return /(kehadiran|absensi|presensi)/;
      case "qr":
        return /absensi/;
      default:
        return /jadwal/;
    }
  })();
  (async () => {
    for (const u of listCandidateUrls().filter((u) => filter.test(u))) {
      const r = await probe(u, { method: "GET" });
      console.log(
        `[${r.status}]${r.isLoginRedirect ? " LOGIN" : ""} ${u}\n` +
          `    ct=${r.contentType} bytes=${r.bytes} preview=${r.preview}\n`,
      );
    }
  })();
}
