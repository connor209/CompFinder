"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CardUploaderCsv from "@/lib/carduploader.js";
import {
  saveImport, listImports, loadImport, updateItem, revertTitle, deleteImport, isEdited
} from "@/lib/import-store.js";
import { SpecificsEditor, TitleEditor, StockFields } from "./CardFields";

/**
 * Imports — a CardUploader export, brought in whole.
 *
 * The Batch screen has read these files since the beginning and kept four
 * fields out of them, so a row could only ever say its title. The two
 * questions you actually ask holding a card — *is this the one I scanned* and
 * *is the title right* — were unanswerable in this app, and both answers were
 * already in the file: `PicURL` carries the photographs of that very copy, and
 * the set, rarity, year, illustrator, type and stage are each one column.
 *
 * **The scans are of THIS copy, which is why they beat catalogue art here.**
 * The same argument counter mode already settled: publisher artwork shows a
 * mint card to somebody holding a played one. A gap is honest; a perfect scan
 * of a different copy is not.
 *
 * **Editing the title is the point, not a convenience.** The title is what the
 * pricing engine searches on, and — since `*C:Finish` is blank on 49 of 50
 * reverse holos — it is also what decides which PRINTING is being priced. So a
 * correction here changes the price that comes back, which is why the original
 * is kept beside it and every edited row says so.
 */
export default function Imports({ onPrice }) {
  const [rows, setRows] = useState(null);       // the list of imports; null = loading
  const [open, setOpen] = useState(null);       // { imported, items }
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [missing, setMissing] = useState(false); // migration 028 not applied
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(null);   // { title, images, index }
  const [search, setSearch] = useState("");

  const say = (text, isError = false) => { setNotice(text); setNoticeIsError(isError); };

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const res = await listImports(supabase, user.id);
      if (res.missing) { setMissing(true); setRows([]); return; }
      setMissing(false);
      setRows(res.rows);
      if (!res.ok && res.error) say(`Could not list imports: ${res.error}`, true);
    } catch (err) {
      setRows([]);
      say(`Could not list imports: ${err.message}`, true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onCsvSelected = useCallback((e) => {
    const file = e.target.files[0];
    e.target.value = ""; // let the same file be re-picked after a failure
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result);
      let items;
      try {
        items = CardUploaderCsv.extractItems(text);
      } catch (err) {
        say(`Could not read that CSV: ${err.message}`, true);
        return;
      }
      if (items.length === 0) {
        say("No rows with a recognisable Card Name + Card Number — is that a CardUploader export?", true);
        return;
      }
      const withImages = items.filter((i) => i.images.length > 0).length;
      const repaired = items.filter((i) => i.cardNumberRepaired).length;

      // On screen FIRST, saved second. The parse already succeeded, and a
      // pending migration or a dropped connection is no reason to make you
      // look at nothing — it just means this import dies with the tab.
      setOpen({
        imported: { id: null, label: `${items.length} cards from ${file.name}`, file_name: file.name },
        items: items.map((item, position) => ({ ...item, id: null, position, titleOriginal: item.title }))
      });
      say(
        `Read ${items.length} card${items.length === 1 ? "" : "s"} from ${file.name} — ` +
          `${withImages} with scans.` +
          (repaired
            ? ` ⚠ ${repaired} card number${repaired === 1 ? "" : "s"} looked like Excel had turned them into dates and were repaired.`
            : "")
      );

      setBusy(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const res = await saveImport(supabase, user.id, { fileName: file.name, items, csvText: text });
        if (res.missing) {
          setMissing(true);
          say(
            `Read ${items.length} cards from ${file.name}, but they are only in this tab: ` +
              "migration 028 hasn't been applied in Supabase yet.",
            true
          );
          return;
        }
        if (!res.ok) { say(`Read the file, but could not save it: ${res.error}`, true); return; }
        const loaded = await loadImport(supabase, res.id);
        if (loaded.ok) setOpen({ imported: loaded.imported, items: loaded.items });
        await refresh();
      } catch (err) {
        say(`Read the file, but could not save it: ${err.message}`, true);
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => say(`Could not open ${file.name}.`, true);
    reader.readAsText(file);
  }, [refresh]);

  async function openImport(id) {
    setBusy(true);
    try {
      const res = await loadImport(createClient(), id);
      if (res.missing) { setMissing(true); return; }
      if (!res.ok) { say(`Could not open that import: ${res.error}`, true); return; }
      setOpen({ imported: res.imported, items: res.items });
      say("");
    } finally {
      setBusy(false);
    }
  }

  async function removeImport(row) {
    if (!confirm(`Delete "${row.label}"? The scans stay on CardUploader; this is our copy of the list.`)) return;
    const res = await deleteImport(createClient(), row.id);
    if (!res.ok) { say(`Could not delete that import: ${res.error || "unknown error"}`, true); return; }
    if (open?.imported?.id === row.id) setOpen(null);
    await refresh();
  }

  /** Patch one row on screen, then in Supabase. On screen first for the same
   *  reason the upload renders first: a saved row that hasn't come back yet is
   *  still the row you just typed. */
  const patchItem = useCallback(async (position, patch) => {
    let target = null;
    setOpen((cur) => {
      if (!cur) return cur;
      const items = cur.items.map((it) => {
        if (it.position !== position) return it;
        target = { ...it, ...patch };
        return target;
      });
      return { ...cur, items };
    });
    if (!target?.id) return; // unsaved import — this tab is the only copy
    const res = await updateItem(createClient(), target.id, patch);
    if (res.missing) { setMissing(true); return; }
    if (!res.ok) say(`That change is on screen but did not save: ${res.error}`, true);
  }, []);

  const undoTitle = useCallback(async (item) => {
    await patchItem(item.position, { title: item.titleOriginal });
    if (item.id) await revertTitle(createClient(), item.id, item.titleOriginal);
  }, [patchItem]);

  const items = open?.items || [];
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      `${i.sku} ${i.title} ${i.set} ${i.cardName} ${i.cardNumber}`.toLowerCase().includes(q)
    );
  }, [items, search]);
  const editedCount = items.filter(isEdited).length;
  const noScanCount = items.filter((i) => !i.images?.length).length;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <span className="eyebrow">Imports</span>
          <span className="hint-small">A CardUploader export, with its scans and card details</span>
        </div>

        <p className="hint">
          The file already carries a photograph of every card and its set, rarity, year, illustrator and
          type. Reading it here means a row can show you the card instead of only its title — and a title
          that is wrong can be fixed <b>before</b> it is searched on, which is what decides the price.
        </p>

        <div className="row row-file">
          <label className="btn btn-primary file-label" htmlFor="importCsv">Import CardUploader CSV</label>
          <input
            id="importCsv" type="file" accept=".csv" onChange={onCsvSelected}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          />
        </div>

        {missing ? (
          <p className="hint hint-small">
            <b>Migration 028 is still to run.</b> Paste <code>supabase/migrations/028_card_imports.sql</code>{" "}
            into the Supabase SQL editor. Until then an import opens and can be edited, but only in this tab.
          </p>
        ) : null}
        {notice ? <p className={`hint hint-small${noticeIsError ? " compfinder-error" : ""}`}>{notice}</p> : null}

        {rows && rows.length > 0 ? (
          <div className="sb-list">
            {rows.map((row) => (
              <div key={row.id} className={`sb-row${open?.imported?.id === row.id ? " sb-row-on" : ""}`}>
                <div className="sb-main">
                  <span className="sb-label">{row.label}</span>
                  <span className="sb-meta">{new Date(row.created_at).toLocaleString()}</span>
                </div>
                <div className="sb-acts">
                  <button className="btn btn-ghost" onClick={() => openImport(row.id)} disabled={busy || open?.imported?.id === row.id}>
                    {open?.imported?.id === row.id ? "Open" : "Open"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => removeImport(row)} disabled={busy}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : rows && !missing ? (
          <p className="hint hint-small">Nothing imported yet. A CardUploader export puts every card here, scans and all.</p>
        ) : null}
      </section>

      {open ? (
        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">{open.imported.label}</span>
            <span className="badge2">
              {items.length} card{items.length === 1 ? "" : "s"}
              {editedCount ? ` · ${editedCount} edited` : ""}
            </span>
          </div>

          <div className="results-toolbar">
            <input
              type="text" placeholder="Filter by title, SKU, set or number…"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <span className="hint-small">
              {shown.length === items.length ? `${items.length} row(s)` : `${shown.length} of ${items.length} row(s)`}
            </span>
            {onPrice && open.imported.id ? (
              <button
                className="btn btn-primary"
                onClick={() => onPrice(open.imported.id)}
                title="Price every card in this import — one SoldComps request each, searched on the titles as they stand now"
              >
                🏷 Price these {items.length}
              </button>
            ) : null}
          </div>

          {/* Nothing is dropped quietly: a card with no scan is a card
              CardUploader had no picture for, and that is worth knowing before
              you go looking for one. */}
          {noScanCount > 0 ? (
            <p className="hint hint-small">
              {noScanCount} card{noScanCount === 1 ? " has" : "s have"} no scan in the file.
            </p>
          ) : null}
          {editedCount > 0 ? (
            <p className="hint hint-small">
              {editedCount} title{editedCount === 1 ? " has" : "s have"} been changed from what the file said.
              An edited title is what gets searched — that is the point of changing it — so the price follows
              your wording, not CardUploader&rsquo;s.
            </p>
          ) : null}

          <div className="ci-list">
            {shown.map((item) => (
              <ImportCard
                key={item.position}
                item={item}
                onPatch={(patch) => patchItem(item.position, patch)}
                onUndo={() => undoTitle(item)}
                onView={(index) => setViewer({ title: item.title, images: item.images, index })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {viewer ? <ScanViewer viewer={viewer} onClose={() => setViewer(null)} onIndex={(index) => setViewer((v) => ({ ...v, index }))} /> : null}
    </>
  );
}

function ImportCard({ item, onPatch, onUndo, onView }) {
  const [editing, setEditing] = useState(false);
  const specifics = CardUploaderCsv.itemSpecifics(item);
  const edited = isEdited(item);

  return (
    <div className={`ci-row${edited ? " ci-row-edited" : ""}`}>
      <div className="ci-scans">
        {item.images?.length ? (
          <>
            <button type="button" className="ci-thumb" onClick={() => onView(0)} title="Open every scan of this card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.images[0]} alt={`Scan of ${item.cardName || item.title}`} loading="lazy" />
            </button>
            {item.images.length > 1 ? (
              <span className="ci-scan-count" onClick={() => onView(0)}>{item.images.length} scans</span>
            ) : null}
          </>
        ) : (
          // A gap, said out loud. Catalogue art would fill this hole with a
          // mint picture of a different copy, which is the one thing worse.
          <div className="ci-thumb ci-thumb-empty" title="CardUploader had no picture for this row">no scan</div>
        )}
      </div>

      <div className="ci-body">
        <TitleEditor value={item.title} onCommit={(title) => onPatch({ title })} />
        {edited ? (
          <div className="ci-was">
            Was &ldquo;{item.titleOriginal}&rdquo;
            <button type="button" className="comps-toggle" onClick={onUndo}>put it back</button>
          </div>
        ) : null}
        {editing ? (
          /* The three at the top are not decoration: the name, the number and
             the set are what the query is built from, so a set CardUploader
             got wrong is a search looking for the wrong card. The rest are
             what you read while deciding. */
          <SpecificsEditor item={item} onPatch={onPatch} />
        ) : specifics.length ? (
          <dl className="ci-specs">
            {specifics.map((s) => (
              <div key={s.label} className="ci-spec">
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="hint hint-small">No card details in the file for this row.</p>
        )}
        <button type="button" className="comps-toggle" onClick={() => setEditing((o) => !o)}>
          {editing ? "▾ Done" : "✎ Edit details"}
        </button>
      </div>

      <div className="ci-fields">
        <StockFields item={item} onPatch={onPatch} />
        {/* The file's own asking price, shown and not editable: on a
            CardUploader export it is the £2.49 placeholder on every row, and
            the price this card should carry is the engine's job, one screen
            along. Making it typeable here would be a third place to set a
            price that nothing downstream reads. */}
        <div className="ci-field ci-field-static">
          <span>In the file</span>
          <b>{item.startPrice ? `£${item.startPrice}` : "—"}</b>
        </div>
      </div>
    </div>
  );
}

/** Every scan of one card, big. A string of four thumbnails would be four
 *  postage stamps; the reason to look at a scan at all is the edge wear. */
function ScanViewer({ viewer, onClose, onIndex }) {
  const { images, index, title } = viewer;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex(Math.min(images.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, index, onClose, onIndex]);

  return (
    <div className="ci-viewer" onClick={onClose}>
      <div className="ci-viewer-inner" onClick={(e) => e.stopPropagation()}>
        <div className="ci-viewer-head">
          <span>{title}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[index]} alt={`Scan ${index + 1} of ${images.length}`} />
        <div className="ci-viewer-strip">
          {images.map((url, i) => (
            <button
              key={url} type="button"
              className={`ci-viewer-dot${i === index ? " on" : ""}`}
              onClick={() => onIndex(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
