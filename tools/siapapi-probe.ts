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
 *   3. Endpoint absen API `absensi/proses_absen/{tokenParam}` — apa bentuk
 *      permintaannya & respons TANPA token valid?
 *
 * Driver CLI: `npx ts-node tools/siapapi-probe.ts <fetchers|absen>`.
 *   - `fetchers` (default): probe GET tiap endpoint `.../index.php/<path>`,
 *     dump preview, tandai butuh-auth (401/403 vs 200/404/405).
 *   - `absen`: probe POST `absensi/proses_absen/<dummy-token>` dengan
 *     variasi header (no-auth vs Basic nim:nim) — tanpa valid token, hanya
 *     lihat apakah endpoint merespons dan bentuk body-nya.
 *
 * CATATAN: jangankan tebak — kandidat path di bawah berasal dari decompile,
 * tapi respons mentah dari probe ini yang menentukan bentuk sebenarnya.
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

function readPreview(text: string): string {
  return text
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
): Promise<ProbeResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...extraHeaders,
      },
    });
  } catch (e) {
    return {
      url,
      method,
      status: 0,
      contentType: null,
      preview: `FETCH_ERR: ${(e as Error).message}`,
      bytes: 0,
      hadBasicAuth: Boolean(extraHeaders.Authorization),
    };
  }
  const text = await res.clone().text();
  return {
    url,
    method,
    status: res.status,
    contentType: res.headers.get("content-type"),
    preview: readPreview(text),
    bytes: Number(res.headers.get("content-length") ?? text.length),
    hadBasicAuth: Boolean(extraHeaders.Authorization),
  };
}

function basic(nim: string, secret: string): string {
  return "Basic " + Buffer.from(`${nim}:${secret}`).toString("base64");
}

declare const console: { log(...args: unknown[]): void };

if (require.main === module) {
  const category = process.argv[2] ?? "fetchers";
  (async () => {
    if (category === "absen") {
      // Probe endpoint absen API. Token dummy = GUID palsu (invalid, anti-replay).
      const dummyToken = process.env.SIAPAPI_DUMMY_TOKEN ?? "dummy-qr-token-000000";
      const nim = process.env.SIAPAPI_NIM ?? "";
      const urls = [
        `${SIAPAPI_BASE}/index.php/absensi/proses_absen/${dummyToken}`,
        `${SIAPAPI_BASE}/absensi/proses_absen/${dummyToken}`,
      ];
      for (const u of urls) {
        const variants: Array<[string, Record<string, string>]> = [
          ["POST no-auth", { "Content-Type": "application/x-www-form-urlencoded" }],
          [
            "POST Basic(nim:nim)",
            {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: basic(nim, nim),
            },
          ],
          [
            "POST Basic(nim:token)",
            {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: basic(nim, "dummy-token"),
            },
          ],
        ];
        for (const [label, headers] of variants) {
          const r = await probe(u, "POST", headers);
          console.log(
            `[${r.status}] ${label} ${u}\n` +
              `    ct=${r.contentType} bytes=${r.bytes} preview=${r.preview}` +
              (r.hadBasicAuth ? " [BASIC]" : "") +
              `\n`,
          );
        }
      }
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
        `[${r.status}]${flag} ${r.method} ${u}\n` +
          `    ct=${r.contentType} bytes=${r.bytes} preview=${r.preview}\n`,
      );
    }
  })();
}
