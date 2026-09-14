import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';
import { aggregateContent, MAX_SCANNED } from './aggregate-content';

/**
 * `aggregate_content` against a mocked Strapi.
 *
 * The fake Content Manager enforces the same things the real one does at the
 * level these tests need: which types are readable, which fields survive
 * sanitising, and a permission condition added to every permitted query. The
 * real sanitiser is exercised by the live check; what is pinned here is that
 * the tool asks it, and refuses rather than guessing when the answer is no.
 */

type Attributes = Record<string, Record<string, unknown>>;

interface FakeOptions {
  schemas: Record<string, Attributes>;
  docs?: Record<string, Array<Record<string, unknown>>>;
  /** Types with Read. Defaults to every type in `schemas`. */
  readable?: string[];
  /** `uid.field` pairs the caller may not read. */
  hidden?: string[];
}

const ARTICLE = 'api::article.article';
const PRODUCT = 'api::product.product';
const AUTHOR = 'api::author.author';

const ARTICLE_SCHEMA: Attributes = {
  title: { type: 'string' },
  category: { type: 'enumeration' },
  body: { type: 'text' },
  publishedDate: { type: 'date' },
  createdAt: { type: 'datetime' },
  author: { type: 'relation', relation: 'manyToOne', target: AUTHOR },
  tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag.tag' },
};

function fakeStrapi({ schemas, docs = {}, readable, hidden = [] }: FakeOptions) {
  const readableSet = new Set(readable ?? Object.keys(schemas));
  const hiddenSet = new Set(hidden);
  const displayed = Object.keys(schemas).map((uid) => ({ uid }));
  const findMany: Array<{ uid: string; params: Record<string, any> }> = [];
  const counts: Array<{ uid: string; params: Record<string, any> }> = [];

  const checkerFor = (model: string) => {
    const visible = (field: string) => !hiddenSet.has(`${model}.${field}`);
    return {
      cannot: { read: () => !readableSet.has(model) },
      sanitizeQuery: async (query: Record<string, any>) => ({
        ...query,
        ...(query.fields ? { fields: query.fields.filter((field: string) => visible(field)) } : {}),
        ...(query.populate
          ? {
              populate: Object.fromEntries(
                Object.entries(query.populate).filter(([field]) => visible(field)),
              ),
            }
          : {}),
      }),
      sanitizedQuery: {
        read: async (query: Record<string, any>) => ({
          ...query,
          filters: { $and: [...(query.filters ? [query.filters] : []), { permissionCondition: true }] },
        }),
      },
      sanitizeOutput: async (doc: Record<string, unknown>) => doc,
    };
  };

  const strapi = {
    contentTypes: Object.fromEntries(
      Object.entries(schemas).map(([uid, attributes]) => [uid, { uid, attributes }]),
    ),
    documents: (uid: string) => ({
      count: async (params: Record<string, any>) => {
        counts.push({ uid, params });
        return (docs[uid] ?? []).length;
      },
      findMany: async (params: Record<string, any>) => {
        findMany.push({ uid, params });
        const start = (params.page - 1) * params.pageSize;
        return (docs[uid] ?? []).slice(start, start + params.pageSize);
      },
    }),
    plugin: () => ({
      service: (name: string) =>
        name === 'content-types'
          ? { findDisplayedContentTypes: () => displayed }
          : { create: ({ model }: { model: string }) => checkerFor(model) },
    }),
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;

  return { strapi, findMany, counts };
}

const CALLER = { userAbility: {}, user: { id: 1 } };

const run = (strapi: Core.Strapi, args: Record<string, unknown>, context: unknown = CALLER) =>
  aggregateContent.createHandler(strapi, context as never)({ args, extra: {} } as never);

const structured = (result: unknown) => (result as { structuredContent?: any }).structuredContent;
const errorText = (result: unknown) => {
  expect(result).toMatchObject({ isError: true });
  return (result as any).content[0].text as string;
};

describe('aggregate_content', () => {
  describe('count', () => {
    it('counts one type with the permitted filters, including the permission condition', async () => {
      const { strapi, counts } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA },
        docs: { [ARTICLE]: [{}, {}, {}] },
      });
      const result = structured(
        await run(strapi, { operation: 'count', contentType: ARTICLE, filters: { category: { $eq: 'guide' } } }),
      );

      expect(result).toEqual({ operation: 'count', contentType: ARTICLE, total: 3 });
      expect(counts[0].params.filters).toEqual({
        $and: [{ category: { $eq: 'guide' } }, { permissionCondition: true }],
      });
    });

    it('totals every readable type when contentType is omitted, and never counts the rest', async () => {
      // A count is data: "product: 3" is a leak even with no rows attached.
      const { strapi, counts } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA, [PRODUCT]: { name: { type: 'string' } } },
        docs: { [ARTICLE]: [{}, {}], [PRODUCT]: [{}, {}, {}] },
        readable: [ARTICLE],
      });
      const result = structured(await run(strapi, { operation: 'count' }));

      expect(result).toEqual({ operation: 'count', total: 2, totals: [{ contentType: ARTICLE, total: 2 }] });
      expect(counts.map((call) => call.uid)).toEqual([ARTICLE]);
    });

    it('refuses filters when counting across types', async () => {
      const { strapi } = fakeStrapi({ schemas: { [ARTICLE]: ARTICLE_SCHEMA } });
      expect(errorText(await run(strapi, { operation: 'count', filters: { title: { $eq: 'x' } } }))).toContain(
        'contentType',
      );
    });

    it('needs a contentType for anything but count', async () => {
      const { strapi } = fakeStrapi({ schemas: { [ARTICLE]: ARTICLE_SCHEMA } });
      expect(errorText(await run(strapi, { operation: 'countByField', groupByField: 'category' }))).toContain(
        'needs a contentType',
      );
    });
  });

  describe('types', () => {
    it('refuses a type the caller cannot read, before counting anything', async () => {
      const { strapi, counts } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA, [PRODUCT]: {} },
        readable: [ARTICLE],
      });
      const unreadable = errorText(await run(strapi, { operation: 'count', contentType: PRODUCT }));
      const unknown = errorText(await run(strapi, { operation: 'count', contentType: 'api::nope.nope' }));
      // Same answer either way, so guessed uids cannot be probed.
      expect(unreadable.replace(PRODUCT, '<uid>')).toBe(unknown.replace('api::nope.nope', '<uid>'));
      expect(counts).toHaveLength(0);
    });

    it('lists only readable types when the type does not exist', async () => {
      const { strapi } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA, [PRODUCT]: {} },
        readable: [ARTICLE],
      });
      const text = errorText(await run(strapi, { operation: 'count', contentType: 'api::nope.nope' }));
      expect(text).toContain(ARTICLE);
      expect(text).not.toContain(PRODUCT);
    });

    it('fails closed without the caller permissions', async () => {
      const { strapi, counts } = fakeStrapi({ schemas: { [ARTICLE]: ARTICLE_SCHEMA } });
      errorText(await run(strapi, { operation: 'count' }, {}));
      expect(counts).toHaveLength(0);
    });
  });

  describe('countByField', () => {
    const articles = [{ category: 'guide' }, { category: 'guide' }, { category: 'tutorial' }];

    it('groups a scalar field, selecting only that field', async () => {
      const { strapi, findMany } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA },
        docs: { [ARTICLE]: articles },
      });
      const result = structured(
        await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'category' }),
      );

      expect(result).toMatchObject({
        total: 3,
        resolvedField: 'category',
        groups: [
          { value: 'guide', count: 2 },
          { value: 'tutorial', count: 1 },
        ],
        scanned: 3,
        partial: false,
      });
      expect(findMany[0].params.fields).toEqual(['category']);
      expect(findMany[0].params.filters).toEqual({ $and: [{ permissionCondition: true }] });
    });

    it('refuses a field the caller cannot read, rather than answering "(empty): N"', async () => {
      // Sanitising would drop the field from the select, every row would come
      // back without it, and the answer would be one confident, false group.
      const { strapi, findMany, counts } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA },
        docs: { [ARTICLE]: articles },
        hidden: [`${ARTICLE}.category`],
      });
      const text = errorText(
        await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'category' }),
      );

      expect(text).toContain('"category"');
      expect(findMany).toHaveLength(0);
      expect(counts).toHaveLength(0);
    });

    it('refuses fields that do not exist, or cannot make a label', async () => {
      const { strapi } = fakeStrapi({ schemas: { [ARTICLE]: { ...ARTICLE_SCHEMA, blocks: { type: 'dynamiczone' } } } });
      expect(
        errorText(await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'nope' })),
      ).toContain('list_content_types');
      expect(
        errorText(await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'blocks' })),
      ).toContain('cannot be grouped');
    });

    it('refuses grouping by a relation whose type the caller cannot read', async () => {
      // A group label is a value FROM the related type.
      const { strapi, findMany } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA, [AUTHOR]: { name: { type: 'string' } } },
        readable: [ARTICLE],
      });
      const text = errorText(
        await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'author' }),
      );

      expect(text).toContain(AUTHOR);
      expect(findMany).toHaveLength(0);
    });

    it('labels a relation by the first label field the caller may read', async () => {
      const { strapi, findMany } = fakeStrapi({
        schemas: {
          [ARTICLE]: ARTICLE_SCHEMA,
          [AUTHOR]: { name: { type: 'string' }, title: { type: 'string' } },
        },
        docs: { [ARTICLE]: [{ author: { title: 'Dr' } }, { author: null }] },
        hidden: [`${AUTHOR}.name`],
      });
      const result = structured(
        await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'author' }),
      );

      expect(result.resolvedField).toBe('author.title');
      expect(findMany[0].params.populate).toEqual({ author: { fields: ['title'] } });
      expect(result.groups).toEqual([
        { value: '(empty)', count: 1 },
        { value: 'Dr', count: 1 },
      ]);
    });

    it('refuses an explicit relation field the caller cannot read', async () => {
      const { strapi } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA, [AUTHOR]: { name: { type: 'string' }, email: { type: 'email' } } },
        hidden: [`${AUTHOR}.email`],
      });
      expect(
        errorText(await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'author.email' })),
      ).toContain('"email"');
    });

    it('reports a partial result instead of passing a sample off as the whole', async () => {
      // The reference stopped at 1,000 rows and presented the groups as complete.
      const many = Array.from({ length: MAX_SCANNED + 1200 }, (_, i) => ({ category: i % 2 ? 'a' : 'b' }));
      const { strapi } = fakeStrapi({ schemas: { [ARTICLE]: ARTICLE_SCHEMA }, docs: { [ARTICLE]: many } });
      const result = structured(
        await run(strapi, { operation: 'countByField', contentType: ARTICLE, groupByField: 'category' }),
      );

      expect(result).toMatchObject({ total: MAX_SCANNED + 1200, scanned: MAX_SCANNED, partial: true });
      const grouped = result.groups.reduce((sum: number, group: { count: number }) => sum + group.count, 0);
      expect(grouped).toBe(MAX_SCANNED);
    });
  });

  describe('countByDateRange', () => {
    it('buckets by the date field and merges the range into the filters', async () => {
      const { strapi, findMany, counts } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA },
        docs: { [ARTICLE]: [{ publishedDate: '2026-08-02' }, { publishedDate: '2026-09-01' }, { publishedDate: null }] },
      });
      const result = structured(
        await run(strapi, {
          operation: 'countByDateRange',
          contentType: ARTICLE,
          dateField: 'publishedDate',
          dateFrom: '2026-01-01',
        }),
      );

      expect(result).toMatchObject({
        buckets: [
          { period: '2026-08', count: 1 },
          { period: '2026-09', count: 1 },
        ],
        undated: 1,
      });
      const expected = { $and: [{ publishedDate: { $gte: '2026-01-01' } }, { permissionCondition: true }] };
      expect(counts[0].params.filters).toEqual(expected);
      expect(findMany[0].params.filters).toEqual(expected);
      expect(findMany[0].params.fields).toEqual(['publishedDate']);
    });

    it('refuses a date field the caller cannot read', async () => {
      const { strapi, findMany } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA },
        hidden: [`${ARTICLE}.publishedDate`],
      });
      errorText(
        await run(strapi, { operation: 'countByDateRange', contentType: ARTICLE, dateField: 'publishedDate' }),
      );
      expect(findMany).toHaveLength(0);
    });

    it('refuses a date range on an unreadable field even for a plain count', async () => {
      // Otherwise the sanitiser drops the range and the count silently widens.
      const { strapi, counts } = fakeStrapi({
        schemas: { [ARTICLE]: ARTICLE_SCHEMA },
        hidden: [`${ARTICLE}.publishedDate`],
      });
      errorText(
        await run(strapi, { operation: 'count', contentType: ARTICLE, dateField: 'publishedDate', dateTo: '2026-01-01' }),
      );
      expect(counts).toHaveLength(0);
    });

    it('refuses a field that is not a date, and a bound that is not a date', async () => {
      const { strapi } = fakeStrapi({ schemas: { [ARTICLE]: ARTICLE_SCHEMA } });
      expect(
        errorText(await run(strapi, { operation: 'countByDateRange', contentType: ARTICLE, dateField: 'title' })),
      ).toContain('not a date field');
      expect(
        errorText(await run(strapi, { operation: 'countByDateRange', contentType: ARTICLE, dateFrom: 'last week' })),
      ).toContain('not a date');
    });
  });
});
