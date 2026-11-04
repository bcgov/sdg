import type { z } from 'zod';

/** The spike's channels (R44). */
export const CHANNELS = ['in-app', 'email', 'webhook'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * How a channel delivers (R45): the channel it serves, the configuration it takes and which of those fields are
 * secret. Secret fields are sealed at rest and never returned or logged (R48).
 */
export interface IntegrationType<Key extends string = string, Config extends object = object> {
  readonly key: Key;
  readonly channel: Channel;
  /** Validates a sender's override, and the platform default built from the environment. */
  readonly configSchema: z.ZodType<Config, object>;
  readonly secretFields: readonly (keyof Config & string)[];
}

/** Keeps the literal key and config type of a declaration. */
export function defineIntegrationType<Key extends string, Config extends object>(
  type: IntegrationType<Key, Config>,
): IntegrationType<Key, Config> {
  return type;
}
