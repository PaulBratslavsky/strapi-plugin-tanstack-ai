/* eslint-disable sonarjs/no-hardcoded-ip -- IP literals are the test inputs */
import { existsSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import nodePath from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGuardedFetch } from '../lib/guarded-fetch';
import { __setUploadDeps, uploadMedia } from './upload-media';
import { errorText, fakeContentStrapi, runTool, structured } from './test-support';

const publicDns = async () => [{ address: '93.184.216.34' }];
const okFetch = async () =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });

/** A body that yields `chunks` chunks of `size` bytes, with no content-length, and counts what was pulled. */
const PNG = { 'content-type': 'image/png' };
const streamed = (chunks: number, size: number, headers: Record<string, string> = PNG) => {
  const pulled = { chunks: 0 };
  let sent = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= chunks) return controller.close();
        sent += 1;
        pulled.chunks += 1;
        controller.enqueue(new Uint8Array(size));
      },
    },
    { highWaterMark: 0 }, // pull only on demand, so the count means "chunks the tool asked for"
  );
  return { response: new Response(body, { status: 200, headers }), pulled };
};

type UploadCall = { params: { data: { fileInfo: unknown }; files: Record<string, unknown> }; opts?: unknown };
const uploadCall = (calls: Array<{ op: string; params: unknown; opts?: unknown }>) =>
  calls.find((call) => call.op === 'upload') as UploadCall | undefined;

afterEach(() => __setUploadDeps({}));

describe('upload_media', () => {
  it('uploads a public file and says how to attach it', async () => {
    __setUploadDeps({ fetch: okFetch, lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png', alternativeText: 'a cat' });
    expect(structured(result)).toMatchObject({ file: { id: 42, name: 'cat.png' } });
    expect(String(structured(result)?.usage)).toContain('42');
    const upload = uploadCall(calls);
    expect(upload?.params.data.fileInfo).toEqual({ alternativeText: 'a cat' });
    // What the service was actually handed (the fake's reply is fixed, so only this proves anything).
    expect(upload?.params.files).toMatchObject({ originalFilename: 'cat.png', mimetype: 'image/png', size: 3 });
    expect(nodePath.basename(String(upload?.params.files.filepath))).toBe('upload');
  });

  it('passes the caller to the upload service', async () => {
    __setUploadDeps({ fetch: okFetch, lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png' });
    expect(uploadCall(calls)?.opts).toEqual({ user: { id: 7 } });
  });

  it('passes no user when the caller has no admin id', async () => {
    __setUploadDeps({ fetch: okFetch, lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png' }, { userAbility: { can: () => true }, user: { id: 0 } });
    expect(uploadCall(calls)?.opts).toBeUndefined();
  });

  it('passes the caption through, and the requested name as the display name', async () => {
    __setUploadDeps({ fetch: okFetch, lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    await runTool(uploadMedia, strapi, { url: 'https://example.com/x', caption: 'Tabby', name: 'tabby.png' });
    const upload = uploadCall(calls);
    expect(upload?.params.data.fileInfo).toEqual({ caption: 'Tabby' });
    expect(upload?.params.files.originalFilename).toBe('tabby.png');
  });

  it('reports a non-2xx response without uploading', async () => {
    __setUploadDeps({ fetch: async () => new Response('nope', { status: 404, statusText: 'Not Found' }), lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/missing.png' });
    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/404/);
    expect(uploadCall(calls)).toBeUndefined();
  });

  it('turns a network failure into an error result, not a throw', async () => {
    __setUploadDeps({ fetch: async () => { throw new Error('ECONNRESET'); }, lookup: publicDns });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png' });
    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toContain('ECONNRESET');
  });

  it('refuses a private address without fetching', async () => {
    let fetched = false;
    __setUploadDeps({ fetch: async () => { fetched = true; return okFetch(); }, lookup: async () => [{ address: '10.0.0.1' }] });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://internal.example/x' });
    expect(result).toMatchObject({ isError: true });
    expect(fetched).toBe(false);
  });

  it('refuses redirects', async () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the redirect target is the attack being refused
    __setUploadDeps({ fetch: async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1' } }), lookup: publicDns });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/r' });
    expect(errorText(result)).toMatch(/redirect/i);
  });

  it('refuses a caller without media-library upload permission', async () => {
    __setUploadDeps({ fetch: okFetch, lookup: publicDns });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png' }, { userAbility: { can: () => false }, user: { id: 7 } });
    expect(result).toMatchObject({ isError: true });
  });
});

describe('upload_media size cap', () => {
  it('stops a body with no content-length as soon as it passes the cap', async () => {
    const { response, pulled } = streamed(1000, 4);
    let signal: AbortSignal | undefined;
    __setUploadDeps({ fetch: async (_url, init) => { signal = init.signal; return response; }, lookup: publicDns, maxBytes: 10 });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/huge.png' });
    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/larger/);
    expect(uploadCall(calls)).toBeUndefined();
    expect(signal?.aborted).toBe(true); // the connection is dropped, not drained
    expect(pulled.chunks).toBeLessThan(10); // and the rest was never read
  });

  it('refuses a declared content-length over the cap without reading the body', async () => {
    const { response, pulled } = streamed(3, 4, { 'content-type': 'image/png', 'content-length': '100' });
    __setUploadDeps({ fetch: async () => response, lookup: publicDns, maxBytes: 10 });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/big.png' });
    expect(errorText(result)).toMatch(/larger/);
    expect(pulled.chunks).toBe(0);
    expect(uploadCall(calls)).toBeUndefined();
  });

  it('accepts a body exactly at the cap', async () => {
    const { response } = streamed(2, 5);
    __setUploadDeps({ fetch: async () => response, lookup: publicDns, maxBytes: 10 });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/ok.png' });
    expect(result).not.toMatchObject({ isError: true });
    expect(uploadCall(calls)?.params.files.size).toBe(10);
  });
});

describe('upload_media content types', () => {
  const run = async (contentType: string, uploadSecurity?: { allowedTypes?: string[]; deniedTypes?: string[] }) => {
    __setUploadDeps({
      fetch: async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': contentType } }),
      lookup: publicDns,
    });
    const { strapi, calls } = fakeContentStrapi({ uploadSecurity });
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/f' });
    return { result, uploaded: uploadCall(calls) !== undefined };
  };

  it('always refuses active content types, with no config', async () => {
    const { result, uploaded } = await run('text/html; charset=utf-8');
    expect(result).toMatchObject({ isError: true });
    expect(uploaded).toBe(false);
  });
  it('refuses a type the operator denies', async () => {
    const { uploaded } = await run('audio/mpeg', { deniedTypes: ['audio/*'] });
    expect(uploaded).toBe(false);
  });
  it('refuses a type outside the operator allow-list', async () => {
    const { uploaded } = await run('application/pdf', { allowedTypes: ['image/*'] });
    expect(uploaded).toBe(false);
  });
  it('allows a type the operator allows', async () => {
    const { uploaded } = await run('image/webp', { allowedTypes: ['image/*'] });
    expect(uploaded).toBe(true);
  });
});

describe('upload_media crafted names', () => {
  it.each([
    ['..', 'upload'],
    ['.', 'upload'],
    ['a\0b.png', 'upload'],
    ['../../etc/passwd', 'passwd'],
    ['x'.repeat(300), 'upload'],
  ])('handles name %j without throwing and without leaking the temp dir', async (name, expected) => {
    __setUploadDeps({ fetch: okFetch, lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png', name });
    expect(result).not.toMatchObject({ isError: true });
    const files = uploadCall(calls)?.params.files as { filepath: string; originalFilename: string };
    expect(files.originalFilename).toBe(expected);
    expect(nodePath.basename(files.filepath)).toBe('upload'); // the on-disk name is fixed
    expect(existsSync(nodePath.dirname(files.filepath))).toBe(false); // and the dir is gone
  });
});

describe('upload_media extensions', () => {
  const run = async (url: string, name: string | undefined, contentType = 'image/png', uploadSecurity?: { allowedTypes?: string[] }) => {
    __setUploadDeps({
      fetch: async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': contentType } }),
      lookup: publicDns,
    });
    const { strapi, calls } = fakeContentStrapi({ uploadSecurity });
    const result = await runTool(uploadMedia, strapi, name ? { url, name } : { url });
    return { result, calls };
  };

  it('refuses name x.html even though the server says image/png', async () => {
    const { result, calls } = await run('https://example.com/f', 'x.html');
    expect(result).toMatchObject({ isError: true });
    expect(uploadCall(calls)).toBeUndefined();
  });
  it('refuses a URL path ending .svg even though the server says image/png', async () => {
    const { result, calls } = await run('https://example.com/logo.svg', undefined);
    expect(result).toMatchObject({ isError: true });
    expect(uploadCall(calls)).toBeUndefined();
  });
  it('still accepts photo.PNG as image/png', async () => {
    const { result, calls } = await run('https://example.com/f', 'photo.PNG');
    expect(result).not.toMatchObject({ isError: true });
    expect(uploadCall(calls)?.params.files.originalFilename).toBe('photo.PNG');
  });
  it('applies the operator allow-list to the extension too', async () => {
    const { calls } = await run('https://example.com/f', 'clip.mp4', 'image/png', { allowedTypes: ['image/*'] });
    expect(uploadCall(calls)).toBeUndefined();
  });
});

describe('upload_media hostile servers', () => {
  const ignore = () => {
    /* a client hanging up on the fixture is expected */
  };
  const fixtureLookup = ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
    options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)) as Parameters<
    typeof createGuardedFetch
  >[0];

  it('returns an error result, and does not crash, on a status Response cannot represent', async () => {
    const server = net.createServer((socket) => {
      socket.on('error', ignore);
      socket.once('data', () => socket.end('HTTP/1.1 999 X\r\ncontent-length: 0\r\n\r\n'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      __setUploadDeps({ fetch: createGuardedFetch(fixtureLookup), lookup: publicDns });
      const { strapi, calls } = fakeContentStrapi();
      const result = await runTool(uploadMedia, strapi, { url: `http://fixture.test:${port}/x.png` });
      expect(result).toMatchObject({ isError: true });
      expect(errorText(result)).toMatch(/999/);
      expect(uploadCall(calls)).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('upload_media early refusals', () => {
  it.each([
    ['a redirect', 302, 'image/png'],
    ['a non-2xx', 500, 'image/png'],
    ['a refused type', 200, 'text/html'],
  ])('drops the connection on %s', async (_label, status, contentType) => {
    let signal: AbortSignal | undefined;
    __setUploadDeps({
      fetch: async (_url, init) => {
        signal = init.signal;
        return new Response(new Uint8Array([1]), { status, headers: { 'content-type': contentType } });
      },
      lookup: publicDns,
    });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/f' });
    expect(result).toMatchObject({ isError: true });
    expect(signal?.aborted).toBe(true);
  });
});
