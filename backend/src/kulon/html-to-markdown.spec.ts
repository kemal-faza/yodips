import { htmlToMarkdown } from './html-to-markdown';

describe('htmlToMarkdown', () => {
  it('converts bold/italic and paragraphs', () => {
    expect(htmlToMarkdown('<p>Kerjakan <strong>modul 1</strong> dan <em>kumpulkan</em>.</p>'))
      .toBe('Kerjakan **modul 1** dan *kumpulkan*.');
  });

  it('converts headings with blank line', () => {
    expect(htmlToMarkdown('<h2>Petunjuk</h2><p>Baca dulu.</p>')).toBe('## Petunjuk\n\nBaca dulu.');
    expect(htmlToMarkdown('<h1>Judul</h1><p>Isi</p>')).toBe('# Judul\n\nIsi');
  });

  it('converts unordered list', () => {
    expect(htmlToMarkdown('<ul><li>Poin A</li><li>Poin B</li></ul>')).toBe('- Poin A\n- Poin B');
  });

  it('converts ordered list', () => {
    expect(htmlToMarkdown('<ol><li>Langkah 1</li><li>Langkah 2</li></ol>')).toBe('1. Langkah 1\n2. Langkah 2');
  });

  it('converts links and images', () => {
    expect(htmlToMarkdown('<p><a href="https://x.contoh/a">Lihat</a> dan <img src="https://x.contoh/b.png" alt="gambar" /></p>'))
      .toBe('[Lihat](https://x.contoh/a) dan ![gambar](https://x.contoh/b.png)');
  });

  it('converts inline code and code block', () => {
    expect(htmlToMarkdown('<p>Pakai <code>run()</code> lalu</p><pre><code>npm test</code></pre>'))
      .toBe('Pakai `run()` lalu\n\n```\nnpm test\n```');
  });

  it('converts blockquote', () => {
    expect(htmlToMarkdown('<blockquote>Catatan penting</blockquote>')).toBe('> Catatan penting');
  });

  it('handles nested list and br', () => {
    const nested = htmlToMarkdown('<ul><li>A<ul><li>A1</li></ul></li></ul>');
    expect(nested).toMatch(/-\s*A\s*\n\s+-\s*A1/);
    expect(htmlToMarkdown('<p>Baris satu<br>Baris dua</p>')).toBe('Baris satu\nBaris dua');
  });

  it('collapses blank input', () => {
    expect(htmlToMarkdown('<p>  </p>')).toBe('');
    expect(htmlToMarkdown('')).toBe('');
  });

  it('decodes entities and emits pure markdown (no tag chars)', () => {
    const out = htmlToMarkdown('<p>A &lt; B &amp; C</p>');
    expect(out).toBe('A < B & C');
    expect(out).not.toMatch(/<\/?[a-z]+/i);
  });

  it('maps u/s/sub/sup', () => {
    expect(htmlToMarkdown('<p><u>urus</u> dan <s>coret</s></p>')).toBe('urus dan ~~coret~~');
    expect(htmlToMarkdown('<p><sub>2</sub> dan <sup>3</sup></p>')).toBe('2 dan 3');
  });

  // Div is NOT in the sanitizer allowlist (sanitize-description.ts) so it never
  // reaches turndown in production; this documents the fallback behavior:
  // an out-of-allowlist block element collapses to its plain text content.
  it('collapses unknown block (div) to plain text', () => {
    expect(htmlToMarkdown('<div>x</div>')).toBe('x');
  });
});
