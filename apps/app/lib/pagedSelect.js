/**
 * Page through a Supabase select past the 1000-row PostgREST cap.
 * `makeQuery` must return a FRESH query builder each call (so .range can be
 * applied per page). Returns all rows concatenated.
 *
 * **Every page read is put in a TOTAL order here, never left to the caller.**
 * `.range()` without an ORDER BY lets Postgres return each page in whatever
 * order its plan likes, so page two need not start where page one ended: some
 * rows come back twice and others never at all. Nothing errors and the count
 * looks about right. On the pull sheet that was an order whose stack card was
 * never read, filed under the variation picks with its stack SKU on it. The
 * key is appended AFTER any order the caller set, so it only breaks ties there.
 *
 * `orderBy` is the table's primary key — "id" for most tables here; a table
 * keyed otherwise (ebay_sales, listing_costs, card_catalog) must name its own,
 * or the query errors and reads nothing.
 */
export async function pagedSelect(makeQuery, { pageSize = 1000, orderBy = "id" } = {}) {
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  let from = 0;
  let all = [];
  for (;;) {
    let q = makeQuery();
    for (const k of keys) q = q.order(k, { ascending: true });
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
