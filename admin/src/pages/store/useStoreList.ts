import { useMemo, useRef, useState } from 'react';
import { paginate } from './paginate';

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

  const result = useMemo(
    () => paginate(items, (item, query) => matchRef.current(item, query), search, page),
    [items, search, page],
  );

  return {
    search,
    setSearch: (value: string) => {
      setSearch(value);
      // Back to the first page: page 4 of a search that now has one page would
      // show nothing, and the reader would conclude the search found nothing.
      setPage(1);
    },
    setPage,
    ...result,
  };
}
