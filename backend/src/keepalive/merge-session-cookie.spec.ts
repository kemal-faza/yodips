import { mergeSessionCookie } from './merge-session-cookie';

describe('mergeSessionCookie', () => {
  const matcher = /^(?:sia_|sipp|siapp|ciapp_)/i;

  it('replaces a matching cookie and preserves unrelated pairs', () => {
    expect(
      mergeSessionCookie('sia_app_session=old; other=keep', ['sia_app_session=new; Path=/'], matcher),
    ).toEqual({ cookie: 'sia_app_session=new; other=keep', changed: true });
  });

  it('ignores a deletion header', () => {
    expect(
      mergeSessionCookie('sia_app_session=old; other=keep', ['sia_app_session=; Max-Age=0'], matcher),
    ).toEqual({ cookie: 'other=keep', changed: true });
  });

  it('reports unchanged when no candidate matches', () => {
    expect(
      mergeSessionCookie('other=keep', ['MoodleSession=NEW; Path=/'], matcher),
    ).toEqual({ cookie: 'other=keep', changed: false });
  });

  it('handles malformed Set-Cookie without throwing', () => {
    expect(mergeSessionCookie('sia_app_session=old', ['broken'], matcher)).toEqual({
      cookie: 'sia_app_session=old',
      changed: false,
    });
  });
});
