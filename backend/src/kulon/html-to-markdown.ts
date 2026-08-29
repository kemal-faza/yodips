import TurndownService from 'turndown';
// esModuleInterop:true (tsconfig) → default import gives the constructable class.

/**
 * Convert the narrow, sanitized HTML subset (see sanitize-description.ts
 * allowlist) into Markdown for cross-platform rendering (web markdown-it /
 * CMP multiplatform-markdown-renderer). Returns pure Markdown — never emits
 * tag characters beyond the renderer's own output, so a Markdown renderer
 * with inline-HTML disabled stays safe.
 *
 * turndown@7.2.4 is CommonJS (main: lib/turndown.cjs.js, dep @mixmark-io/domino)
 * so it loads under the CommonJS ts-jest runner (AGENTS.md forbids ESM-only
 * DOM parsers). Custom rules keep em-dash/underline/sub/sup output stable.
 *
 * Note: `div` (and any other non-whitelisted element) is stripped by
 * sanitize-description.ts BEFORE the markup reaches turndown — the sanitizer's
 * allowlist has no `div`, so the tokenizer drops the tag and keeps the text
 * content. Turndown therefore never sees block elements outside its rule set.
 */
const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});
td.addRule('strikethrough', { filter: ['s', 'del'], replacement: (content: string) => `~~${content}~~` });
td.addRule('subsup', { filter: ['sub', 'sup'], replacement: (content: string) => content });
td.addRule('underline', { filter: 'u', replacement: (content: string) => content });

export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  return normalize(td.turndown(html));
}

function normalize(s: string): string {
  return s
    .replace(/[ \t]+$/gm, '')
    .replace(/(-|\d+\.)\s{2,}/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
