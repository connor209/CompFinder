/**
 * Comp Finder — a CardUploader export, kept.
 *
 * The Batch screen has read these files since the beginning and kept four
 * fields out of them. Everything else — the photographs of the copy in your
 * hand, the set, the rarity, the year, the illustrator, the type — was parsed
 * and dropped, which is why a row on that screen could only ever say its
 * title. An import is that file, brought in whole and kept, so a card can be
 * looked at before it is priced and a title can be corrected before it is
 * searched on.
 *
 * `card_imports` and `card_import_items` (migration 028) are named in THIS
 * FILE ONLY — the rule batch-store.js and wants-store.js already follow, for
 * the reason Postgres makes plain: it rejects a whole statement that names a
 * missing column, so a second place naming a table is a second way for a
 * pending migration to take out a screen.
 *
 * **Every call degrades rather than throws.** Migrations here are applied by
 * hand and the code always ships first, so until 028 is run every function
 * answers `{ ok: false, missing: true }` and the screen says what is pending
 * instead of showing a stack trace.
 *
 * It takes a Supabase client as an argument rather than importing one, which
 * keeps the file free of app imports so `scripts/check-cardimport.mjs` can
 * load it under bare node and assert the round trip.
 */
import { storableText } from "./batch-store.js";

/** How many imports the list reads back. */
export const IMPORT_LIMIT = 100;

/** How many item rows go to Postgres at once. Smaller than a batch run's
 *  chunk because there is no reason to push a big one: an import row is a few
 *  hundred bytes of text and URLs, not a megabyte of comps. */
const CHUNK_SIZE = 100;

/**
 * Does this error mean "migration 028 hasn't been run"?
 *
 * Postgres says `relation "public.card_imports" does not exist`; PostgREST
 * says its schema cache doesn't know it. Either way it is a pending migration,
 * not a bug worth a stack trace on a screen.
 */
export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /card_import|does not exist|schema cache/i.test(msg);
}

/** "50 cards from stock-sept.csv" — what the imports list shows. A file name
 *  alone stops meaning anything the moment there are three of them. */
export function labelFor({ fileName = "", count = 0 } = {}) {
  const cards = `${count} card${count === 1 ? "" : "s"}`;
  return fileName ? `${cards} from ${fileName}` : cards;
}

/** "2.49" -> 249. The CSV writes pounds as text; everything in this app is
 *  pence. A row without one keeps null rather than becoming a free card. */
export function priceToPence(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function toInt(value) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * One serialiser, both directions.
 *
 * The same rule batch-store.js keeps: two of these would eventually disagree
 * about what an import contains, and the disagreement is the invisible kind —
 * an import that re-opens with its titles but not its scans still looks fine
 * until you go looking for a picture.
 */
export function importRows(items, { userId, importId }) {
  return (items || []).map((item, position) => ({
    import_id: importId,
    user_id: userId,
    position,
    title: storableText(item.title) || "",
    // What the FILE said, always. Never the edited one, or an import stops
    // being able to tell you what changed.
    title_original: storableText(item.titleOriginal ?? item.title) || "",
    edited_at: item.editedAt || null,
    sku: storableText(item.sku) || null,
    card_name: storableText(item.cardName) || null,
    card_number: storableText(item.cardNumber) || null,
    set_name: storableText(item.set) || null,
    rarity: storableText(item.rarity) || null,
    year: storableText(item.year) || null,
    illustrator: storableText(item.illustrator) || null,
    card_type: storableText(item.cardType) || null,
    stage: storableText(item.stage) || null,
    language: storableText(item.language) || null,
    game: storableText(item.game) || null,
    condition: storableText(item.condition) || null,
    condition_label: storableText(item.conditionLabel) || null,
    graded: !!item.graded,
    quantity: toInt(item.quantity),
    start_price_pence: priceToPence(item.startPrice),
    images: (item.images || []).map((u) => storableText(u)).filter(Boolean)
  }));
}

/** The same shape back, ready for the screen and for a batch run. */
export function restoreItems(rows) {
  return (rows || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => ({
      id: r.id,
      position: r.position ?? 0,
      title: r.title || "",
      titleOriginal: r.title_original || r.title || "",
      editedAt: r.edited_at || null,
      sku: r.sku || "",
      cardName: r.card_name || "",
      cardNumber: r.card_number || "",
      set: r.set_name || "",
      rarity: r.rarity || "",
      year: r.year || "",
      illustrator: r.illustrator || "",
      cardType: r.card_type || "",
      stage: r.stage || "",
      language: r.language || "",
      game: r.game || "",
      condition: r.condition || "",
      conditionLabel: r.condition_label || "",
      graded: !!r.graded,
      quantity: r.quantity ?? null,
      startPrice: r.start_price_pence != null ? (r.start_price_pence / 100).toFixed(2) : "",
      images: Array.isArray(r.images) ? r.images : []
    }));
}

/**
 * Has this row been changed since it came out of the file?
 *
 * One definition, because three screens ask it and a row that is marked edited
 * in one place and not another is worse than not marking it at all.
 */
export function isEdited(item) {
  return !!item && String(item.title || "") !== String(item.titleOriginal ?? item.title ?? "");
}

/** The rows a batch run prices, from an import. The EDITED title, because
 *  that is the whole point of being able to edit it: the search follows what
 *  you corrected. `csvItem` rides along so the run keeps the current-price
 *  column, the set-anchored query and the eBay re-export it always had. */
export function batchItemsFrom(items) {
  return (items || []).map((item) => ({
    sku: item.sku || "",
    title: item.title || "",
    source: "import",
    csvItem: { ...item, title: item.title }
  }));
}

export async function saveImport(supabase, userId, { fileName = "", items = [], csvText = null } = {}) {
  try {
    const { data: parent, error } = await supabase
      .from("card_imports")
      .insert({
        user_id: userId,
        label: labelFor({ fileName, count: items.length }),
        file_name: fileName || null,
        item_count: items.length,
        csv_text: storableText(csvText)
      })
      .select("id,label,created_at")
      .single();
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }

    const rows = importRows(items, { userId, importId: parent.id });
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const { error: chunkError } = await supabase
        .from("card_import_items")
        .insert(rows.slice(i, i + CHUNK_SIZE));
      if (chunkError) {
        // A half-written import is worse than none: it would list 50 cards and
        // open 30. The parent goes with it, and the screen keeps the browser's
        // copy either way.
        await supabase.from("card_imports").delete().eq("id", parent.id);
        if (isMissingTable(chunkError)) return { ok: false, missing: true };
        return { ok: false, error: chunkError.message };
      }
    }
    return { ok: true, id: parent.id, label: parent.label, created_at: parent.created_at };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}

export async function listImports(supabase, userId, limit = IMPORT_LIMIT) {
  try {
    const { data, error } = await supabase
      .from("card_imports")
      .select("id,label,file_name,item_count,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true, rows: [] };
      return { ok: false, error: error.message, rows: [] };
    }
    return { ok: true, rows: data || [] };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true, rows: [] };
    return { ok: false, error: err.message, rows: [] };
  }
}

export async function loadImport(supabase, id) {
  try {
    const { data: parent, error } = await supabase
      .from("card_imports")
      .select("id,label,file_name,item_count,csv_text,created_at")
      .eq("id", id)
      .single();
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    const { data: rows, error: itemsError } = await supabase
      .from("card_import_items")
      .select("*")
      .eq("import_id", id)
      .order("position", { ascending: true });
    if (itemsError) {
      if (isMissingTable(itemsError)) return { ok: false, missing: true };
      return { ok: false, error: itemsError.message };
    }
    return { ok: true, imported: parent, items: restoreItems(rows) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}

/**
 * One row, changed by hand.
 *
 * Only the fields a person can actually type are writable, built key by key —
 * the allow-list discipline counterRow() and dealLine() keep, for the smaller
 * but real reason that a patch built by spreading the row would write back
 * `title_original` and quietly erase the only record of what the file said.
 */
/**
 * The specifics a person may correct, and the column each lives in.
 *
 * An allow-list rather than a loop over the patch, for the reason the whole
 * file is built this way: `title_original` is one careless spread away from
 * being overwritten, and it is the only record of what the file said.
 */
export const SPECIFIC_COLUMNS = {
  cardName: "card_name",
  cardNumber: "card_number",
  set: "set_name",
  rarity: "rarity",
  year: "year",
  illustrator: "illustrator",
  cardType: "card_type",
  stage: "stage",
  language: "language"
};

export async function updateItem(supabase, itemId, patch = {}) {
  const writable = {};
  if (patch.title !== undefined) {
    writable.title = storableText(patch.title) || "";
    writable.edited_at = new Date().toISOString();
  }
  if (patch.sku !== undefined) writable.sku = storableText(patch.sku) || null;
  if (patch.condition !== undefined) writable.condition = storableText(patch.condition) || null;
  if (patch.quantity !== undefined) writable.quantity = toInt(patch.quantity);
  // The card specifics. Three of these are not decoration: cardName,
  // cardNumber and set are what buildQueryFromItem searches on, so correcting
  // a set CardUploader got wrong changes which comps come back. The rest are
  // what the row shows you while you decide.
  for (const [key, column] of Object.entries(SPECIFIC_COLUMNS)) {
    if (patch[key] !== undefined) writable[column] = storableText(patch[key]) || null;
  }
  if (Object.keys(writable).length === 0) return { ok: true, unchanged: true };
  try {
    const { error } = await supabase.from("card_import_items").update(writable).eq("id", itemId);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}

/** Put a title back to what the file said. */
export async function revertTitle(supabase, itemId, titleOriginal) {
  try {
    const { error } = await supabase
      .from("card_import_items")
      .update({ title: storableText(titleOriginal) || "", edited_at: null })
      .eq("id", itemId);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}

export async function deleteImport(supabase, id) {
  try {
    // Items go with the parent by ON DELETE CASCADE.
    const { error } = await supabase.from("card_imports").delete().eq("id", id);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}
