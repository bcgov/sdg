// Checks and polling for scripts/e2e.ts.

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Throws `message` unless `condition` holds. */
export function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Polls `probe` until it returns a value; throws "Timed out waiting for <what>" after `timeoutMs` (default 30 s). */
export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined>,
  { timeoutMs = 30_000, intervalMs = 1000 }: WaitOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const attempt = async (): Promise<T> => {
    const found = await probe();
    if (found !== undefined) return found;
    if (Date.now() >= deadline)
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}`);
    await sleep(intervalMs);
    return attempt();
  };
  return attempt();
}
