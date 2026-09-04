// Pure, offline GitHub Action pin helpers — no fetch, no process.env.
// Unit-tested by resolve-action-shas.test.mjs (node:test, always offline).

/** True iff sha is a 40-char lowercase hex string. */
export function validateSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha);
}

/**
 * Parse every `uses:` value from workflow text, in document order.
 * Returns [{ line, uses }] where `line` is 1-based and `uses` is the
 * `owner/repo@ref` value (no leading dash, no trailing comment).
 */
export function listUses(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-?\s*uses:\s*([^\s#]+)/);
    if (m) out.push({ line: i + 1, uses: m[1] });
  }
  return out;
}

/**
 * Rewrite every `uses: owner/repo@tag` in workflow text to
 * `uses: owner/repo@<sha>  # tag` using the pinned map
 * { "owner/repo@tag": "<40-hex>" }. Preserves indentation and all other
 * content byte-for-byte. Throws if a uses line references an unpinned ref
 * or a pinned value fails validateSha (fail-closed, no partial writes).
 */
export function pinWorkflowText(text, pinned) {
  const lines = text.split("\n");
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*-?\s*uses:\s*)([^\s#]+)(.*)$/);
    if (!m) continue;
    const [, prefix, uses, rest] = m;
    // Idempotency: skip a line already pinned (`owner/repo@<40-hex>  # tag`)
    // BEFORE the map lookup — the lookup would otherwise throw "ref not in
    // pinned map" for the `owner/repo@<sha>` form on a re-run.
    const tagPart = uses.split("@")[1];
    if (tagPart && validateSha(tagPart)) continue;
    const sha = pinned[uses];
    if (!sha) {
      throw new Error(`ref not in pinned map: ${uses} (line ${i + 1})`);
    }
    if (!validateSha(sha)) {
      throw new Error(`invalid pinned sha for ${uses}: ${JSON.stringify(sha)}`);
    }
    const tag = uses.split("@")[1];
    if (!tag) throw new Error(`ref has no tag part: ${uses} (line ${i + 1})`);
    lines[i] = `${prefix}${uses.split("@")[0]}@${sha}  # ${tag}`;
    changed++;
  }
  return { text: lines.join("\n"), changed };
}
