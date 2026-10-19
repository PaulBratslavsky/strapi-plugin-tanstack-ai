/* eslint-disable sonarjs/no-hardcoded-ip -- this file's whole job is classifying IP ranges; the literals are the data */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Refuse URLs that would make the server fetch from its own network.
 *
 * ai-chat compared the HOSTNAME STRING against private ranges, so any public
 * DNS name pointing at 127.0.0.1 or the cloud metadata address passed. This
 * resolves the name and checks EVERY address it resolves to. It does not pin
 * the address for the fetch that follows, so a rebinding DNS server could still
 * swap answers between the two lookups; the upload also refuses redirects,
 * which closes the more common bypass.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10]] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) is checked as the IPv4 it wraps.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) return blocked.check(ip, 'ipv6');
  return true; // not an IP at all: refuse rather than guess
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true });

export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL provided.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be uploaded.');
  }
  const host = url.hostname.replaceAll(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('That URL points at a private or local network address, which cannot be fetched.');
  }
  return url;
}
