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