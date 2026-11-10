/** Readiness checks by name: each resolves when its dependency is reachable and rejects (or times out) otherwise. */
export type ReadinessChecks = Readonly<Record<string, () => Promise<unknown>>>;

/** The `ReadinessChecks` HealthModule's factory provides. */
export const READINESS_CHECKS: unique symbol = Symbol('READINESS_CHECKS');

/** A check still pending after this long counts as down. */
export const CHECK_TIMEOUT_MS = 3000;
