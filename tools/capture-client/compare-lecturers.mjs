#!/usr/bin/env node
// A2 equality harness: compares the code->lecturer mapping from the legacy
// cookie scrape against the token path (v2/lihat_irs) on ONE live session.
// Cookies are harvested read-only over CDP (same pattern as capture-handoff.mjs);
// the JWT lives in memory and is NEVER printed. The browser is never closed and
// the CDP connection is dropped by exiting — browser.close() on a
// connectOverCDP handle can take the user's Chrome down with it.
// Usage:
//   node compare-lecturers.mjs --api <serverUrl> [--cdp http://127.0.0.1:9223] [--stale-sim] [--repeat N] [--endpoint-check] [--endpoint-only] [--out <file>]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export function cookieHeader(cookies, domainPart) {
  const bare = domainPart.replace(/^\./, '');
  return cookies
    .filter((c) => {
      const domain = (c.domain ?? '').replace(/^\./, '');
      if (!domain) return false;
      return domain === bare || bare.endsWith(`.${domain}`);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

export function summarizeCompare(report) {
  const side = (s) =>
    s.ok ? `${s.items.length} kode (${s.durationMs} ms)` : `GAGAL (${s.reason})`;
  const lines = [
    `legacy (cookie scrape): ${side(report.legacy)}`,
    `token  (v2/lihat_irs) : ${side(report.token)}`,
    `production (getLecturers / GET /api/siap/lecturers): ${side(report.production)}`,
    `staleSim              : ${report.staleSim ? 'ya' : 'tidak'}`,
  ];
  if (report.token.ok) {
    lines.push(
      `semester gagal        : ${report.token.failedSemesters.join(', ') || '-'}`,
    );
  }
  lines.push(
    `hanya di legacy (${report.onlyLegacy.length}): ${report.onlyLegacy.join(', ') || '-'}`,
    `hanya di token  (${report.onlyToken.length}): ${report.onlyToken.join(', ') || '-'}`,
    `hanya di production (${report.onlyProduction.length}): ${
      report.onlyProduction.join(', ') || '-'
    }`,
    `hilang di production (${report.missingProduction.length}): ${
      report.missingProduction.join(', ') || '-'
    }`,
    `dosen berbeda legacy vs token (${report.differentDosen.length}): ${
      report.differentDosen.map((d) => d.kode).join(', ') || '-'
    }`,
    `dosen berbeda production vs token (${
      report.differentDosenProduction.length
    }): ${report.differentDosenProduction.map((d) => d.kode).join(', ') || '-'}`,
    `nama_dosen kosong di API (${report.emptyApiDosen.length}): ${
      report.emptyApiDosen.join(', ') || '-'
    }`,
  );
  return lines.join('\n');
}

export function gateVerdict(report) {
  if (!report.legacy.ok) {
    return { pass: false, reason: `legacy ${report.legacy.reason}` };
  }
  if (!report.token.ok) {
    return { pass: false, reason: `token ${report.token.reason}` };
  }
  if (!report.production.ok) {
    return { pass: false, reason: `production ${report.production.reason}` };
  }
  const fails = [];
  if (report.counts.legacy === 0) {
    fails.push('legacy=0 (scrape tidak menghasilkan apa pun)');
  }
  if (report.counts.token === 0) {
    fails.push('token=0 (jalur token tidak menghasilkan apa pun)');
  }
  if (report.counts.production === 0) {
    fails.push('production=0 (jalur produksi tidak menghasilkan apapun)');
  }
  if (report.onlyLegacy.length) fails.push(`onlyLegacy=${report.onlyLegacy.length}`);
  if (report.differentDosen.length) {
    fails.push(`differentDosen=${report.differentDosen.length}`);
  }
  if (report.onlyProduction.length) {
    fails.push(`onlyProduction=${report.onlyProduction.length}`);
  }
  if (report.missingProduction.length) {
    fails.push(`missingProduction=${report.missingProduction.length}`);
  }
  if (report.differentDosenProduction.length) {
    fails.push(
      `differentDosenProduction=${report.differentDosenProduction.length}`,
    );
  }
  if (report.token.failedSemesters.length) {
    fails.push(`failedSemesters=${report.token.failedSemesters.join(',')}`);
  }
  return fails.length
    ? { pass: false, reason: fails.join(' ') }
    : { pass: true, reason: 'setara' };
}

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repeat = Number(get('--repeat') ?? 1);
  return {
    api: get('--api'),
    cdp: get('--cdp') ?? 'http://127.0.0.1:9223',
    staleSim: argv.includes('--stale-sim'),
    endpointCheck: argv.includes('--endpoint-check'),
    endpointOnly: argv.includes('--endpoint-only'),
    repeat: Number.isFinite(repeat) && repeat >= 1 ? Math.floor(repeat) : 1,
    out: get('--out'),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.api) {
    console.error(
      'Usage: node compare-lecturers.mjs --api <serverUrl> [--cdp http://127.0.0.1:9223] [--stale-sim] [--repeat N] [--endpoint-check] [--endpoint-only] [--out <file>]',
    );
    process.exit(2);
  }
  const api = opts.api.replace(/\/+$/, '');
  const browser = await chromium.connectOverCDP(opts.cdp);
  const context = browser.contexts()[0];
  if (!context) {
    console.error(
      'Tidak ada browser context — jalankan Chrome dengan --remote-debugging-port dulu.',
    );
    process.exit(1);
  }
  const cookies = await context.cookies();
  const body = {
    kulonCookie: cookieHeader(cookies, 'kulon2.undip.ac.id'),
    ssoCookie: cookieHeader(cookies, 'sso.undip.ac.id'),
    microsoftCookie: cookieHeader(cookies, 'microsoftonline.com'),
    siapCookie: cookieHeader(cookies, 'siap.undip.ac.id'),
  };
  if (!body.kulonCookie) {
    console.error(
      'ERROR: cookie Kulon tidak ditemukan — login ke Kulon dulu di browser ini.',
    );
    process.exit(1);
  }
  if (!body.siapCookie) {
    console.error(
      'ERROR: cookie SIAP tidak ditemukan — sesi tanpa cookie tidak bisa mint token (no-emailSso).',
    );
    process.exit(1);
  }

  // ONE handoff for all repetitions. A fresh handoff mints a new
  // `sessionGeneration` (auth.service.ts:124) and every cache key embeds it
  // (session-scope.ts:64), so a new handoff per run can never be warm.
  const handoff = await fetch(`${api}/api/auth/session/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!handoff.ok) {
    console.error(`Handoff gagal: ${handoff.status}`);
    process.exit(1);
  }
  const { accessToken } = await handoff.json();
  if (!accessToken) {
    console.error('Handoff sukses tapi accessToken tidak ada di respons.');
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${accessToken}` };
  let allPass = true;

  // PRODUCTION entry point first, twice: cold then warm. Running it BEFORE the
  // compare keeps the cold call genuinely cold (the compare's `production` side
  // would otherwise warm the lecturers cache first) and makes the request count
  // of the warm call measurable in isolation.
  let endpoint = null;
  if (opts.endpointCheck || opts.endpointOnly) {
    const call = async () => {
      const started = Date.now();
      const res = await fetch(`${api}/api/siap/lecturers`, { headers: auth });
      if (!res.ok) {
        return {
          ok: false,
          reason: `http ${res.status}`,
          durationMs: Date.now() - started,
        };
      }
      const items = await res.json();
      return {
        ok: true,
        items: Array.isArray(items) ? items : [],
        durationMs: Date.now() - started,
      };
    };
    const cold = await call();
    const warm = await call();
    const key = (items) =>
      [...new Set(items.map((i) => i.kode))].sort().join(',');
    endpoint = {
      cold,
      warm,
      identical: cold.ok && warm.ok && key(cold.items) === key(warm.items),
      onlyEndpoint: [],
      onlyToken: [],
    };
    console.log('--- GET /api/siap/lecturers (sebelum compare) ---');
    console.log(
      `cold: ${cold.ok ? `${cold.items.length} kode (${cold.durationMs} ms)` : `GAGAL (${cold.reason})`}`,
    );
    console.log(
      `warm: ${warm.ok ? `${warm.items.length} kode (${warm.durationMs} ms)` : `GAGAL (${warm.reason})`}`,
    );
    console.log(`cold == warm: ${endpoint.identical ? 'ya' : 'TIDAK'}`);
    if (!cold.ok || !warm.ok || !endpoint.identical) allPass = false;
  }

  const compareUrl = `${api}/api/siap/dev/lecturers-compare${
    opts.staleSim ? '?staleSim=1' : ''
  }`;
  const reports = [];
  for (let i = 1; !opts.endpointOnly && i <= opts.repeat; i += 1) {
    const res = await fetch(compareUrl, { headers: auth });
    if (!res.ok) {
      console.error(`Compare gagal: ${res.status}`);
      process.exit(1);
    }
    const report = await res.json();
    reports.push(report);
    const verdict = gateVerdict(report);
    if (!verdict.pass) allPass = false;
    console.log(`--- run ${i}/${opts.repeat} ---`);
    console.log(summarizeCompare(report));
    console.log(`verdict: ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.reason}`);
  }

  // Set equality between what the endpoint served and what the candidate found.
  if (endpoint && !opts.endpointOnly && reports.length > 0) {
    const last = reports[reports.length - 1];
    const tokenItems = last?.token?.ok ? last.token.items : [];
    const coldItems = endpoint.cold.ok ? endpoint.cold.items : [];
    const tokenKeys = new Set(tokenItems.map((i) => i.kode));
    endpoint.onlyEndpoint = [...new Set(coldItems.map((i) => i.kode))]
      .filter((k) => !tokenKeys.has(k))
      .sort();
    endpoint.onlyToken = tokenItems
      .map((i) => i.kode)
      .filter((k) => !coldItems.some((e) => e.kode === k))
      .sort();
    console.log(
      `endpoint vs token | hanya di endpoint: ${
        endpoint.onlyEndpoint.join(', ') || '-'
      } | hanya di token: ${endpoint.onlyToken.join(', ') || '-'}`,
    );
    if (endpoint.onlyEndpoint.length || endpoint.onlyToken.length) {
      allPass = false;
    }
  }

  const out =
    opts.out ??
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '.tmp-test',
      'lecturers-compare',
      `lecturers-compare-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        api,
        staleSim: opts.staleSim,
        repeat: opts.repeat,
        endpointOnly: opts.endpointOnly,
        reports,
        endpoint,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`report: ${out}`);

  process.exit(allPass ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
