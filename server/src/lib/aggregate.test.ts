import { describe, expect, it } from 'vitest';
import { bucketKey, countBuckets, countGroups, EMPTY_LABEL, labelsFor } from './aggregate';

/**
 * The arithmetic of `aggregate_content` on plain rows.
 *
 * Wrong numbers here are worse than no numbers: a breakdown is taken as fact
 * and repeated. Each test pins a rule whose failure would still produce a
 * plausible-looking table.
 */

describe('labelsFor', () => {
  it('reads a scalar field, and names a missing value instead of dropping it', () => {
    // "No category" is an answer to "articles per category", not a gap.
    const spec = { kind: 'scalar', field: 'category' } as const;
    expect(labelsFor({ category: 'guide' }, spec)).toEqual(['guide']);
    expect(labelsFor({ category: null }, spec)).toEqual([EMPTY_LABEL]);
    expect(labelsFor({ category: '' }, spec)).toEqual([EMPTY_LABEL]);
    expect(labelsFor({}, spec)).toEqual([EMPTY_LABEL]);
  });

  it('keeps false and 0 as values, not as empty', () => {
    const spec = { kind: 'scalar', field: 'inStock' } as const;
    expect(labelsFor({ inStock: false }, spec)).toEqual(['false']);
    expect(labelsFor({ inStock: 0 }, spec)).toEqual(['0']);
  });

  it('gives a to-many relation one label per related item', () => {
    const spec = { kind: 'relation', field: 'tags', subField: 'title', many: true } as const;
    expect(labelsFor({ tags: [{ title: 'strapi' }, { title: 'tutorial' }] }, spec)).toEqual([
      'strapi',
      'tutorial',
    ]);
    expect(labelsFor({ tags: [] }, spec)).toEqual([EMPTY_LABEL]);
  });

  it('reads a to-one relation through its label field', () => {
    const spec = { kind: 'relation', field: 'author', subField: 'name', many: false } as const;
    expect(labelsFor({ author: { name: 'Ada' } }, spec)).toEqual(['Ada']);
    expect(labelsFor({ author: null }, spec)).toEqual([EMPTY_LABEL]);
  });
});

describe('countGroups', () => {
  it('orders by count, largest first, with ties alphabetical', () => {
    const rows = [{ c: 'b' }, { c: 'a' }, { c: 'z' }, { c: 'z' }];
    expect(countGroups(rows, { kind: 'scalar', field: 'c' })).toEqual([
      { value: 'z', count: 2 },
      { value: 'a', count: 1 },
      { value: 'b', count: 1 },
    ]);
  });

  it('lets many-relation groups sum past the row count, which is correct', () => {
    // Two articles, three tag assignments: "how many articles carry each tag".
    const rows = [{ tags: [{ t: 'x' }, { t: 'y' }] }, { tags: [{ t: 'x' }] }];
    const groups = countGroups(rows, { kind: 'relation', field: 'tags', subField: 't', many: true });
    expect(groups).toEqual([
      { value: 'x', count: 2 },
      { value: 'y', count: 1 },
    ]);
  });
});

describe('bucketKey', () => {
  it('starts weeks on Monday, in UTC', () => {
    // The reference computed the weekday in LOCAL time and printed UTC, so on
    // a server west of UTC these two landed a week apart from the right answer.
    expect(bucketKey('2026-09-14T00:30:00Z', 'week')).toBe('2026-09-14'); // Monday
    expect(bucketKey('2026-09-20T23:30:00Z', 'week')).toBe('2026-09-14'); // Sunday
    expect(bucketKey('2026-09-13T23:30:00Z', 'week')).toBe('2026-09-07'); // previous Sunday
  });

  it('keys days and months by their UTC calendar date', () => {
    expect(bucketKey('2026-09-30T23:59:59Z', 'day')).toBe('2026-09-30');
    expect(bucketKey('2026-09-30T23:59:59Z', 'month')).toBe('2026-09');
    expect(bucketKey('2026-09-01', 'month')).toBe('2026-09');
  });

  it('returns null for anything that is not a date', () => {
    expect(bucketKey(null, 'day')).toBeNull();
    expect(bucketKey('', 'day')).toBeNull();
    expect(bucketKey('not a date', 'day')).toBeNull();
  });
});

describe('countBuckets', () => {
  it('buckets in time order and counts undated rows rather than dropping them', () => {
    const rows = [
      { d: '2026-09-02T10:00:00Z' },
      { d: '2026-08-15T10:00:00Z' },
      { d: '2026-09-20T10:00:00Z' },
      { d: null },
    ];
    expect(countBuckets(rows, 'd', 'month')).toEqual({
      buckets: [
        { period: '2026-08', count: 1 },
        { period: '2026-09', count: 2 },
      ],
      undated: 1,
    });
  });
});
