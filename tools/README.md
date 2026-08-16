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

## Catatan

- `capture-client/` dan `edge-flatpak.sh` adalah tooling lama yang berdiri
  sendiri (ada di repo sebelum `tools/siap-probe.ts`) — jangan dihapus.
- `tsconfig.json` menyetel `include: ["*.ts"]` yang hanya menjangkau file
  `*.ts` langsung di folder ini (tidak masuk ke `capture-client/`).
- Runner test memakai **ts-node** (bukan tsx).

## Running

```bash
cd tools
SIAP_SESSION_COOKIE="$SIAP_SESSION_COOKIE" npx ts-node --compiler-options '{"module":"commonjs"}' --test siap-probe.test.ts
```
