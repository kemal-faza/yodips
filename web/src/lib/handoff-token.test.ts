import { describe, expect, it } from 'vitest';
import {
  FRAGMENT_TOKEN_MAX_LEN,
  isHandoffAccessTokenHash,
  parseFragmentAccessToken,
} from './handoff-token';

describe('parseFragmentAccessToken (YD-AUTH-002 shared helper)', () => {
  // Strict three-segment base64url JWT fixture (header.payload.signature) —
  // same shape the capture tool's #access_token fragment delivers.
  const GOOD_TOKEN = 'AAA.BBB.CCC';

  it('parses a valid #access_token=<three-segment JWT> fragment', () => {
    expect(parseFragmentAccessToken(`#access_token=${GOOD_TOKEN}`)).toBe(GOOD_TOKEN);
    expect(isHandoffAccessTokenHash(`#access_token=${GOOD_TOKEN}`)).toBe(true);
  });

  it('tolerates a fragment without a leading #', () => {
    expect(parseFragmentAccessToken(`access_token=${GOOD_TOKEN}`)).toBe(GOOD_TOKEN);
  });

  it('rejects empty/missing values and malformed hashes', () => {
    expect(parseFragmentAccessToken(undefined)).toBeNull();
    expect(parseFragmentAccessToken('')).toBeNull();
    expect(parseFragmentAccessToken('#')).toBeNull();
    expect(parseFragmentAccessToken('#access_token=')).toBeNull();
    expect(parseFragmentAccessToken('#access_token=not-a-jwt')).toBeNull();
    expect(parseFragmentAccessToken('#foo=bar')).toBeNull();
  });

  it('rejects JWT-shaped but non-strict (not base64url) tokens', () => {
    expect(parseFragmentAccessToken('#access_token=aaa.bbb.c cc')).toBeNull();
    expect(parseFragmentAccessToken('#access_token=aaa.bb b.ccc')).toBeNull();
    expect(parseFragmentAccessToken('#access_token=a+b.ccc.ddd')).toBeNull();
    expect(parseFragmentAccessToken('#access_token=a.b.c.d')).toBeNull(); // 4 segments
  });

  it('rejects over-long tokens', () => {
    const big = `${'a'.repeat(FRAGMENT_TOKEN_MAX_LEN + 1)}.b.c`;
    expect(parseFragmentAccessToken(`#access_token=${big}`)).toBeNull();
  });

  it('stops at the first & (extra fragment params are ignored)', () => {
    expect(parseFragmentAccessToken(`#access_token=${GOOD_TOKEN}&x=1`)).toBe(GOOD_TOKEN);
  });
});
