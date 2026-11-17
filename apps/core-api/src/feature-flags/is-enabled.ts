import { createHash } from 'node:crypto';
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPct: number; // 0–100
}
export type Flags = Map<string, FeatureFlag>;
export type Overrides = Map<string, boolean>; // keyed by `${flagKey}:${userId}`
/** The switch is a kill switch: an off or missing flag is off for everyone. While it is on, an override decides, then the rollout. */
export function isEnabled(flagKey: string, userId: string | number, flags: Flags, overrides: Overrides): boolean {
  const flag = flags.get(flagKey);
  if (!flag?.enabled) return false;
  const id = `${flagKey}:${userId}`;
  const override = overrides.get(id);
  if (override !== undefined) return override;
  // Hash to a stable bucket from 0 to 99. Not a security use, but SHA-256 keeps code scanning quiet about a weak hash.
  const hash = createHash('sha256').update(id).digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return bucket < flag.rolloutPct;
}
