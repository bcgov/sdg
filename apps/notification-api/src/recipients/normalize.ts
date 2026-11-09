import type { Channel } from '@repo/notification-database';

import { CHANNEL_DECLARATIONS } from '../channels/channels.js';

/**
 * The stored form of an address, which recipients and contact points are deduplicated by (KTD17): the channel's own
 * normalization. For email that is trimming and lower-casing the whole address, with no plus-address or dot
 * stripping. Throws for a channel without addresses (in-app).
 */
export function normalizeAddress(channel: Channel, address: string): string {
  const normalize = CHANNEL_DECLARATIONS[channel].normalizeAddress;
  if (!normalize) throw new Error(`The ${channel} channel has no addresses`);
  return normalize(address);
}

export const normalizeEmail = (address: string): string => normalizeAddress('email', address);
