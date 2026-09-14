/**
 * The arithmetic behind `aggregate_content`, with no Strapi in it.
 *
 * Kept apart from the tool so each rule can be tested on plain rows: how a
 * value becomes a group label, how a many-relation is counted, and which bucket
 * a timestamp falls in. The permission-sensitive decisions — which fields may
 * be grouped on at all — live in the tool, not here.
 *
 * Ported from the reference plugin's `tool-logic/aggregate-content.ts`, with
 * one correction: its week buckets used `getDay()` and `setDate()`, which are
 * LOCAL-time, and then formatted the result as UTC with `toISOString()`. On a
 * server west of UTC a Monday-morning timestamp lands in the previous week's
 * bucket. Every calculation here is UTC.
 */

export type Granularity = 'day' | 'week' | 'month';

/** The label for a missing value, so "no category" is a group, not a gap. */
export const EMPTY_LABEL = '(empty)';

export interface Group {
  value: string;
  count: number;
}

export interface Bucket {
  period: string;
  count: number;
}

/** How to read one row's group value, already checked against permissions. */
export type GroupSpec =
  | { kind: 'scalar'; field: string }
  | { kind: 'relation'; field: string; subField: string; many: boolean };

const BLANK = new Set<unknown>([null, undefined, '']);

function label(raw: unknown): string {
  if (BLANK.has(raw)) return EMPTY_LABEL;
  if (typeof raw === 'object') return EMPTY_LABEL;
  return String(raw);
}

/**
 * The labels one row contributes.
 *
 * A to-many relation contributes ONE LABEL PER RELATED ITEM: an article tagged
 * "tutorial" and "strapi" counts once under each. So the group counts of a
 * many-relation can sum to more than the number of rows, and that is correct —
 * the question is "how many articles carry this tag", not a partition.
 */
export function labelsFor(row: Record<string, unknown>, spec: GroupSpec): string[] {
  if (spec.kind === 'scalar') return [label(row[spec.field])];

  const related = row[spec.field];
  if (spec.many) {
    if (!Array.isArray(related) || related.length === 0) return [EMPTY_LABEL];
    return related.map((item) => label((item as Record<string, unknown> | null)?.[spec.subField]));
  }
  if (related === null || typeof related !== 'object') return [EMPTY_LABEL];
  return [label((related as Record<string, unknown>)[spec.subField])];
}

/** Count rows per label, largest group first, ties alphabetical for stability. */
export function countGroups(rows: Array<Record<string, unknown>>, spec: GroupSpec): Group[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of labelsFor(row, spec)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const groups = Array.from(counts, ([value, count]) => ({ value, count }));
  // In-place on an array built one line up, which nothing else holds. `toSorted`
  // is what the rule wants, but it needs lib es2023 and the server targets es2022.
  // eslint-disable-next-line unicorn/no-array-sort
  return groups.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * The bucket a timestamp belongs to, in UTC, or null when it is not a date.
 *
 *   day   → 2026-09-14
 *   week  → the Monday that starts the week, 2026-09-14
 *   month → 2026-09
 */
export function bucketKey(raw: unknown, granularity: Granularity): string | null {
  if (BLANK.has(raw)) return null;
  const date = new Date(raw as string);
  if (Number.isNaN(date.getTime())) return null;

  if (granularity === 'month') return date.toISOString().slice(0, 7);
  if (granularity === 'day') return date.toISOString().slice(0, 10);

  // getUTCDay: Sunday is 0. Days since Monday: Mon→0 … Sun→6.
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday));
  return monday.toISOString().slice(0, 10);
}

/**
 * Count rows per period, in time order.
 *
 * Rows with no usable date are counted separately rather than dropped: a trend
 * built from 40 of 50 rows should say so.
 */
export function countBuckets(
  rows: Array<Record<string, unknown>>,
  dateField: string,
  granularity: Granularity,
): { buckets: Bucket[]; undated: number } {
  const counts = new Map<string, number>();
  let undated = 0;
  for (const row of rows) {
    const key = bucketKey(row[dateField], granularity);
    if (key === null) undated++;
    else counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = Array.from(counts, ([period, count]) => ({ period, count }));
  buckets.sort((a, b) => a.period.localeCompare(b.period));
  return { buckets, undated };
}
