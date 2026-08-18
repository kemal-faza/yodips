#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const KNOWN_PATHS = [
  "/opt/microsoft/msedge/microsoft-edge",
  "/usr/bin/microsoft-edge",
  "/snap/bin/microsoft-edge",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

export function detectEdgeBin(env = process.env, knownPaths = KNOWN_PATHS) {
  if (env.EDGE_BIN && existsSync(env.EDGE_BIN)) return env.EDGE_BIN;
  return knownPaths.find((p) => existsSync(p)) ?? null;
}

export function resolveDevProfile(env = process.env) {
  return env.SSO_EDGE_PROFILE ?? path.join(os.tmpdir(), "edge-sso-dev");
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
    "--no-first-run",
    "--new-window",
    url,
  ];
}

const EXT_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_PORT = 9222;
const DEFAULT_URL = "http://localhost:5173";

// Node ESM "main" detection (import.meta.main is Deno/Bun-only, NOT Node).
const isMain =
  process.argv[1] &&
  import.meta.url === url.pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(
    process.argv.includes("--port")
      ? process.argv[process.argv.indexOf("--port") + 1]
      : DEFAULT_PORT,
  );
  const urlIdx = process.argv.indexOf("--url");
  const terminalUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : DEFAULT_URL;
  const profile = resolveDevProfile();

  const bin = detectEdgeBin();
  if (!bin) {
    console.error(
      "[launch-edge] Tidak menemukan binary Edge. Set env EDGE_BIN.",
    );
    process.exit(1);
  }
  if (await isDebugPortOpen(port)) {
    console.log(
      `[launch-edge] Edge dev sudah berjalan di port ${port} — melewati launch.`,
    );
    process.exit(0);
  }
  const args = buildArgs({
    port,
    extRoot: EXT_ROOT,
    url: terminalUrl,
    profile,
  });
  console.log(`[launch-edge] ${bin} ${args.join(" ")}`);
  const child = spawn(bin, args, { stdio: "ignore", detached: true });
  child.unref();
  process.exit(0);
}
