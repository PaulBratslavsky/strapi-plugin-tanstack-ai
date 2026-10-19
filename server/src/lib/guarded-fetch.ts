import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { guardedLookup, isPrivateAddress } from './public-url';

/**
 * A GET that connects only to public addresses.
 *
 * `fetch` resolves the host itself, so a check made beforehand can be defeated
 * by a DNS server that answers differently the second time. `http.request`
 * takes a `lookup` option, and giving it `guardedLookup` makes the check run on
 * the very lookup the socket connects with. Redirects are never followed (node's
 * http does not), so a 3xx reaches the caller as a 3xx.
 *
 * node skips `lookup` for an IP-literal host, so a private literal is refused
 * here directly; that check is unconditional.
 *
 * The result is a web `Response`, so callers can stream `response.body` and
 * stop reading (and abort) as soon as a size cap is hit.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export type Fetcher = (url: URL, init: { signal: AbortSignal }) => Promise<Response>;
type Lookup = ReturnType<typeof guardedLookup>;

/**
 * `lookup` exists so tests can map a fake hostname onto a loopback fixture.
 * Only this factory takes it; the production `guardedFetch` below is fixed to
 * the guarded lookup, and nothing reachable from tool input can change that.
 */
export const createGuardedFetch =
  (lookup: Lookup = guardedLookup()): Fetcher =>
  (url, { signal }) =>
    new Promise<Response>((resolve, reject) => {
      const host = url.hostname.replaceAll(/^\[|\]$/g, '');
      if (isIP(host) && isPrivateAddress(host)) {
        reject(new Error('That URL points at a private or local network address, which cannot be fetched.'));
        return;
      }
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(
        url,
        // identity: node does not decompress, and an unrequested gzip body would be stored as-is.
        { method: 'GET', lookup, signal, headers: { 'accept-encoding': 'identity' } },
        (incoming) => {
          // This runs from the socket's data handler: anything thrown here is an
          // uncaught exception that takes the whole server down, so it must reject instead.
          try {
            const status = incoming.statusCode ?? 502;
            // Node's parser accepts any 3-digit status; Response only 200-599.
            if (status < 200 || status > 599) {
              incoming.destroy();
              reject(new Error(`The server answered with an unsupported status code (${status}).`));
              return;
            }
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              const values = Array.isArray(value) ? value : [value];
              for (const single of values) {
                if (single !== undefined) headers.append(name, single);
              }
            }
            const body = NULL_BODY_STATUSES.has(status) ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
            resolve(new Response(body, { status, statusText: incoming.statusMessage ?? '', headers }));
          } catch (error) {
            incoming.destroy();
            reject(error);
          }
        },
      );
      request.on('error', reject);
      request.end();
    });

export const guardedFetch: Fetcher = createGuardedFetch();
