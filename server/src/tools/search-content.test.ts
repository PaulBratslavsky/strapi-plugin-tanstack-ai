import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';
import { searchContent } from './search-content';

/**
 * `search_content` against a mocked Strapi.
 *
 * The behaviour worth pinning is what makes this tool different from the
 * built-in per-type ones: it fans out across every `api::` type, it refuses
 * arguments that only make sense for one schema, and it survives a type that
 * cannot be searched. None of that is visible from the schema alone.
 */

interface FakeOptions {
  types?: string[];
  docsByType?: Record<string, Array<Record<string, unknown>>>;
  failOn?: string[];
}

function fakeStrapi({ types = [], docsByType = {}, failOn = [] }: FakeOptions) {
  const findMany = vi.fn(async () => []);
  const calls: Array<{ uid: string; params: Record<string, unknown> }> = [];

  const strapi = {
    contentTypes: Object.fromEntries(types.map((uid) => [uid, { uid }])),
    documents: (uid: string) => ({
      findMany: async (params: Record<string, unknown>) => {
        calls.push({ uid, params });
        if (failOn.includes(uid)) throw new Error(`no searchable field on ${uid}`);
        return docsByType[uid] ?? [];
      },
      count: async () => (docsByType[uid] ?? []).length,
    }),
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;

  return { strapi, calls, findMany };
}

const run = (strapi: Core.Strapi, args: Record<string, unknown>) =>
  searchContent.createHandler(strapi, {} as never)({ args, extra: {} } as never);

const structured = (result: unknown) =>
  (result as { structuredContent?: Record<string, unknown> }).structuredContent;

describe('search_content', () => {
  it('fans out across every api:: type when contentType is omitted', async () => {
    // The reason the plugin exists: no per-type built-in can answer a question
    // about the whole library.
    const { strapi, calls } = fakeStrapi({
      types: ['api::article.article', 'api::product.product', 'admin::user'],
    });
    await run(strapi, {});
    expect(calls.map((call) => call.uid)).toEqual(['api::article.article', 'api::product.product']);
  });

  it('leaves non-api types alone', async () => {
    // admin::user and plugin:: types are not the user's content model, and
    // sweeping them would leak internals into an answer.
    const { strapi, calls } = fakeStrapi({ types: ['admin::user', 'plugin::upload.file'] });
    await run(strapi, {});
    expect(calls).toHaveLength(0);
  });

  it('names the valid options when given a type that does not exist', async () => {
    // An opaque failure leaves the model to guess; the list lets it retry with
    // something real.
    const { strapi } = fakeStrapi({ types: ['api::article.article'] });
    const result = await run(strapi, { contentType: 'api::nope.nope' });
    expect(result).toMatchObject({ isError: true });
    expect((result as any).content[0].text).toContain('api::article.article');
  });

  it('refuses filters without a contentType', async () => {
    // filters name fields of ONE schema. Applied across types they would match
    // whatever happened to fit and silently drop the rest, which reads to the
    // model as "no results" rather than as misuse.
    const { strapi } = fakeStrapi({ types: ['api::article.article'] });
    const result = await run(strapi, { filters: { title: { $eq: 'x' } } });
    expect(result).toMatchObject({ isError: true });
  });

  it('refuses sort without a contentType', async () => {
    const { strapi } = fakeStrapi({ types: ['api::article.article'] });
    expect(await run(strapi, { sort: 'createdAt:desc' })).toMatchObject({ isError: true });
  });

  it('strips large text fields by default', async () => {
    // Ten article bodies answer the question and leave no context to reason
    // with. The model can ask for them by name.
    const { strapi } = fakeStrapi({
      types: ['api::article.article'],
      docsByType: {
        'api::article.article': [
          { documentId: 'a1', title: 'Hello', body: 'x'.repeat(5000), description: 'long' },
        ],
      },
    });
    const payload = structured(await run(strapi, {}));
    expect(payload?.results).toEqual([
      { contentType: 'api::article.article', documentId: 'a1', data: { documentId: 'a1', title: 'Hello' } },
    ]);
  });

  it('keeps large fields when includeContent is set', async () => {
    const { strapi } = fakeStrapi({
      types: ['api::article.article'],
      docsByType: { 'api::article.article': [{ documentId: 'a1', body: 'full text' }] },
    });
    const payload = structured(await run(strapi, { includeContent: true }));
    expect((payload?.results as any)[0].data.body).toBe('full text');
  });

  it('caps pageSize regardless of what the model asks for', async () => {
    const { strapi, calls } = fakeStrapi({ types: ['api::article.article'] });
    await run(strapi, { pageSize: 5000 });
    expect(calls[0].params.pageSize).toBe(50);
  });

  it('caps how many types one call will scan, and says so', async () => {
    // `truncated` is the difference between "that is all there is" and "there
    // is more" — without it the model reports a partial sweep as complete.
    const types = Array.from({ length: 30 }, (_, i) => `api::t${i}.t${i}`);
    const { strapi, calls } = fakeStrapi({ types });
    const payload = structured(await run(strapi, {}));
    expect(calls).toHaveLength(25);
    expect(payload).toMatchObject({ scanned: 25, truncated: true });
  });

  it('reports truncated: false when everything was scanned', async () => {
    const { strapi } = fakeStrapi({ types: ['api::article.article'] });
    expect(structured(await run(strapi, {}))).toMatchObject({ truncated: false });
  });

  it('survives a type that cannot be searched', async () => {
    // A schema with no text field throws on _q. Failing the whole fan-out
    // would lose the types that did work.
    const { strapi } = fakeStrapi({
      types: ['api::article.article', 'api::product.product'],
      docsByType: { 'api::product.product': [{ documentId: 'p1', name: 'Widget' }] },
      failOn: ['api::article.article'],
    });
    const payload = structured(await run(strapi, { query: 'widget' }));
    expect(payload?.results).toHaveLength(1);
    expect(payload?.totals).toContainEqual({ contentType: 'api::article.article', total: 0 });
  });

  it('tags every row with the type it came from', async () => {
    // A fan-out mixes types; a row without its origin cannot be linked back
    // or cited.
    const { strapi } = fakeStrapi({
      types: ['api::article.article', 'api::product.product'],
      docsByType: {
        'api::article.article': [{ documentId: 'a1' }],
        'api::product.product': [{ documentId: 'p1' }],
      },
    });
    const payload = structured(await run(strapi, {}));
    expect((payload?.results as any).map((r: any) => r.contentType)).toEqual([
      'api::article.article',
      'api::product.product',
    ]);
  });
});
