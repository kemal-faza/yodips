import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'main.css'), 'utf8');

describe('main.css cursor rules', () => {
  it('sets pointer cursor for interactive elements in @layer base', () => {
    expect(css).toContain('cursor: pointer');
    expect(css).toContain('button,');
    expect(css).toContain('role="button"');
  });
  it('keeps disabled interactive elements at not-allowed cursor', () => {
    expect(css).toContain('cursor: not-allowed');
  });
});