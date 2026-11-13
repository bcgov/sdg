import { createHash } from 'node:crypto';
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPct: number; // 0–100
}
export type Flags = Map<string, FeatureFlag>;
export type Overrides = Map<string, boolean>; // keyed by `${flagKey}:${userId}`
export function isEnabled(flagKey: string, userId: string | number, flags: Flags, overrides: Overrides): boolean {
  const id = `${flagKey}:${userId}`;
  const override = overrides.get(id);
  if (override !== undefined) return override;
  const flag = flags.get(flagKey);
  if (!flag || !flag.enabled) return false;
  // Hash to a stable bucket from 0 to 99
  const hash = createHash('sha1').update(id).digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return bucket < flag.rolloutPct;
}
