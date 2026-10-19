/* eslint-disable sonarjs/no-clear-text-protocols, unicorn/prefer-https -- a local loopback server is the test fixture */
import net, { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createGuardedFetch, guardedFetch } from './guarded-fetch';

// Servers on this machine only: no outside network. The fixture is reached as
// fixture.test, which an injected lookup maps to loopback, so the real,
// unconditional IP-literal check stays in force for everything else.
const fixtureLookup = ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
  options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)) as Parameters<
  typeof createGuardedFetch
>[0];
const fetchFixture = createGuardedFetch(fixtureLookup);

const ignore = () => {
  /* a client hanging up on the fixture is expected */
};

/** A server that answers every request with exactly `reply` (raw bytes, so the status line can be anything). */
async function withRawServer<T>(reply: string, run: (port: number) => Promise<T>): Promise<T> {
  const server = net.createServer((socket) => {
    socket.on('error', ignore);
    socket.once('data', () => socket.end(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run((server.address() as AddressInfo).port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const signal = () => AbortSignal.timeout(5000);
const crlf = (...lines: string[]) => lines.join('\r\n') + '\r\n\r\n';

describe('guardedFetch', () => {
  it('returns a streaming Response', async () => {
    const reply = crlf('HTTP/1.1 200 OK', 'content-type: image/png', 'content-length: 3') + 'abc';
    await withRawServer(reply, async (port) => {
      const response = await fetchFixture(new URL(`http://fixture.test:${port}/a.png`), { signal: signal() });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(await response.text()).toBe('abc');
    });
  });

  it('does not follow redirects', async () => {
    const reply = crlf('HTTP/1.1 302 Found', 'location: http://elsewhere.invalid/', 'content-length: 0');
    await withRawServer(reply, async (port) => {
      const response = await fetchFixture(new URL(`http://fixture.test:${port}/r`), { signal: signal() });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('http://elsewhere.invalid/');
    });
  });

  it.each([999, 600])('rejects, rather than crashing the process, on status %i', async (status) => {
    // Response() throws a RangeError outside 200-599; thrown from the socket's
    // data handler that would be an uncaught exception.
    await withRawServer(crlf(`HTTP/1.1 ${status} Weird`, 'content-length: 0'), async (port) => {
      await expect(fetchFixture(new URL(`http://fixture.test:${port}/x`), { signal: signal() })).rejects.toThrow(
        new RegExp(String(status)),
      );
    });
  });

  it('refuses, at connect time, a hostname that resolves to a private address', async () => {
    // The real guarded lookup: localhost resolves to loopback and must be refused.
    await expect(guardedFetch(new URL('http://localhost:9/a.png'), { signal: signal() })).rejects.toThrow(/private/);
  });

  it.each(['http://127.0.0.1:9/', 'http://[::1]:9/', 'http://169.254.169.254/latest/meta-data'])(
    'refuses a private IP literal %s itself, since node skips lookup for literals',
    async (target) => {
      await expect(guardedFetch(new URL(target), { signal: signal() })).rejects.toThrow(/private/);
    },
  );
});
