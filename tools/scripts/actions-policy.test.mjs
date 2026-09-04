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
        const m = rawLine.match(/^\s*-?\s*uses:\s*([^\s#]+@[0-9a-f]{40})\s{2}#\s+(\S+)/);
        assert.ok(
          m,
          `${wf}:${line} uses: ${value} — expected "owner/repo@<40-hex>  # tag", got bare/malformed ref`,
        );
        const [, pinnedUses, tagComment] = m;
        const [ownerRepo, sha] = pinnedUses.split("@");
        assert.ok(validateSha(sha), `${wf}:${line} sha not 40-hex: ${sha}`);
        // Find the manifest ref (owner/repo@tag) that maps to this sha; the
        // trailing comment must equal that ref's tag.
        const manifestRef = Object.keys(pinned).find(
          (k) => pinned[k] === sha
            && k.split("/")[0] + "/" + k.split("/")[1].split("@")[0] === ownerRepo,
        );
        assert.ok(manifestRef, `${wf}:${line} sha ${sha} not in pinned-actions.json`);
        const manifestTag = manifestRef.split("@")[1];
        assert.equal(
          tagComment,
          manifestTag,
          `${wf}:${line} trailing comment "${tagComment}" != manifest tag "${manifestTag}"`,
        );
      }
    });
  }
});
