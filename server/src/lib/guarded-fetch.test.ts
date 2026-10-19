/* eslint-disable sonarjs/no-clear-text-protocols, unicorn/prefer-https -- a local loopback http server is the test fixture */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { guardedFetch } from './guarded-fetch';

// A server on this machine only: no outside network. It is reached by IP
// literal, which skips DNS, so this exercises the request/Response plumbing.
async function withServer<T>(run: (origin: string) => Promise<T>): Promise<T> {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'http://elsewhere.invalid/' }).end();
    } else {
      response.writeHead(200, { 'content-type': 'image/png' }).end('abc');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const fetchFrom = (host: string, port: string, path: string) =>
  guardedFetch(new URL(`http://${host}:${port}${path}`), { signal: AbortSignal.timeout(5000) });

describe('guardedFetch', () => {
  it('returns a streaming Response', async () => {
    await withServer(async (port) => {
      const response = await fetchFrom('127.0.0.1', port, '/a.png');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(await response.text()).toBe('abc');
    });
  });

  it('does not follow redirects', async () => {
    await withServer(async (port) => {
      const response = await fetchFrom('127.0.0.1', port, '/redirect');
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('http://elsewhere.invalid/');
    });
  });

  it('refuses, at connect time, a hostname that resolves to a private address', async () => {
    // localhost resolves to loopback: the lookup the socket uses must refuse it.
    await withServer(async (port) => {
      await expect(fetchFrom('localhost', port, '/a.png')).rejects.toThrow(/private/);
    });
  });
});
