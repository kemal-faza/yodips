// Policy test for YD-CI-001. Reads the four live workflows and the committed
// pin map, and asserts every `uses:` value is a 40-hex SHA with a `# tag`
// comment. FAILS at HEAD (all 22 refs are mutable tags); passes only after
// Tasks 2-4 apply the resolver-emitted pins.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSha, listUses } from "./action-pin-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const pinned = JSON.parse(
  readFileSync(resolve(here, "pinned-actions.json"), "utf8"),
);
const workflows = [
  ".github/workflows/ci.yaml",
  ".github/workflows/deploy-backend.yml",
  ".github/workflows/deploy-web.yml",
  ".github/workflows/release.yml",
];

// A valid pinned uses line: `owner/repo@<40-hex>` followed by ONE-OR-MORE
// spaces/tabs, then `# <tag>` (the tag matching the pinned map). Whitespace
// between the SHA and the `#` comment is deliberately relaxed (any run of
// spaces/tabs) so hand-edits or formatters that collapse "  # " to " # " (or a
// tab) do not fail the policy; the SHA must still be full 40-hex and the tag
// comment must still match the committed pin map (fail-closed otherwise).
// Returns the parsed { ownerRepo, sha, tagComment } or null when malformed.
function parsePinnedLine(rawLine) {
  const m = rawLine.match(/^\s*-?\s*uses:\s*([^\s#]+@[0-9a-f]{40})[ \t]+#[ \t]+(\S+)/);
  if (!m) return null;
  const [, pinnedUses, tagComment] = m;
  const [ownerRepo, sha] = pinnedUses.split("@");
  if (!validateSha(sha)) return null;
  return { ownerRepo, sha, tagComment };
}

function assertPinnedLine(rawLine, pinned, where) {
  const parsed = parsePinnedLine(rawLine);
  assert.ok(
    parsed,
    `${where} — expected "owner/repo@<40-hex>  # tag", got bare/malformed ref`,
  );
  const { ownerRepo, sha, tagComment } = parsed;
  // Find the manifest ref (owner/repo@tag) that maps to this sha; the
  // trailing comment must equal that ref's tag.
  const manifestRef = Object.keys(pinned).find(
    (k) => pinned[k] === sha
      && k.split("/")[0] + "/" + k.split("/")[1].split("@")[0] === ownerRepo,
  );
  assert.ok(manifestRef, `${where} sha ${sha} not in pinned-actions.json`);
  const manifestTag = manifestRef.split("@")[1];
  assert.equal(
    tagComment,
    manifestTag,
    `${where} trailing comment "${tagComment}" != manifest tag "${manifestTag}"`,
  );
}

describe("YD-CI-001 action pin policy", () => {
  for (const wf of workflows) {
    it(`${wf}: every uses: is a pinned 40-hex sha with a # tag comment`, () => {
      const text = readFileSync(resolve(repoRoot, wf), "utf8");
      const uses = listUses(text);
      assert.ok(uses.length > 0, `expected uses: lines in ${wf}`);
      for (const { line, uses: value } of uses) {
        // listUses captures the bare `owner/repo@ref` (regex stops at space/#),
        // so the raw line is the source of truth for the pinned ref form.
        const rawLine = text.split("\n")[line - 1];
        assertPinnedLine(rawLine, pinned, `${wf}:${line} uses: ${value}`);
      }
    });
  }

  // Relaxed comment whitespace: a single space (or tab) before `#` is a valid
  // pin as long as the SHA is full 40-hex and the tag comment matches the map.
  const sha = Object.values(pinned)[0];
  const manifestRef = Object.keys(pinned)[0];
  const ownerRepo = manifestRef.split("@")[0];
  const tag = manifestRef.split("@")[1];

  it("accepts a single-space comment separator (relaxed whitespace)", () => {
    const line = `      - uses: ${ownerRepo}@${sha} # ${tag}`;
    assert.doesNotThrow(() => assertPinnedLine(line, pinned, "single-space"));
  });

  it("accepts a tab comment separator (relaxed whitespace)", () => {
    const line = `      - uses: ${ownerRepo}@${sha}\t#\t${tag}`;
    assert.doesNotThrow(() => assertPinnedLine(line, pinned, "tab"));
  });

  it("accepts a multi-space comment separator", () => {
    const line = `      - uses: ${ownerRepo}@${sha}     # ${tag}`;
    assert.doesNotThrow(() => assertPinnedLine(line, pinned, "multi-space"));
  });

  it("rejects a missing comment (fail-closed)", () => {
    const line = `      - uses: ${ownerRepo}@${sha}`;
    assert.throws(() => assertPinnedLine(line, pinned, "no-comment"), /bare\/malformed/);
  });

  it("rejects a mismatched tag comment (fail-closed)", () => {
    const line = `      - uses: ${ownerRepo}@${sha} # wrong-tag`;
    assert.throws(() => assertPinnedLine(line, pinned, "wrong-tag"), /!= manifest tag/);
  });

  it("rejects a bare mutable ref with no sha (fail-closed)", () => {
    const line = `      - uses: ${ownerRepo}@v9`;
    assert.throws(() => assertPinnedLine(line, pinned, "bare-tag"), /bare\/malformed/);
  });

  it("rejects a truncated sha (fail-closed)", () => {
    const line = `      - uses: ${ownerRepo}@${sha.slice(0, 39)} # ${tag}`;
    assert.throws(() => assertPinnedLine(line, pinned, "short-sha"), /bare\/malformed/);
  });
});
