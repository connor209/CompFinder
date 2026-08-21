/**
 * Portfolio snapshotting — captures the current state of a user's inventory
 * (total ask value, recorded cost basis, counts) into portfolio_snapshots,
 * one row per user per day. Shared by the daily cron and the on-demand
 * dashboard route. The passed `db` must be able to write portfolio_snapshots
 * (service-role admin client) and read the user's listings + costs; every read
 * is filtered by user_id explicitly so it's correct even with RLS bypassed.
 */

async function pageAll(makeQuery, pageSize = 1000) {
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

/**
 * Compute today's portfolio totals for a user and upsert a snapshot for the
 * given date (defaults to caller-provided `dateStr`, YYYY-MM-DD). Returns the
 * computed totals. Idempotent per day — re-running overwrites the same row.
 */
export async function snapshotUserPortfolio(db, userId, dateStr) {
  const listings = await pageAll(() =>
    db.from("ebay_listings").select("ebay_item_id,price_value,quantity").eq("user_id", userId)
  );
  const costRows = await pageAll(() =>
    db.from("listing_costs").select("ebay_item_id,cost_pence").eq("user_id", userId)
  );
  const costMap = new Map((costRows || []).map((r) => [r.ebay_item_id, r.cost_pence]));

  let value = 0;
  let costBasis = 0;
  let itemCount = 0;
  for (const l of listings) {
    const qty = l.quantity || 1;
    const askP = l.price_value != null ? Math.round(l.price_value * 100) : 0;
    value += askP * qty;
    itemCount += qty;
    const c = costMap.get(l.ebay_item_id);
    if (c != null) costBasis += c * qty;
  }

  const row = {
    user_id: userId,
    snapshot_date: dateStr,
    inventory_value_pence: value,
    cost_basis_pence: costBasis,
    item_count: itemCount,
    listing_count: listings.length
  };
  await db.from("portfolio_snapshots").upsert(row, { onConflict: "user_id,snapshot_date" });
  return row;
}
