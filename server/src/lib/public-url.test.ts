/* eslint-disable sonarjs/no-hardcoded-ip -- IP literals are the test inputs */
import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from './public-url';

const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'treats %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['93.184.216.34', '2606:4700::1111'])('treats %s as public', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertPublicUrl', () => {
  it('accepts a public https URL', async () => {
    await expect(assertPublicUrl('https://example.com/cat.png', resolvesTo('93.184.216.34'))).resolves.toBeInstanceOf(URL);
  });
  it('refuses a hostname that RESOLVES to a private address', async () => {
    // Review Focus 4: ai-chat only compared the hostname string.
    await expect(assertPublicUrl('https://sneaky.example/x', resolvesTo('169.254.169.254'))).rejects.toThrow(/private/);
  });
  it('refuses when any one of several addresses is private', async () => {
    await expect(assertPublicUrl('https://mixed.example/x', resolvesTo('93.184.216.34', '10.0.0.5'))).rejects.toThrow(/private/);
  });
  it('refuses non-http protocols', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', resolvesTo('93.184.216.34'))).rejects.toThrow(/http/);
  });
  it('refuses a malformed URL', async () => {
    await expect(assertPublicUrl('not a url', resolvesTo('93.184.216.34'))).rejects.toThrow(/Invalid URL/);
  });
});
