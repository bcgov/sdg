import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * The total time any one outbound call may take: an SMTP send (connection, greeting, every command) or a webhook or
 * callback request (connection, headers, body). The delivery lease is this plus a margin, so a slow send is never
 * reclaimed while it is in flight (KTD1).
 */
export const OUTBOUND_TIMEOUT_MS = 30_000;

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Resolves a hostname to every address it has. */
export type HostLookup = (host: string) => Promise<readonly ResolvedAddress[]>;

/** A host the guard let through, with the one address the connection must use. */
export interface VettedHost {
  /** The host as given (brackets and a trailing dot removed, lower-cased). */
  readonly host: string;
  readonly address: string;
  readonly family: 4 | 6;
  /** On NOTIFICATION_OUTBOUND_ALLOW_HOSTS: exempt from the public-address and TLS checks. */
  readonly exempt: boolean;
}

/** Checks a host before a connection is made to it. {@link OutboundGuard} is the implementation. */
export interface HostVetter {
  vet(host: string): Promise<VettedHost>;
}

/** A destination the guard refused: a non-public address, or a URL that isn't https. Retrying won't help. */
export class OutboundBlockedError extends Error {
  readonly code = 'OUTBOUND_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'OutboundBlockedError';
  }
}

/**
 * Every range that is not global unicast (KTD12), one list per family: a BlockList also checks IPv4 addresses against
 * its IPv6 rules (as IPv4-mapped), which would let `::/3` block every IPv4 address.
 */
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // unspecified, "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  // Outside 2000::/3: unspecified, loopback, IPv4-mapped and -compatible, NAT64 (64:ff9b::/96 and /48),
  // unique-local (fc00::/7), link-local (fe80::/10) and multicast (ff00::/8).
  ['::', 3],
  ['4000::', 2],
  ['8000::', 1],
  // Inside 2000::/3.
  ['2001::', 23], // IETF protocol assignments: Teredo (2001::/32), benchmarking, ORCHID
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** True when `address` (an IP literal) is global unicast. Anything else, including a non-IP string, is false. */
export function isGlobalUnicast(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return family === 4 ? !blockedV4.check(address, 'ipv4') : !blockedV6.check(address, 'ipv6');
}

/** `[::1]` → `::1`, `Mail.Example.com.` → `mail.example.com`. */
function normalizeHost(host: string): string {
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = unbracketed.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

const systemLookup: HostLookup = async (host) => {
  const addresses = await dnsLookup(host, { all: true, order: 'verbatim' });
  return addresses.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};

export interface OutboundGuardOptions {
  /** NOTIFICATION_OUTBOUND_ALLOW_HOSTS: hosts exempt from the public-address and TLS checks. */
  readonly allowHosts: readonly string[];
  /** Defaults to the system resolver (getaddrinfo). */
  readonly lookup?: HostLookup;
}

/**
 * The one outbound guard for webhook, callback and SMTP connections (KTD12, R51). It resolves the host, accepts it
 * only when every address is global unicast, and returns the address the connection is pinned to, so a second DNS
 * answer can't send it elsewhere. Allow-listed hosts are resolved but not checked.
 */
export class OutboundGuard implements HostVetter {
  private readonly allowHosts: ReadonlySet<string>;
  private readonly lookup: HostLookup;

  constructor({ allowHosts, lookup = systemLookup }: OutboundGuardOptions) {
    this.allowHosts = new Set(allowHosts.map(normalizeHost));
    this.lookup = lookup;
  }

  isExempt(host: string): boolean {
    return this.allowHosts.has(normalizeHost(host));
  }

  /** Throws {@link OutboundBlockedError} for a non-public host; DNS errors propagate unchanged. */
  async vet(rawHost: string): Promise<VettedHost> {
    const host = normalizeHost(rawHost);
    const exempt = this.allowHosts.has(host);
    const literal = isIP(host);
    const addresses: readonly ResolvedAddress[] =
      literal === 0 ? await this.lookup(host) : [{ address: host, family: literal === 6 ? 6 : 4 }];
    const [first] = addresses;
    if (!first) throw new Error(`${host} did not resolve to any address`);
    if (!exempt && !addresses.every(({ address }) => isGlobalUnicast(address))) {
      throw new OutboundBlockedError(`${host} resolves to a non-public address`);
    }
    return { host, address: first.address, family: first.family, exempt };
  }

  /**
   * Why a webhook or callback URL can't be used, or null when it can: it must be https, except on an allow-listed
   * host (R51). Used at registration and again before each request.
   */
  urlProblem(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Must be an absolute URL';
    }
    if (parsed.protocol === 'https:') return null;
    if (parsed.protocol === 'http:' && this.isExempt(parsed.hostname)) return null;
    return 'Must be an https:// URL';
  }
}
