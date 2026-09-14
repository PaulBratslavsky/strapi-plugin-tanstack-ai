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

interface FakeType {
  uid: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Strapi with a fake Content Manager: `hidden` types are not displayed (not in
 * the permissions grid), and only `readable` types pass the read check.
 * Everything displayed is readable unless `readable` says otherwise.
 */
function fakeStrapi(types: FakeType[], options: { hidden?: string[]; readable?: string[] } = {}) {
  const hidden = new Set(options.hidden);
  const displayed = types.filter((type) => !hidden.has(type.uid));
  const readable = new Set(options.readable ?? displayed.map((type) => type.uid));

  const services: Record<string, unknown> = {
    'content-types': { findDisplayedContentTypes: () => displayed },
    'permission-checker': {
      create: ({ model }: { model: string }) => ({ cannot: { read: () => !readable.has(model) } }),
    },
  };

  return {
    contentTypes: Object.fromEntries(types.map((type) => [type.uid, type])),
    plugin: () => ({ service: (name: string) => services[name] }),
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;
}

const CALLER = { userAbility: {}, user: { id: 1 } };

const run = (strapi: Core.Strapi, args: Record<string, unknown> = {}, context: unknown = CALLER) =>
  listContentTypes.createHandler(strapi, context as never)({ args, extra: {} } as never);

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
    const payload = structured(await run(fakeStrapi([ARTICLE])));
    const title = payload.contentTypes[0].fields.find((f: any) => f.name === 'title');
    expect(title).toEqual({ name: 'title', type: 'string', required: true, maxLength: 80 });
  });

  it('reports enum members and defaults', async () => {
    const payload = structured(await run(fakeStrapi([ARTICLE])));
    const tier = payload.contentTypes[0].fields.find((f: any) => f.name === 'tier');
    expect(tier).toMatchObject({ enum: ['free', 'pro'], default: 'free' });
  });

  it('omits constraints a field does not set', async () => {
    // Two keys instead of eight. Across a large schema this is the difference
    // between a listing the model can hold and one that crowds out the
    // question it was asked.
    const payload = structured(await run(fakeStrapi([ARTICLE])));
    const slug = payload.contentTypes[0].fields.find((f: any) => f.name === 'slug');
    expect(Object.keys(slug)).toEqual(['name', 'type']);
  });

  it('separates relations from fields, with their targets', async () => {
    // A relation's target is what lets the model follow it to a second call.
    const payload = structured(await run(fakeStrapi([ARTICLE])));
    expect(payload.contentTypes[0].relations).toEqual([
      { field: 'author', kind: 'manyToOne', target: 'api::author.author' },
    ]);
  });

  it('collects components, including every dynamic-zone member', async () => {
    const payload = structured(await run(fakeStrapi([ARTICLE])));
    expect(payload.contentTypes[0].components).toEqual(
      expect.arrayContaining(['shared.seo', 'shared.quote', 'shared.media']),
    );
  });

  it('lists the permissions grid, plugin types included, and nothing hidden from it', async () => {
    // The grid is Content Manager's displayed types. A transcript an operator
    // can grant is content; admin internals and this plugin's own memories are
    // hidden from Content Manager, so nobody can be granted them.
    const payload = structured(
      await run(
        fakeStrapi(
          [
            ARTICLE,
            { uid: 'plugin::youtube-transcripts.transcript', attributes: {} },
            { uid: 'admin::user', attributes: {} },
            { uid: 'plugin::tanstack-ai.memory', attributes: {} },
          ],
          { hidden: ['admin::user', 'plugin::tanstack-ai.memory'] },
        ),
      ),
    );
    expect(payload.contentTypes.map((c: any) => c.uid)).toEqual([
      'api::article.article',
      'plugin::youtube-transcripts.transcript',
    ]);
  });

  it('omits types the caller cannot read', async () => {
    // Describing Product's fields to a caller with no Read on Product was the
    // 1.0.0 behaviour.
    const strapi = fakeStrapi([ARTICLE, { uid: 'api::product.product', attributes: {} }], {
      readable: ['api::article.article'],
    });
    const payload = structured(await run(strapi));
    expect(payload.contentTypes.map((c: any) => c.uid)).toEqual(['api::article.article']);
  });

  it('fails closed without the caller permissions', async () => {
    expect(await run(fakeStrapi([ARTICLE]), {}, {})).toMatchObject({ isError: true });
  });

  it('narrows to one type when uid is given', async () => {
    const strapi = fakeStrapi([ARTICLE, { uid: 'api::product.product', attributes: {} }]);
    const payload = structured(await run(strapi, { uid: 'api::product.product' }));
    expect(payload.contentTypes).toHaveLength(1);
  });

  it('answers an unknown uid with the error branch, listing what exists', async () => {
    // isError XOR structuredContent: a client that trusts structuredContent
    // must never be handed a failure dressed as data.
    const result = await run(fakeStrapi([ARTICLE]), { uid: 'api::nope.nope' });
    expect(result).toMatchObject({ isError: true });
    expect(result).not.toHaveProperty('structuredContent');
    expect((result as any).content[0].text).toContain('api::article.article');
  });
});
