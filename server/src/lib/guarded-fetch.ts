import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { guardedLookup } from './public-url';

/**
 * A GET that connects only to public addresses.
 *
 * `fetch` resolves the host itself, so a check made beforehand can be defeated
 * by a DNS server that answers differently the second time. `http.request`
 * takes a `lookup` option, and giving it `guardedLookup` makes the check run on
 * the very lookup the socket connects with. Redirects are never followed (node's
 * http does not), so a 3xx reaches the caller as a 3xx.
 *
 * The result is a web `Response`, so callers can stream `response.body` and
 * stop reading (and abort) as soon as a size cap is hit.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export type Fetcher = (url: URL, init: { signal: AbortSignal }) => Promise<Response>;

export const guardedFetch: Fetcher = (url, { signal }) =>
  new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      // identity: node does not decompress, and an unrequested gzip body would be stored as-is.
      { method: 'GET', lookup: guardedLookup(), signal, headers: { 'accept-encoding': 'identity' } },
      (incoming) => {
        const headers = new Headers();
        const received = Object.entries(incoming.headers);
        for (const [name, value] of received) {
          const values = Array.isArray(value) ? value : [value];
          for (const single of values) {
            if (single !== undefined) headers.append(name, single);
          }
        }
        const status = incoming.statusCode ?? 502;
        const body = NULL_BODY_STATUSES.has(status) ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, statusText: incoming.statusMessage ?? '', headers }));
      },
    );
    request.on('error', reject);
    request.end();
  });
