import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';
import { listContentTypes } from './list-content-types';

/**
 * `list_content_types` against a mocked Strapi.
 *
 * The load-bearing behaviour is that fields report their CONSTRAINTS. A model
 * told only that `name` exists will send 90 characters to a column capped at
 * 80 and burn its one attempt on the rejected write — which is the lesson the
 * reference plugin's version encodes and the first draft here missed.
 */

function fakeStrapi(contentTypes: Record<string, unknown>) {
  return {
    contentTypes,
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;
}

const run = (strapi: Core.Strapi, args: Record<string, unknown> = {}) =>
  listContentTypes.createHandler(strapi, {} as never)({ args, extra: {} } as never);

const structured = (result: unknown) =>
  (result as { structuredContent?: any }).structuredContent;

const ARTICLE = {
  uid: 'api::article.article',
  kind: 'collectionType',
  info: { displayName: 'Article' },
  attributes: {
    title: { type: 'string', required: true, maxLength: 80 },
    tier: { type: 'enumeration', enum: ['free', 'pro'], default: 'free' },
    slug: { type: 'uid' },
    author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
    seo: { type: 'component', component: 'shared.seo' },
    blocks: { type: 'dynamiczone', components: ['shared.quote', 'shared.media'] },
  },
};

describe('list_content_types', () => {
  it('reports the constraints a write has to respect', async () => {
    const payload = structured(await run(fakeStrapi({ a: ARTICLE })));
    const title = payload.contentTypes[0].fields.find((f: any) => f.name === 'title');
    expect(title).toEqual({ name: 'title', type: 'string', required: true, maxLength: 80 });
  });

  it('reports enum members and defaults', async () => {
    const payload = structured(await run(fakeStrapi({ a: ARTICLE })));
    const tier = payload.contentTypes[0].fields.find((f: any) => f.name === 'tier');
    expect(tier).toMatchObject({ enum: ['free', 'pro'], default: 'free' });
  });

  it('omits constraints a field does not set', async () => {
    // Two keys instead of eight. Across a large schema this is the difference
    // between a listing the model can hold and one that crowds out the
    // question it was asked.
    const payload = structured(await run(fakeStrapi({ a: ARTICLE })));
    const slug = payload.contentTypes[0].fields.find((f: any) => f.name === 'slug');
    expect(Object.keys(slug)).toEqual(['name', 'type']);
  });

  it('separates relations from fields, with their targets', async () => {
    // A relation's target is what lets the model follow it to a second call.
    const payload = structured(await run(fakeStrapi({ a: ARTICLE })));
    expect(payload.contentTypes[0].relations).toEqual([
      { field: 'author', kind: 'manyToOne', target: 'api::author.author' },
    ]);
  });

  it('collects components, including every dynamic-zone member', async () => {
    const payload = structured(await run(fakeStrapi({ a: ARTICLE })));
    expect(payload.contentTypes[0].components).toEqual(
      expect.arrayContaining(['shared.seo', 'shared.quote', 'shared.media']),
    );
  });

  it('lists only api:: types', async () => {
    // admin::, plugin:: and strapi:: are implementation detail; listing them
    // invites the model to poke at the admin schema instead of the content.
    const payload = structured(
      await run(fakeStrapi({ a: ARTICLE, b: { uid: 'admin::user', attributes: {} } })),
    );
    expect(payload.contentTypes.map((c: any) => c.uid)).toEqual(['api::article.article']);
  });

  it('narrows to one type when uid is given', async () => {
    const strapi = fakeStrapi({ a: ARTICLE, b: { uid: 'api::product.product', attributes: {} } });
    const payload = structured(await run(strapi, { uid: 'api::product.product' }));
    expect(payload.contentTypes).toHaveLength(1);
  });

  it('answers an unknown uid with the error branch, listing what exists', async () => {
    // isError XOR structuredContent: a client that trusts structuredContent
    // must never be handed a failure dressed as data.
    const result = await run(fakeStrapi({ a: ARTICLE }), { uid: 'api::nope.nope' });
    expect(result).toMatchObject({ isError: true });
    expect(result).not.toHaveProperty('structuredContent');
    expect((result as any).content[0].text).toContain('api::article.article');
  });
});
