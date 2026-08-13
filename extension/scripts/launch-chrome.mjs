#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const KNOWN_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export function detectChromeBin(env = process.env) {
  // Explicit override IS honored as-is (spawn will fail loudly naming it), so a
  // typo'd CHROME_BIN is surfaced in the error; otherwise pick first existing.
  if (env.CHROME_BIN) return env.CHROME_BIN;
  return KNOWN_PATHS.find((p) => existsSync(p)) ?? null;
}

export function resolveDevProfile(env = process.env) {
  return env.SSO_DEV_PROFILE ?? path.join(os.tmpdir(), 'chrome-sso-dev');
}

export async function isDebugPortOpen(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

export function buildArgs({ port, extRoot, url, profile }) {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${extRoot}`,
    '--no-first-run',
    '--new-window',
    url,
  ];
}

const EXT_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_PORT = 9222;
const DEFAULT_URL = 'http://localhost:5173';

// Node ESM "main" detection (import.meta.main is Deno/Bun-only, NOT Node).
const isMain = process.argv[1] && import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : DEFAULT_PORT);
  const urlIdx = process.argv.indexOf('--url');
  const terminalUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : DEFAULT_URL;
  const profile = resolveDevProfile();

  const bin = detectChromeBin();
  if (!bin || !existsSync(bin)) {
    console.error(`[launch-chrome] Tidak menemukan binary Chrome (${bin ?? 'none'}). Set env CHROME_BIN ke path yang valid.`);
    process.exit(1);
  }
  if (await isDebugPortOpen(port)) {
    console.log(`[launch-chrome] Chrome dev sudah berjalan di port ${port} — melewati launch.`);
    process.exit(0);
  }
  const args = buildArgs({ port, extRoot: EXT_ROOT, url: terminalUrl, profile });
  console.log(`[launch-chrome] ${bin} ${args.join(' ')}`);
  const child = spawn(bin, args, { stdio: 'ignore', detached: true });
  child.unref();
  process.exit(0);
}