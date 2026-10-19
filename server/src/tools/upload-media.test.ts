/* eslint-disable sonarjs/no-hardcoded-ip -- IP literals are the test inputs */
import { afterEach, describe, expect, it } from 'vitest';
import { __setUploadDeps, uploadMedia } from './upload-media';
import { errorText, fakeContentStrapi, runTool, structured } from './test-support';

const publicDns = async () => [{ address: '93.184.216.34' }];
const okFetch = async () =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });

afterEach(() => __setUploadDeps({}));

describe('upload_media', () => {
  it('uploads a public file and says how to attach it', async () => {
    __setUploadDeps({ fetch: okFetch as typeof fetch, lookup: publicDns });
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png', alternativeText: 'a cat' });
    expect(structured(result)).toMatchObject({ file: { id: 42, name: 'cat.png' } });
    expect(String(structured(result)?.usage)).toContain('42');
    const upload = calls.find((call) => call.op === 'upload')?.params as { data: { fileInfo: unknown } };
    expect(upload.data.fileInfo).toEqual({ alternativeText: 'a cat' });
  });

  it('refuses a private address without fetching', async () => {
    let fetched = false;
    __setUploadDeps({ fetch: (async () => { fetched = true; return okFetch(); }) as typeof fetch, lookup: async () => [{ address: '10.0.0.1' }] });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://internal.example/x' });
    expect(result).toMatchObject({ isError: true });
    expect(fetched).toBe(false);
  });

  it('refuses redirects', async () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the redirect target is the attack being refused
    __setUploadDeps({ fetch: (async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1' } })) as typeof fetch, lookup: publicDns });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/r' });
    expect(errorText(result)).toMatch(/redirect/i);
  });

  it('refuses a caller without media-library upload permission', async () => {
    __setUploadDeps({ fetch: okFetch as typeof fetch, lookup: publicDns });
    const { strapi } = fakeContentStrapi();
    const result = await runTool(uploadMedia, strapi, { url: 'https://example.com/cat.png' }, { userAbility: { can: () => false }, user: { id: 7 } });
    expect(result).toMatchObject({ isError: true });
  });
});
