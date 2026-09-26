/// <reference types="node" />
/**
 * Spike probe harness untuk host API SIAP UNDIP (`api.siap.undip.ac.id`).
 * Data source-nya: decompile APK SIAP UNDIP v2.1.9 (com.undip.siap) —
 * `BuildConfig.BASE_URL = "https://api.siap.undip.ac.id/index.php/"` dan
 * `DefaultApiService` / `SiapApiService` (Retrofit). Host INI belum pernah
 * di-explore oleh backend YoDips (yang selama ini hanya kenal
 * `siap.undip.ac.id` untuk web/Laravel).
 *
 * Pertanyaan yang dijawab spike ini (murni PROBE, bukan menebak):
 *   1. Mana endpoint publik (bisa diakses TANPA header auth)?
 *   2. Mana endpoint yang butuh Basic auth `base64(nim:token)`?
 *   3. Endpoint absen API `absen/proses_absen/{tokenParam}` — apakah route
 *      merespons request dummy tanpa identitas atau kredensial?
 *
 * Driver CLI: `npx ts-node tools/siapapi-probe.ts <fetchers|absen>`.
 *   - `fetchers` (default): probe GET tiap endpoint `.../index.php/<path>`,
 *     dump preview, tandai butuh-auth (401/403 vs 200/404/405).
 *   - `absen`: satu POST ke route singular dengan token all-zero dan
 *     `app_ver=24`; tidak menerima token, identitas, atau auth dari env.
 *
 * CATATAN: kandidat GET path di bawah berasal dari decompile. Probe absen
 * hanya memastikan route merespons; statusnya tidak membuktikan kontrak sukses.
 */

export interface ProbeResponse {
  url: string;
  method: string;
  status: number;
  contentType: string | null;
  preview: string;
  bytes: number;
  hadBasicAuth?: boolean;
}

const QR_TOKEN_PATH = /\/(?:absen|absensi)\/proses_absen\/([^/]+)/i;

/** Drop credentials, query values and QR tokens before a URL enters an artifact. */
export function redactProbeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.pathname = url.pathname.replace(QR_TOKEN_PATH, (match) => {
      const tokenStart = match.lastIndexOf("/") + 1;
      return `${match.slice(0, tokenStart)}[redacted]`;
    });
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[redacted-url]";
  }
}

function redactEchoedQrToken(text: string, rawUrl: string): string {
  try {
    const token = new URL(rawUrl).pathname.match(QR_TOKEN_PATH)?.[1];
    if (!token) return text;
    const variants = new Set([token, decodeURIComponent(token)]);
    return [...variants].reduce((safe, value) => safe.split(value).join("[redacted]"), text);
  } catch {
    return text;
  }
}

function readPreview(text: string, rawUrl: string): string {
  return redactEchoedQrToken(text, rawUrl)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** Base host dari BuildConfig SIAP UNDIP (decompile). */
export const SIAPAPI_BASE = "https://api.siap.undip.ac.id";

/**
 * Kandidat endpoint GET (dari DefaultApiService). Sebagian @POST di SIAP
 * UNDIP, tapi kita probe GET dulu utk lihat apakah host publik (eksploratif).
 */
export function listFetcherCandidates(): string[] {
  const paths = [
    "mahasiswa",
    "mahasiswa_sso",
    "data_mahasiswa",
    "daftar_irs",
    "v2/daftar_khs",
    "v2/lihat_khs",
    "v2/lihat_irs",
    "jadwal",
    "absen",
    "history_absen",
    "status_akademik",
    "semester_aktif",
    "pengumuman",
    "fakultas_irs",
    "prodi_irs",
    "tugas_akhir",
    "bimbingan",
    "v3/matakuliah",
  ];
  return paths.map((p) => `${SIAPAPI_BASE}/index.php/${p}`);
}

/**
 * Probe satu URL (dengan header opsional). Men-dump preview + status +
 * content-type, dan menandai parsing JSON.
 */
export async function probe(
  url: string,
  method = "GET",
  extraHeaders: Record<string, string> = {},
  body?: string,
): Promise<ProbeResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: {
        Accept: "application/json",
        ...extraHeaders,
      },
    });
  } catch (e) {
    return {
      url: redactProbeUrl(url),
      method,
      status: 0,
      contentType: null,
      // Fetch errors may embed the full URL (including a QR token); keep only
      // the category so transport diagnostics cannot leak request data.
      preview: "FETCH_ERR: request failed",
      bytes: 0,
      hadBasicAuth: Boolean(extraHeaders.Authorization),
    };
  }
  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return {
      url: redactProbeUrl(url),
      method,
      status: res.status,
      contentType: res.headers.get("content-type"),
      preview: "BODY_READ_ERR: response body unavailable",
      bytes: Number(res.headers.get("content-length") ?? 0),
      hadBasicAuth: Boolean(extraHeaders.Authorization),
    };
  }
  return {
    url: redactProbeUrl(url),
    method,
    status: res.status,
    contentType: res.headers.get("content-type"),
    preview: readPreview(text, url),
    bytes: Number(res.headers.get("content-length") ?? text.length),
    hadBasicAuth: Boolean(extraHeaders.Authorization),
  };
}

declare const console: { log(...args: unknown[]): void };

if (require.main === module) {
  const category = process.argv[2] ?? "fetchers";
  (async () => {
    if (category === "absen") {
      // Fixed all-zero token; never accept a live QR or identity/auth override.
      const dummyToken = "00000000-0000-0000-0000-000000000000";
      const url = `${SIAPAPI_BASE}/index.php/absen/proses_absen/${dummyToken}`;
      const r = await probe(
        url,
        "POST",
        { "Content-Type": "application/x-www-form-urlencoded" },
        "app_ver=24",
      );
      console.log(
        `[${r.status}] POST ${r.url}\n` +
          `    ct=${r.contentType} bytes=${r.bytes} preview=${r.preview}\n`,
      );
      return;
    }

    for (const u of listFetcherCandidates()) {
      const r = await probe(u, "GET");
      const flag =
        r.status === 401 || r.status === 403
          ? " AUTH"
          : r.status === 200
            ? " PUBLIC"
            : "";
      console.log(
        `[${r.status}]${flag} ${r.method} ${r.url}\n` +
          `    ct=${r.contentType} bytes=${r.bytes} preview=${r.preview}\n`,
      );
    }
  })();
}
