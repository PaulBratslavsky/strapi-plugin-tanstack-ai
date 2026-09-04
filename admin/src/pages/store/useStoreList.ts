import { useMemo, useRef, useState } from 'react';

/**
 * Search and pagination for a store page.
 *
 * The three stores hold different things — memories, notes, conversations —
 * but page them identically, so only the columns differ. Keeping this apart
 * from the tables means "search resets to page one" is written once rather
 * than three times, which is exactly the kind of detail that gets fixed in one
 * copy and forgotten in the others.
 *
 * Filtering is CLIENT-SIDE, deliberately. These lists are one admin's own
 * rows — tens, not thousands — and they are already fetched in full for the
 * chat panel's sidebars. A server round trip per keystroke would be slower and
 * would need an endpoint that does not exist.
 */

const PAGE_SIZE = 10;

export function useStoreList<T>(items: T[], matches: (item: T, query: string) => boolean) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  /*
   * `matches` is held in a ref rather than listed as a dependency.
   *
   * Callers define it inline, so it is a new function every render; as a
   * dependency it would rebuild the filtered list on every render, and
   * omitting it would need a suppression comment for a rule this repo does not
   * even have installed. The ref says the same thing in code: the filter
   * depends on the data and the query, and reads whatever predicate is current.
   */
  const matchRef = useRef(matches);
  matchRef.current = matches;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => matchRef.current(item, query));
  }, [items, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamped, because deleting the last row on the last page would otherwise
  // leave the view on a page that no longer exists, showing nothing.
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return {
    search,
    setSearch: (value: string) => {
      setSearch(value);
      setPage(1);
    },
    page: current,
    setPage,
    pageCount,
    visible,
    total: filtered.length,
  };
}
