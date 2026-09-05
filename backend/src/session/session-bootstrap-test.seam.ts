/**
 * Test seam for session-bootstrap.regression.spec.ts — a module-level release
 * list the mocked `ioredis` factory resolves against. Kept in its own file so
 * the jest.mock factory (hoisted above imports) can require it without a
 * circular import into the spec.
 */

/** Resolvers for every ioredis connect() currently parked on the gate. */
export const releaseHooks: Array<() => void> = [];
