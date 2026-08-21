type ReauthListener = () => void;

const listeners = new Set<ReauthListener>();

/** Notify the app that a genuine auth-token 401 occurred (session invalid). */
export function emitReauthRequested() {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // Never let one handler's failure break the others.
    }
  }
}

/** Subscribe to re-auth requests. Returns an unsubscribe function. */
export function onReauthRequested(cb: ReauthListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

type TokenListener = (token: string) => void;
const tokenListeners = new Set<TokenListener>();

/** Notify subscribers (e.g. the auth store) that the JWT was silently rotated. */
export function emitTokenRefreshed(token: string) {
  for (const cb of [...tokenListeners]) {
    try {
      cb(token);
    } catch {
      // Never let one handler's failure break the others.
    }
  }
}

/** Subscribe to silent JWT rotations. Returns an unsubscribe function. */
export function onTokenRefreshed(cb: TokenListener): () => void {
  tokenListeners.add(cb);
  return () => tokenListeners.delete(cb);
}