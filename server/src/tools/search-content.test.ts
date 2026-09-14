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
  /** Types the caller may read. Defaults to all of `types`. */
  readable?: string[];
  /** Fields the caller may NOT read, removed by the fake sanitisers. */
  hiddenFields?: string[];
  /** Types Content Manager hides — not in the permissions grid. */
  hiddenTypes?: string[];
  /** Schema attributes per type. Defaults to a `title` and a `name` string. */
  attributesByType?: Record<string, Record<string, Record<string, unknown>>>;
}

const DEFAULT_ATTRIBUTES = { title: { type: 'string' }, name: { type: 'string' } };

/**
 * A stand-in for content-manager's permission checker.
 *
 * It does what the real one does at the level these tests care about: refuse
 * unreadable types, drop hidden fields from filters and from rows, and add a
 * permission condition to the query. The real sanitisers are Strapi's and are
 * exercised by the live check (`tanstack-client/scripts/rbac-leak-check.mjs`);
 * what is pinned here is that `search_content` actually routes through them.
 */
function fakeChecker(uid: string, readable: Set<string>, hidden: Set<string>) {
  const omitHidden = (record: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !hidden.has(key)));

  // Mirrors the real sanitiser's edge exactly: clauses on hidden fields are
  // dropped, and an `$or` left empty is DELETED rather than kept as "match
  // nothing" — which is what makes the empty-search guard necessary.
  const sanitizeQuery = async (query: Record<string, unknown>) => {
    const filters = query.filters as { $or?: Array<Record<string, unknown>> } | undefined;
    if (!filters?.$or) return query;
    const kept = filters.$or.map((clause) => omitHidden(clause)).filter((clause) => Object.keys(clause).length > 0);
    return { ...query, filters: kept.length > 0 ? { $or: kept } : {} };
  };

  return {
    cannot: { read: () => !readable.has(uid) },
    sanitizeQuery,
    sanitizedQuery: {
      read: async (query: Record<string, unknown>) => ({
        ...query,
        filters: {
          $and: [
            ...(query.filters ? [omitHidden(query.filters as Record<string, unknown>)] : []),
            { permissionCondition: { $eq: true } },
          ],
        },
      }),
    },
    sanitizeOutput: async (doc: Record<string, unknown>) => omitHidden(doc),
  };
}

function fakeStrapi({
  types = [],
  docsByType = {},
  failOn = [],
  readable,
  hiddenFields = [],
  hiddenTypes = [],
  attributesByType = {},
}: FakeOptions) {
  const calls: Array<{ uid: string; params: Record<string, unknown> }> = [];
  const counts: Array<{ uid: string; params: Record<string, unknown> }> = [];
  const readableSet = new Set(readable ?? types);
  const hidden = new Set(hiddenFields);
  const displayed = types.filter((uid) => !hiddenTypes.includes(uid)).map((uid) => ({ uid }));

  const strapi = {
    contentTypes: Object.fromEntries(
      types.map((uid) => [uid, { uid, attributes: attributesByType[uid] ?? DEFAULT_ATTRIBUTES }]),
    ),
    documents: (uid: string) => ({
      findMany: async (params: Record<string, unknown>) => {
        calls.push({ uid, params });
        if (failOn.includes(uid)) throw new Error(`no searchable field on ${uid}`);
        return docsByType[uid] ?? [];
      },
      count: async (params: Record<string, unknown>) => {
        counts.push({ uid, params });
        return (docsByType[uid] ?? []).length;
      },
    }),
    plugin: (name: string) => ({
      service: (service: string) => {
        if (name === 'content-manager' && service === 'content-types') {
          return { findDisplayedContentTypes: () => displayed };
        }
        if (name === 'content-manager' && service === 'permission-checker') {
          return {
            create: ({ model }: { model: string }) => fakeChecker(model, readableSet, hidden),
          };
        }
        throw new Error(`unexpected service ${name}.${service}`);
      },
    }),
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;

  return { strapi, calls, counts };
}

/** Any object will do: the fake checker decides, not the ability itself. */
const CALLER = { userAbility: { can: () => true }, user: { id: 1 } };

const run = (strapi: Core.Strapi, args: Record<string, unknown>, context: unknown = CALLER) =>
  searchContent.createHandler(strapi, context as never)({ args, extra: {} } as never);

const structured = (result: unknown) =>
  (result as { structuredContent?: Record<string, unknown> }).structuredContent;

describe('search_content', () => {
  it('fans out across every type in the permissions grid when contentType is omitted', async () => {
    // The reason the plugin exists: no per-type built-in can answer a question
    // about the whole library. Plugin types in the grid are content too.
    const { strapi, calls } = fakeStrapi({
      types: ['api::article.article', 'plugin::youtube-transcripts.transcript'],
    });
    await run(strapi, {});
    expect(calls.map((call) => call.uid)).toEqual([
      'api::article.article',
      'plugin::youtube-transcripts.transcript',
    ]);
  });

  it('never searches types hidden from Content Manager', async () => {
    // Not in the grid means nobody can be granted it: admin internals, and
    // this plugin's own per-admin memories and notes.
    const { strapi, calls } = fakeStrapi({
      types: ['admin::user', 'plugin::tanstack-ai.memory', 'plugin::tanstack-ai.note'],
      hiddenTypes: ['admin::user', 'plugin::tanstack-ai.memory', 'plugin::tanstack-ai.note'],
    });
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

  describe('read permissions', () => {
    // 1.0.0 checked only the tool's own action, which says nothing about WHICH
    // content the caller may read, and `strapi.documents()` checks nothing. A
    // token Strapi refused `list_product` got every Product from this tool.

    it('skips types the caller cannot read, and does not count them', async () => {
      // A total is data too: "product: 3" beside zero rows is still a leak.
      const { strapi, calls, counts } = fakeStrapi({
        types: ['api::article.article', 'api::product.product'],
        readable: ['api::article.article'],
        docsByType: { 'api::product.product': [{ documentId: 'p1', name: 'Secret' }] },
      });
      const payload = structured(await run(strapi, {}));

      expect(calls.map((call) => call.uid)).toEqual(['api::article.article']);
      expect(counts.map((call) => call.uid)).toEqual(['api::article.article']);
      expect(payload?.totals).toEqual([{ contentType: 'api::article.article', total: 0 }]);
      expect(payload?.scanned).toBe(1);
    });

    it('refuses an unreadable type asked for by name, before any query', async () => {
      const { strapi, calls } = fakeStrapi({
        types: ['api::article.article', 'api::product.product'],
        readable: ['api::article.article'],
      });
      const result = await run(strapi, { contentType: 'api::product.product' });

      expect(result).toMatchObject({ isError: true });
      expect((result as any).content[0].text).toContain('permission');
      expect(calls).toHaveLength(0);
    });

    it('removes fields the caller cannot read from every row', async () => {
      const { strapi } = fakeStrapi({
        types: ['api::product.product'],
        hiddenFields: ['price'],
        docsByType: { 'api::product.product': [{ documentId: 'p1', name: 'Widget', price: 99 }] },
      });
      const payload = structured(await run(strapi, {}));

      expect((payload?.results as any)[0].data).toEqual({ documentId: 'p1', name: 'Widget' });
    });

    it('queries and counts with the permitted filters, not the raw ones', async () => {
      // A filter on a hidden field plus a count reads that field one
      // $startsWith at a time. Both calls must see the sanitised query, and
      // the permission condition must reach both.
      const { strapi, calls, counts } = fakeStrapi({
        types: ['api::product.product'],
        hiddenFields: ['price'],
      });
      await run(strapi, {
        contentType: 'api::product.product',
        filters: { price: { $gt: 1000 }, name: { $eq: 'Widget' } },
      });

      const permitted = {
        $and: [{ name: { $eq: 'Widget' } }, { permissionCondition: { $eq: true } }],
      };
      expect(calls[0].params.filters).toEqual(permitted);
      expect(counts[0].params.filters).toEqual(permitted);
    });

    it('does not let unreadable types use up the scan budget', async () => {
      // Otherwise 25 types the caller cannot see would push every readable one
      // off the end and the search would return nothing, reporting it complete.
      const hiddenTypes = Array.from({ length: 30 }, (_, i) => `api::h${i}.h${i}`);
      const { strapi, calls } = fakeStrapi({
        types: [...hiddenTypes, 'api::article.article'],
        readable: ['api::article.article'],
      });
      const payload = structured(await run(strapi, {}));

      expect(calls.map((call) => call.uid)).toEqual(['api::article.article']);
      expect(payload).toMatchObject({ scanned: 1, truncated: false });
    });

    it('fails closed when the caller has no ability', async () => {
      // A wiring mistake in a read path should return nothing, loudly.
      const { strapi, calls } = fakeStrapi({ types: ['api::article.article'] });
      const result = await run(strapi, {}, {});

      expect(result).toMatchObject({ isError: true });
      expect(calls).toHaveLength(0);
    });
  });

  describe('text search', () => {
    // `_q` matched every text field and the permission sanitiser never touched
    // it: a caller who could read Products but not `price` could search "2400"
    // and learn the price from which row came back.
    const PRODUCT = 'api::product.product';
    const productAttributes = {
      name: { type: 'string' },
      summary: { type: 'text' },
      tier: { type: 'enumeration' },
      price: { type: 'decimal' },
      internalCode: { type: 'string', searchable: false },
      inStock: { type: 'boolean' },
    };
    const searchClauses = (params: Record<string, unknown>) =>
      ((params.filters as any).$and.find((part: any) => part.$or)?.$or ?? []) as Array<Record<string, unknown>>;

    it('searches every readable text field, and not the rest', async () => {
      const { strapi, calls } = fakeStrapi({
        types: [PRODUCT],
        attributesByType: { [PRODUCT]: productAttributes },
        hiddenFields: ['summary'],
      });
      await run(strapi, { query: 'pro' });

      expect(searchClauses(calls[0].params).map((clause) => Object.keys(clause)[0])).toEqual([
        'name',
        'tier',
      ]);
    });

    it('matches a number exactly against readable number fields only', async () => {
      const { strapi, calls, counts } = fakeStrapi({
        types: [PRODUCT],
        attributesByType: { [PRODUCT]: productAttributes },
        hiddenFields: ['price'],
      });
      await run(strapi, { query: '2400' });

      const clauses = searchClauses(calls[0].params);
      expect(clauses).toContainEqual({ id: { $eq: 2400 } });
      expect(clauses.some((clause) => 'price' in clause)).toBe(false);
      // The count is the same leak if it searches differently from the rows.
      expect(searchClauses(counts[0].params)).toEqual(clauses);
    });

    it('returns nothing, without querying, when no readable field is left to search', async () => {
      // The sanitiser DELETES an emptied $or, and a query with no search filter
      // matches every row. This is the test that fails if the guard goes.
      const { strapi, calls, counts } = fakeStrapi({
        types: [PRODUCT],
        attributesByType: { [PRODUCT]: { name: { type: 'string' }, summary: { type: 'text' } } },
        hiddenFields: ['name', 'summary'],
        docsByType: { [PRODUCT]: [{ documentId: 'p1', name: 'Secret' }] },
      });
      const payload = structured(await run(strapi, { query: 'secret' }));

      expect(calls).toHaveLength(0);
      expect(counts).toHaveLength(0);
      expect(payload?.results).toEqual([]);
      expect(payload?.totals).toEqual([{ contentType: PRODUCT, total: 0 }]);
    });

    it('keeps the caller filters alongside the search', async () => {
      const { strapi, calls } = fakeStrapi({
        types: [PRODUCT],
        attributesByType: { [PRODUCT]: productAttributes },
      });
      await run(strapi, { contentType: PRODUCT, query: 'pro', filters: { inStock: { $eq: true } } });

      const parts = (calls[0].params.filters as any).$and;
      expect(parts).toContainEqual({ $and: [{ inStock: { $eq: true } }, expect.objectContaining({ $or: expect.any(Array) })] });
    });
  });
});
