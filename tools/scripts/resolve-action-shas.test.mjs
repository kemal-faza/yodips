import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSha, listUses, pinWorkflowText } from "./action-pin-lib.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const pinned = { "actions/checkout@v7": SHA };

describe("action-pin-lib", () => {
  it("validateSha accepts 40 lowercase hex and rejects everything else", () => {
    assert.equal(validateSha(SHA), true);
    assert.equal(validateSha(SHA.toUpperCase()), false);
    assert.equal(validateSha("short"), false);
    assert.equal(validateSha("3d3c42e5aac5ba805825da76410c181273ba90b1z"), false);
    assert.equal(validateSha(undefined), false);
    assert.equal(validateSha(42), false);
  });

  it("listUses finds every uses value with 1-based line numbers", () => {
    const text = [
      "name: CI",
      "steps:",
      "      - uses: actions/checkout@v7",
      "        with:",
      "          fetch-depth: 0",
      "      - name: gitleaks",
      "        uses: gitleaks/gitleaks-action@v3",
    ].join("\n");
    const uses = listUses(text);
    assert.equal(uses.length, 2);
    assert.equal(uses[0].line, 3);
    assert.equal(uses[0].uses, "actions/checkout@v7");
    assert.equal(uses[1].line, 7);
    assert.equal(uses[1].uses, "gitleaks/gitleaks-action@v3");
  });

  it("pinWorkflowText rewrites tag refs to sha + comment, preserving indentation", () => {
    const text = "      - uses: actions/checkout@v7\n";
    const { text: out, changed } = pinWorkflowText(text, pinned);
    assert.equal(changed, 1);
    assert.equal(out, `      - uses: actions/checkout@${SHA}  # v7\n`);
  });

  it("pinWorkflowText is idempotent on an already-pinned line", () => {
    const text = `      - uses: actions/checkout@${SHA}  # v7\n`;
    const { text: out, changed } = pinWorkflowText(text, pinned);
    assert.equal(changed, 0);
    assert.equal(out, text);
  });

  it("pinWorkflowText throws on an unpinned ref (fail-closed)", () => {
    const text = "      - uses: softprops/action-gh-release@v3\n";
    assert.throws(() => pinWorkflowText(text, pinned), /not in pinned map/);
  });

  it("pinWorkflowText throws on a malformed pinned sha", () => {
    const bad = { "actions/checkout@v7": "not-a-sha" };
    const text = "      - uses: actions/checkout@v7\n";
    assert.throws(() => pinWorkflowText(text, bad), /invalid pinned sha/);
  });
});
