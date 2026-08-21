/**
 * Dependency-free HTML sanitizer for untrusted, instructor-authored assignment
 * descriptions (Kulon/Moodle) that are later rendered with `v-html` on the
 * client. A strict white-list is used instead of a black-list so anything not
 * explicitly allowed is stripped.
 *
 * Constraint: the backend is CommonJS (ts-jest/Jest) and the maintained
 * sanitizers (sanitize-html, DOMPurify) ship ESM-only HTML parsers that the
 * test runner cannot load. Writing a small, fully-tested tokenizer keeps this
 * dependency-light and unit-testable without ESM.
 *
 * Security model: parse into tags/text tokens, keep only whitelisted tags and
 * whitelisted per-tag attributes, strip `on*` handlers and `javascript:`/`data:`
 * URLs, and always HTML-escape the text content so any stray `<` / `>` from the
 * source cannot be re-injected.
 */

// tags allowed, mapped to the attributes they may carry
const ALLOWED_TAGS: Readonly<Record<string, readonly string[]>> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  sub: [],
  sup: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  pre: [],
  code: [],
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
};

// attributes that must never survive on any tag
const BLOCKED_ATTR = /^on|^style$/i;

// URLs allowed as an <a href> / <img src> value
const ALLOWED_URL_RE = /^(https?:|mailto:)/i;

function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parse and re-emit a sanitized form of [html]. */
export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return '';
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let out = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG_RE.exec(html)) !== null) {
    const [full, closing, rawName, attrsRaw] = m;
    const name = rawName.toLowerCase();
    out += esc(html.slice(lastIndex, m.index));
    lastIndex = m.index + full.length;
    if (!(name in ALLOWED_TAGS)) continue; // drop unknown/dangerous tag; its text is escaped separately
    if (closing) {
      out += `</${name}>`;
      continue;
    }
    const attrs = sanitizeAttrs(name, attrsRaw);
    out += attrs.length ? `<${name} ${attrs}>` : `<${name}>`;
  }
  // Remaining text (incl. anything inside a dropped dangerous tag) is escaped,
  // so it renders as inert text and can never become a live tag again.
  out += esc(html.slice(lastIndex));
  return out;
}

function sanitizeAttrs(tag: string, attrsRaw: string): string {
  const allowed = ALLOWED_TAGS[tag] ?? [];
  // tokenize name=value pairs, tolerating single/double/unquoted values
  const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  const kept: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrsRaw)) !== null) {
    const name = m[1].toLowerCase();
    if (BLOCKED_ATTR.test(name)) continue;
    if (!allowed.includes(name)) continue;
    let value = m[2] ?? '';
    value = value.replace(/^["']|["']$/g, '');
    if (name === 'href' || name === 'src') {
      const trimmed = value.trim();
      if (!ALLOWED_URL_RE.test(trimmed)) continue; // block javascript:/data:
    }
    if (value === '') {
      kept.push(name);
    } else {
      kept.push(`${name}="${esc(value)}"`);
    }
  }
  return kept.join(' ');
}