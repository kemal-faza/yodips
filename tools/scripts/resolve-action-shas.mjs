#!/usr/bin/env node
// YD-CI-001 resolver: fetch authoritative SHAs for every manifest action ref
// from the GitHub REST API, validate 40-hex, write pinned-actions.json, and
// emit pinned workflow copies under .workflows-pinned/ for diff review.
// NEVER guesses a SHA. Any API/validation failure => exit 1 with NO writes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSha, pinWorkflowText } from "./action-pin-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(here, "actions-manifest.json"), "utf8"),
);
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

async function resolveSha(ref) {
  const [ownerRepo, tag] = ref.split("@");
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo || !tag) throw new Error(`malformed ref: ${ref}`);
  const url =
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "yodips-sha-resolver",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${ref}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const sha = json?.sha;
  if (!validateSha(sha)) {
    throw new Error(`non-SHA response for ${ref}: ${JSON.stringify(sha)}`);
  }
  return sha;
}

// Validate every ref BEFORE writing anything (fail-closed: zero writes on any error).
const pinned = {};
for (const ref of manifest.refs) {
  pinned[ref] = await resolveSha(ref);
  console.log(`${ref} -> ${pinned[ref]}`);
}

// Emit pinned workflow copies (transient, gitignored) for diff review — still
// no writes to pinned-actions.json if any workflow cannot be pinned.
const outDir = resolve(here, ".workflows-pinned");
mkdirSync(outDir, { recursive: true });
const emitted = [];
for (const wf of manifest.workflows) {
  const abs = resolve(here, "..", "..", wf);
  const text = readFileSync(abs, "utf8");
  const { text: pinnedText, changed } = pinWorkflowText(text, pinned);
  // changed === 0 is legitimate on replay (workflows already pinned from a
  // prior run) and on a first run after Task 4 hand-edits; the emitted copy is
  // still authoritative. A run where pinWorkflowText THREW (unpinned ref)
  // already aborted above with nothing written.
  const outFile = resolve(outDir, wf.split("/").pop());
  writeFileSync(outFile, pinnedText);
  emitted.push(wf);
  console.log(
    `pinned ${wf} (${changed} uses lines rewritten) -> .workflows-pinned/${wf.split("/").pop()}`,
  );
}

// All workflows emitted successfully: now write the pin map.
writeFileSync(
  resolve(here, "pinned-actions.json"),
  JSON.stringify(pinned, null, 2) + "\n",
);
console.log(`DONE — wrote pinned-actions.json (${Object.keys(pinned).length} refs) and ${emitted.length} pinned workflows`);
