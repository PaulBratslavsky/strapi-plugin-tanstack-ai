/**
 * Search and paginate a store list.
 *
 * Pure, and separate from the hook that calls it, so the rules can be tested
 * without a DOM: the clamp below is the kind of thing that is only ever
 * exercised by a specific sequence of user actions, and reproducing that
 * sequence through a rendered component is far more machinery than the rule
 * deserves.
 */

export const PAGE_SIZE = 10;

export interface Paginated<T> {
  visible: T[];
  /** Clamped to the number of pages that exist. */
  page: number;
  pageCount: number;
  total: number;
}

export function paginate<T>(
  items: T[],
  matches: (item: T, query: string) => boolean,
  search: string,
  page: number,
): Paginated<T> {
  const query = search.trim().toLowerCase();
  const filtered = query ? items.filter((item) => matches(item, query)) : items;

  // At least one page, so an empty list still renders "Page 1 of 1" rather
  // than "Page 1 of 0".
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  /*
   * CLAMPED, and this is the case worth having a test for. Delete the last row
   * on the last page and `pageCount` drops while `page` does not, leaving the
   * view on a page that no longer exists — an empty table with rows sitting
   * one page back. The same happens when a search narrows the list while the
   * reader is deep in it.
   */
  const current = Math.min(Math.max(1, page), pageCount);

  return {
    visible: filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pageCount,
    total: filtered.length,
  };
}
