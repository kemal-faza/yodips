// Plain module state: ref-counted logout-in-progress flag + a monotonic reauth
// epoch. No Pinia/Vue/axios. No Promise barrier — the auth store owns the
// shared `logoutFlight` that callers await, while this module only owns the
// synchronous gate. The epoch invalidates an ALREADY-RUNNING waitForReauthResult poll
// started before logout: each beginLogout() bumps it, and the poll's ticks
// compare the epoch they captured at start against the current one.
let inFlight = 0;
let reauthEpoch = 0;

export function beginLogout(): void {
  inFlight += 1;
  reauthEpoch += 1; // invalidate any in-flight reauth poll started earlier
}

export function endLogout(): void {
  if (inFlight > 0) inFlight -= 1;
}

export function isLogoutInProgress(): boolean {
  return inFlight > 0;
}

/** Generation counter bumped on every beginLogout(). */
export function getReauthEpoch(): number {
  return reauthEpoch;
}
