# sso-tools

Utilitas dev mandiri untuk proyek Undip SSO Aggregator (monorepo). Tidak
bergantung pada `backend/`/`web/`/`mobile/`; konsumsi API/endpoint yang sama
via `fetch`.

## Isi

- **`siap-probe.ts`** — spike-probe harness untuk *discover* URL SIAP
  (jadwal/kehadiran/QR). Memakai cookie session SIAP live + header
  `X-Requested-With: XMLHttpRequest` (guard CI `is_ajax_request()`), lalu
  men-dump **preview respons mentah** (bukan menebak hasil). Dasar dari
  `docs/superpowers/spikes/2026-08-14-siap-*.md`.

- **`kulon-ws-probe.ts`** — probe web-service Kulon: mengukur apakah REST
  (`/webservice/rest/server.php`) bisa dipakai menggantikan jalur session-AJAX,
  lalu menulis verdict + laporan ke `docs/probe/`. Hasil keputusan B1 (NO-GO;
  hanya B1-lite yang masuk produksi) berasal dari sini. Modul pendukungnya
  (`kulon-ws-http`, `kulon-ws-steps`, `kulon-ws-shape`, `kulon-ws-report`,
  `kulon-ws-verdict`) adalah pustaka murni tanpa I/O — dipakai probe dan
  diuji satu per satu.

- **`kulon-progress-compare.ts`** — pembanding progress kursus: nilai dari
  `core_courseformat_get_state` yang di-JSON.parse vs hasil scrape HTML, memakai
  **parser produksi** yang sama (`backend/src/kulon/kulon-parse.ts`) supaya
  angkanya setara. Menulis laporan ke `docs/probe/`.

## Menjalankan probe Kulon

Cookie dibaca dari environment, bukan dari argumen, dan tidak pernah masuk
laporan (masking lewat `KULON_PROBE_MASK`).

```bash
cd tools
KULON_SESSION_COOKIE="$KULON_SESSION_COOKIE" npm run kulon:probe
KULON_SESSION_COOKIE="$KULON_SESSION_COOKIE" npm run kulon:compare
```

Variabel yang dikenali: `KULON_SESSION_COOKIE` (atau `KULON_SESSION_COOKIE_FILE`),
`KULON_PROBE_TOKEN`, `KULON_PROBE_LIMIT`, `KULON_PROBE_MASK`, `KULON_PROBE_OUT`,
`KULON_PROBE_BASELINE`.

`docs/` di-gitignore, jadi laporan probe hanya artefak lokal. Kalau sebuah
keputusan perlu dipertahankan, ringkasannya masuk `docs/CHECKPOINT.md`.

## Test

```bash
cd tools
npm test
```

`npm test` mengompilasi **semua** `*.ts` di folder ini ke `.tmp-test/` lalu
menjalankan **setiap** `.tmp-test/*.test.js` (glob, bukan daftar manual) —
menambah file `*.test.ts` baru otomatis ikut teruji. Tahap kedua menjalankan
test `.mjs` yang tidak butuh kompilasi.

Menjalankan satu file secara langsung TIDAK memakai `ts-node --test` (ts-node
menolak flag itu). Yang benar:

```bash
npx tsc -p tsconfig.json --outDir .tmp-test && node --test .tmp-test/kulon-ws-verdict.test.js
```

Jalankan dari folder `tools/`, karena `kulon-progress-compare` me-resolve
`backend/src/kulon/kulon-parse.ts` relatif terhadap lokasi hasil kompilasi.

## Catatan

- `capture-client/` dan `edge-flatpak.sh` adalah tooling lama yang berdiri
  sendiri (ada di repo sebelum `tools/siap-probe.ts`) — jangan dihapus.
- `tsconfig.json` menyetel `include: ["*.ts"]` yang hanya menjangkau file
  `*.ts` langsung di folder ini (tidak masuk ke `capture-client/`).
- Runner test memakai **ts-node** untuk CLI, **node --test** untuk test.
