import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, paginate } from './paginate';

/**
 * The store pages' search and paging rules.
 *
 * Every case here is one a reader can reach by clicking, and several are ones
 * that would silently show an empty table rather than error.
 */

interface Row {
  id: number;
  text: string;
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: index, text: `row ${index}` }));

const matches = (row: Row, query: string) => row.text.includes(query);
const caseInsensitive = (row: { text: string }, query: string) =>
  row.text.toLowerCase().includes(query);

describe('paginate', () => {
  it('returns a full page and reports how many there are', () => {
    const result = paginate(rows(25), matches, '', 1);
    expect(result.visible).toHaveLength(PAGE_SIZE);
    expect(result.pageCount).toBe(3);
    expect(result.total).toBe(25);
  });

  it('gives the last page whatever is left over', () => {
    expect(paginate(rows(25), matches, '', 3).visible).toHaveLength(5);
  });

  it('reports one page for an empty list, not zero', () => {
    // "Page 1 of 0" is a bug someone has to read twice; the pager renders from
    // this number.
    const result = paginate([], matches, '', 1);
    expect(result.pageCount).toBe(1);
    expect(result.visible).toEqual([]);
  });

  it('clamps to the last page when the list shrinks beneath the reader', () => {
    // Deleting the last row of the last page. Without the clamp the view stays
    // on page 3 while only two pages exist, showing an empty table with the
    // rows sitting one page back.
    const result = paginate(rows(21), matches, '', 3);
    expect(result.pageCount).toBe(3);

    const afterDelete = paginate(rows(20), matches, '', 3);
    expect(afterDelete.pageCount).toBe(2);
    expect(afterDelete.page).toBe(2);
    expect(afterDelete.visible).toHaveLength(10);
  });

  it('clamps a page below one', () => {
    expect(paginate(rows(5), matches, '', 0).page).toBe(1);
  });

  it('filters by the query before paging, not after', () => {
    // Paging first and filtering the page would show three results on page one
    // and claim there are no more, which is the difference between a search
    // and a search of whatever happened to be visible.
    const items = [...rows(20), { id: 99, text: 'needle' }];
    const result = paginate(items, matches, 'needle', 1);
    expect(result.total).toBe(1);
    expect(result.visible).toEqual([{ id: 99, text: 'needle' }]);
  });

  it('ignores surrounding whitespace and case in the query', () => {
    const items = [{ id: 1, text: 'Widget' }];
    expect(paginate(items, caseInsensitive, '  WIDGET  ', 1).total).toBe(1);
  });

  it('treats a blank query as no filter rather than as matching nothing', () => {
    expect(paginate(rows(3), matches, '   ', 1).total).toBe(3);
  });

  it('does not call the predicate at all when there is no query', () => {
    // The predicates are defined inline by each page and some read several
    // fields; running them over the whole list on every render for nothing is
    // work that buys nothing.
    let calls = 0;
    paginate(rows(50), (row, query) => {
      calls += 1;
      return matches(row, query);
    }, '', 1);
    expect(calls).toBe(0);
  });
});
