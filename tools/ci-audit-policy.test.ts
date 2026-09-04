/**
 * Regression test untuk kebijakan CI `security-scan` (`.github/workflows/ci.yaml`).
 *
 * Latar belakang (investigasi, HEAD 00427bf): job `security-scan` timeout 10
 * menit, sedangkan `npm audit` di web (npm@12, Bulk Advisory endpoint) yang
 * intermittently 503/timeout bisa menghabiskan ~5 menit per attempt dengan
 * default fetch timeout 300s; retry shell (1..3) berikutnya lalu dibatalkan
 * oleh job timeout. Dependency tree bersih (audit lokal: 0 vuln) — masalahnya
 * murni budget waktu vs flake registry.
 *
 * Invariant yang dijaga (GREEN) — lihat ci.yaml `security-scan`:
 *  1. JOB_BUDGET_MINUTES = 20 (naik dari 10) — ruang untuk retry npm.
 *  2. Tiap audit (backend/web/extension) memakai bounded fetch flags npm:
 *       --fetch-timeout=60000 --fetch-retries=5
 *       --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=60000
 *     (--fetch-timeout=60s adalah aset utama: attempt npm audit tidak lagi
 *     menggantung 300s default; lihat catatan POST no-retry di bawah.)
 *  3. Security gate tetap fail-loud: retry hanya pada KEGAGALAN registry
 *     (exit != 0), dan setelah 3 attempt loop `done`, step WAJIB diakhiri
 *     baris terminal `exit 1`.
 *
 * Catatan verifikasi source npm@12 (2026-09-04): bulk-advisory audit dikirim
 * sebagai POST dan make-fetch-happen/remote.js hard-gate retry utk method
 * POST (isRetriable memerlukan non-POST; catch melempar langsung saat
 * method === 'POST') — jadi --fetch-retries TIDAK menambah durasi audit;
 * mekanisme retry yang sebenarnya adalah loop shell `for i in 1 2 3`.
 * Worst-case jujur saat ini: tiap attempt gagal setelah ≤60s (fetch-timeout);
 * konstanta attempt & sleep DI-PARSE dari tiap step (parseRetryLoop), lalu
 * budget dihitung dari hasil parse — bukan hardcode.
 *   per step = attempt x timeout + (attempt-1) x sleep = 3x60 + 2x10 = 200s
 *   3 step sequential = 600s = 10m < job budget 20m (sisanya utk step lain).
 * Kalau npm kelak me-retry POST (lihat ci.yaml), budget/guard harus naik.
 *
 * Jalankan (tools/):
 *   npm test   (menjalankan .tmp-test/ci-audit-policy.test.js — lihat
 *   package.json; daftar file test eksplisit, ikuti convention yang ada)
 * atau manual:
 *   npm run test:build && node --test .tmp-test/ci-audit-policy.test.js
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// __dirname = tools/.tmp-test (hasil tsc --outDir); repo root = naik 2 level.
const REPO_ROOT = join(__dirname, "..", "..");
const WF = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "ci.yaml"),
  "utf8",
);

const FETCH_FLAGS = [
  "--fetch-timeout=60000",
  "--fetch-retries=5",
  "--fetch-retry-mintimeout=10000",
  "--fetch-retry-maxtimeout=60000",
];

function auditStepLines(): string[] {
  const lines = WF.split("\n");
  const idx: number[] = [];
  lines.forEach((l, i) => {
    if (/name: npm audit \(/.test(l)) idx.push(i);
  });
  assert.equal(
    idx.length,
    3,
    "ci.yaml harus punya tepat 3 step 'npm audit (backend|web|extension)'",
  );
  // Boundary parser: tiap step YAML dimulai dengan marker indent 6-spasi
  // "      - name:". Blok step berakhir pada baris berikutnya yang indentnya
  // SAMA ATAU LEBIH KECIL dari 6 spasi (step berikutnya "      - name: ...",
  // atau key job "  security-scan:"/"  test:" di indent 2). JANGAN memakai
  // baris kolom-0 (/^\S/) sebagai boundary: ci.yaml tidak punya key kolom-0
  // setelah 'jobs:', jadi parser akan menelan sampai EOF bila ada step baru
  // ditambahkan setelah audit — blok step yang di-assert jadi salah-siluman.
  const STEP_INDENT = 6;
  const out: string[] = [];
  for (const start of idx) {
    const end = (() => {
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim().length === 0) continue;
        const indent = l.length - l.trimStart().length;
        if (indent <= STEP_INDENT) return i;
      }
      return lines.length;
    })();
    out.push(lines.slice(start, end).join("\n"));
  }
  return out;
}

/**
 * Parsing retry-loop config dari teks step audit (line-scoped, minimal).
 * Kembalikan { attemptCount, sleepSec } untuk SATU step, atau null bila
 * polanya tidak ditemukan. Ini BUKAN parser YAML generik: cukup ambil angka
 * dari dua baris yang sudah dijamin ada oleh test fail-loud.
 *   - `for i in 1 2 3; do`  -> attemptCount = banyaknya token angka
 *   - `sleep 10`            -> sleepSec    = angka detik
 */
function parseRetryLoop(step: string): { attemptCount: number; sleepSec: number } | null {
  const forLine = step.split("\n").find((l) => /^\s*for i in /.test(l));
  const sleepLine = step.split("\n").find((l) => /^\s*sleep \d+/.test(l));
  if (!forLine || !sleepLine) return null;
  const counts = [...forLine.matchAll(/\d+/g)].map((m) => Number(m[0]));
  const sleepM = sleepLine.trim().match(/^sleep (\d+)$/);
  if (counts.length === 0 || !sleepM) return null;
  // Robust thd urutan bukan 1..N (mis. `for i in 1 2 3`): attempt = jumlah
  // iterasi loop = jumlah token. Kalau suatu saat polanya `1 3` (aneh),
  // hitung sebagai 2 attempt — konservatif benar utk budget (bukan max).
  return { attemptCount: counts.length, sleepSec: Number(sleepM[1]) };
}

function parseFetchTimeoutSec(): number {
  const found = FETCH_FLAGS.map((f) => f.match(/^--fetch-timeout=(\d+)$/))
    .find(Boolean);
  assert.ok(found, "FETCH_FLAGS harus memuat --fetch-timeout=<ms>");
  return Number((found as RegExpMatchArray)[1]) / 1000;
}

describe("ci.yaml security-scan: npm audit bounded retry policy", () => {
  it("memberi job security-scan budget 20 menit (fail-loud, ruang retry)", () => {
    const jobBlock = WF.slice(
      WF.indexOf("  security-scan:"),
      WF.indexOf("  test:"),
    );
    assert.match(
      jobBlock,
      /timeout-minutes:\s*20/,
      "security-scan harus timeout-minutes: 20 (10 menit lama terbukti kurang)",
    );
  });

  it("memuat bounded fetch flags di KETIGA audit (backend/web/extension)", () => {
    const steps = auditStepLines();
    assert.equal(steps.length, 3);
    for (const s of steps) {
      const m = s.match(/name: npm audit \((\w+)\)/);
      assert.ok(m, `step tak bernama jelas: ${s.split("\n")[0]}`);
      assert.ok(
        m[1] === "backend" || m[1] === "web" || m[1] === "extension",
        `audit step tak dikenal: ${m[1]}`,
      );
      // Spec: eksak — keempat flag harus ada persis (bukan sekadar angka
      // timeout); fetch-timeout=60s adalah aset utama anti-gantung-5-menit.
      for (const flag of FETCH_FLAGS) {
        assert.ok(
          s.includes(flag),
          `audit (${m[1]}) wajib memuat flag npm ${flag}`,
        );
      }
    }
  });

  it("tetap fail-loud: retry hanya saat npm audit exit != 0; akhir loop exit 1", () => {
    const steps = auditStepLines();
    for (const s of steps) {
      const m = s.match(/name: npm audit \((\w+)\)/);
      assert.ok(m);
      const runLines = s.split("\n").filter((l) => l.trim().length > 0);
      const last = runLines[runLines.length - 1];
      // Loop retry harus bisa di-parse (dipakai test budget). Test ini TIDAK
      // mewajibkan nilai literal (jumlah attempt/sleep) — itu domain test
      // budget; di sini hanya struktur: parseable + sukses exit 0 + terminal
      // exit 1 setelah done. Jangan pasang /for i in 1 2 3/ atau /sleep 10/
      // literal di sini: itu menutupi (masking) behavioral guard budget.
      assert.ok(
        parseRetryLoop(s),
        `audit (${m[1]}): struktur loop retry harus bisa di-parse ` +
          `(for i in <angka>; do ... sleep <detik> ... done)`,
      );
      assert.match(
        s,
        /npm audit --omit=dev [^\n]*&& exit 0/,
        `audit (${m[1]}): sukses harus exit 0 segera`,
      );
      assert.match(
        s,
        /echo "npm audit attempt \$i failed[^\n]*" >&2/,
        `audit (${m[1]}): log retry ke stderr`,
      );
      // Harus ada baris terminal 'exit 1' SETELAH 'done' (bukan sebarang
      // 'exit 1' di tengah blok): inilah yang bikin audit step gagal-loud
      // setelah attempt terakhir. Asersi per-baris (bukan regex lintas-baris
      // yang longgar) supaya mutation "hapus exit 1 terminal" terbukti gagal.
      const doneIdx = s.indexOf("done");
      assert.ok(doneIdx >= 0, `audit (${m[1]}): blok run harus memuat 'done'`);
      const tailAfterDone = s.slice(doneIdx + "done".length).trim();
      assert.equal(
        tailAfterDone,
        "exit 1",
        `audit (${m[1]}): setelah 'done' harus terminal 'exit 1' (fail-loud), ` +
          `ditemukan: ${JSON.stringify(tailAfterDone)}`,
      );
      assert.equal(
        last.trim(),
        "exit 1",
        `audit (${m[1]}): baris terakhir step harus 'exit 1'`,
      );
    }
  });

  it("budget tiap step & worst-case job dihitung dari parse attempt/sleep/timeout", () => {
    // Verifikasi source npm@12 (2026-09-04): bulk-advisory audit dikirim sbg
    // POST dan make-fetch-happen/remote.js TIDAK me-retry POST, jadi tiap
    // attempt audit gagal setelah ≤ --fetch-timeout (60s) — TIDAK ada backoff
    // eksponensial --fetch-retries yang menambah durasi (retry itu hanya utk
    // request GET idempotent). Math jujur per step, SEMUA konstanta dari hasil
    // parse step tsb sendiri (TIDAK membandingkan antar step & TIDAK hardcode):
    //   per step  = attempt x fetch-timeout + (attempt-1) x sleep
    //   worst job = jumlah per-step ketiga step (sequential)
    const steps = auditStepLines();
    assert.equal(steps.length, 3);
    const perStepBudgetSec = 20 * 60;
    const parsed = steps.map((s) => {
      const m = s.match(/name: npm audit \((\w+)\)/);
      assert.ok(m);
      const cfg = parseRetryLoop(s);
      assert.ok(cfg, `audit (${m[1]}): loop retry harus bisa di-parse`);
      return { name: m[1], ...(cfg as { attemptCount: number; sleepSec: number }) };
    });
    // Guard per-step: SATU step audit tidak boleh sendiri bisa menghabiskan
    // seluruh job budget — kalau iya, job timeout bisa membunuh retry (bug
    // lama 10-menit). Boleh beda antar step; tiap step dihitung independen.
    const perStepSeconds = parsed.map((step) => {
      const sec =
        step.attemptCount * parseFetchTimeoutSec() +
        (step.attemptCount - 1) * step.sleepSec;
      assert.ok(
        sec < perStepBudgetSec,
        `audit (${step.name}): satu step (${step.attemptCount} attempt, ` +
          `timeout ${parseFetchTimeoutSec()}s, sleep ${step.sleepSec}s => ` +
          `${sec}s) harus < job budget ${perStepBudgetSec}s`,
      );
      return sec;
    });
    // Guard worst-case job: ketiga step berjalan sequential dalam 1 job; total
    // wajib <= budget - reserve (sisakan waktu utk npm install -g npm,
    // gitleaks, checkout, dll). Jumlah memakai per-step masing-masing.
    const RESERVE_SEC = 60;
    const totalSec = perStepSeconds.reduce((a, b) => a + b, 0);
    assert.ok(
      totalSec <= perStepBudgetSec - RESERVE_SEC,
      `worst-case ${perStepSeconds.length} audit step sequential ` +
        `${totalSec}s (${perStepSeconds.join(" + ")}s) harus <= ` +
        `${perStepBudgetSec - RESERVE_SEC}s (job budget ${perStepBudgetSec}s ` +
        `- reserve ${RESERVE_SEC}s)`,
    );
    // Catatan untuk perubahan di masa depan:
    //  - fetch-timeout / jumlah attempt / sleep naik → per-step & total di
    //    atas dihitung dari nilai parse (bukan hardcode); kalau membuat
    //    total > budget-reserve, test GAGAL dan budget/struktur harus diubah
    //    sadar-budget.
    //  - --fetch-retries (npm) TIDAK menambah durasi attempt audit (POST
    //    tidak di-retry, lihat header), jadi menaikkan nilainya TIDAK
    //    berbahaya utk budget — TAPI kalau npm suatu saat me-retry POST
    //    (ubah semantik), batas atas per attempt = timeout + 5 backoff
    //    10..60s = 250s, dan 3 step x 3 x 250s ≈ 38m > 20m; saat itu
    //    budget/guard harus naik (lihat juga komentar ci.yaml).
  });
});
