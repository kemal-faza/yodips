import { sanitizeDescriptionHtml } from './sanitize-description';

describe('sanitizeDescriptionHtml', () => {
  it('keeps safe rich-text formatting', () => {
    const input = '<p>Kerjakan <strong>laporan</strong> kelompok <em>hari ini</em>.</p>';
    expect(sanitizeDescriptionHtml(input)).toBe(
      '<p>Kerjakan <strong>laporan</strong> kelompok <em>hari ini</em>.</p>',
    );
  });

  it('allows lists, links and images', () => {
    const input =
      '<ul><li>a</li></ul><a href="https://x.com" title="t">link</a><img src="https://kulon2.undip.ac.id/f.png" alt="f">';
    const out = sanitizeDescriptionHtml(input);
    expect(out).toContain('<ul><li>a</li></ul>');
    expect(out).toContain('<a href="https://x.com" title="t">link</a>');
    expect(out).toContain('<img src="https://kulon2.undip.ac.id/f.png" alt="f">');
  });

  it('strips <script>, event handlers and inline styles', () => {
    const input =
      '<p onclick="alert(1)" style="color:red">x</p><script>alert(1)</script><img src=x onerror=alert(1)>';
    const out = sanitizeDescriptionHtml(input);
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('style');
    // <script> is dropped outright; its content survives only as inert TEXT
    // that is never inside a live script/handler context.
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('<p>x</p>');
  });

  it('blocks javascript: and data: URLs', () => {
    const out = sanitizeDescriptionHtml(
      '<a href="javascript:alert(1)">x</a><img src="data:text/html;base64,xx">',
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:');
    expect(out).toContain('<a>x</a>');
  });

  it('drops iframes, objects and unknown tags, keeps their inner text escaped', () => {
    const out = sanitizeDescriptionHtml(
      '<iframe src="https://evil/x"></iframe><object data="x"></object><div>y</div>',
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<div');
    expect(out).toContain('y');
  });

  it('escapes text so stray markup cannot be re-injected', () => {
    const out = sanitizeDescriptionHtml('<p>1 &lt; 2 &gt; 0</p><');
    // Source entities are treated as plain text and re-escaped (& → &amp;), so
    // the visible output equals the source "1 &lt; 2 > 0 <"; no live tag is opened.
    expect(out).toContain('<p>1 &amp;lt; 2 &amp;gt; 0</p>&lt;');
    expect(out).not.toMatch(/<[a-z][^>]*>$/i);
  });
});