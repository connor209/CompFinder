/**
 * Page through a Supabase select past the 1000-row PostgREST cap.
 * `makeQuery` must return a FRESH query builder each call (so .range can be
 * applied per page). Returns all rows concatenated.
 */
export async function pagedSelect(makeQuery, pageSize = 1000) {
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
