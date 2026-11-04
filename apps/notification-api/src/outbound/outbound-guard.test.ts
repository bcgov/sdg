import { describe, expect, it, vi } from 'vitest';

import { OutboundBlockedError, OutboundGuard, type HostLookup, type ResolvedAddress } from './outbound-guard.js';

/** A resolver that knows only these names. */
function stubLookup(records: Record<string, readonly ResolvedAddress[]>): HostLookup {
  return vi.fn<HostLookup>((host) => {
    const found = records[host];
    return found ? Promise.resolve(found) : Promise.reject(new Error(`getaddrinfo ENOTFOUND ${host}`));
  });
}

const v4 = (address: string): ResolvedAddress => ({ address, family: 4 });
const v6 = (address: string): ResolvedAddress => ({ address, family: 6 });

describe('OutboundGuard.vet', () => {
  const guard = new OutboundGuard({
    allowHosts: [],
    lookup: stubLookup({
      'intranet.example.com': [v4('10.1.2.3')],
      'mixed.example.com': [v4('93.184.215.14'), v4('192.168.1.10')],
      'public.example.com': [v4('93.184.215.14'), v6('2606:2800:21f:cb07:6820:80da:af6b:8b2c')],
    }),
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['private', '10.0.0.5'],
    ['cloud metadata (link-local)', '169.254.169.254'],
    ['unspecified IPv4', '0.0.0.0'],
    ['unspecified IPv6', '::'],
    ['IPv4-mapped private', '::ffff:10.0.0.1'],
    ['NAT64 of a private address', '64:ff9b::a00:5'],
    ['IPv6 loopback', '[::1]'],
    ['CGNAT', '100.64.0.1'],
    ['private 172.16/12', '172.31.255.1'],
    ['private 192.168/16', '192.168.0.1'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['reserved', '240.0.0.1'],
    ['documentation IPv4', '203.0.113.7'],
    ['documentation IPv6', '2001:db8::1'],
    ['unique-local', 'fd12:3456::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['6to4', '2002:a00:1::1'],
    ['Teredo', '2001:0:4136:e378::1'],
  ])('rejects %s (%s)', async (_label, host) => {
    await expect(guard.vet(host)).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('rejects a hostname that resolves to a private address', async () => {
    await expect(guard.vet('intranet.example.com')).rejects.toThrow(
      new OutboundBlockedError('intranet.example.com resolves to a non-public address'),
    );
  });

  it('rejects a hostname when any one of its addresses is private', async () => {
    await expect(guard.vet('mixed.example.com')).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('accepts a public hostname and pins it to its first address', async () => {
    await expect(guard.vet('Public.Example.com.')).resolves.toEqual({
      host: 'public.example.com',
      address: '93.184.215.14',
      family: 4,
      exempt: false,
    });
  });

  it('accepts a public IPv6 literal without a lookup', async () => {
    await expect(guard.vet('[2606:4700:4700::1111]')).resolves.toMatchObject({
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });
});

describe('the allow-list', () => {
  it('lets a listed host through even when it resolves to a private address', async () => {
    const guard = new OutboundGuard({
      allowHosts: ['mailpit'],
      lookup: stubLookup({ mailpit: [v4('10.89.0.7')], other: [v4('10.89.0.8')] }),
    });

    await expect(guard.vet('MAILPIT')).resolves.toEqual({
      host: 'mailpit',
      address: '10.89.0.7',
      family: 4,
      exempt: true,
    });
    await expect(guard.vet('other')).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});

describe('OutboundGuard.urlProblem', () => {
  const guard = new OutboundGuard({ allowHosts: ['webhook-receiver'] });

  it.each([
    ['http://hooks.example.com/notify', 'Must be an https:// URL'],
    ['ftp://hooks.example.com/notify', 'Must be an https:// URL'],
    ['not a url', 'Must be an absolute URL'],
    ['https://hooks.example.com/notify', null],
    ['http://webhook-receiver:8080/hook', null],
  ])('%s → %s', (url, problem) => {
    expect(guard.urlProblem(url)).toBe(problem);
  });
});
