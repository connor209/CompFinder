"use client";

import { useEffect, useState } from "react";
import { SPECIFIC_COLUMNS } from "@/lib/import-store.js";

/**
 * The card's own details, editable — one definition, two screens.
 *
 * It started on the Imports screen. The Batch results then needed the same
 * thing, because the moment you actually notice a wrong set is when you are
 * looking at the price it produced, not when you are looking at the file. Two
 * copies of this would drift about WHICH fields can be corrected, and the one
 * that drifts silently is the one where an edit looks accepted and changes
 * nothing.
 *
 * The field list is derived from `SPECIFIC_COLUMNS` — the store's own
 * allow-list — so a field cannot be offered here that the store would refuse
 * to write. `check-cardimport.mjs` fails if the two ever disagree.
 */

/** eBay's own limit. A CardUploader title runs close to it and a correction is
 *  exactly what pushes one over, at which point eBay refuses the upload rather
 *  than trimming it for you. */
export const TITLE_MAX = 80;

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

const SPECIFIC_LABELS = {
  cardName: "Card name",
  cardNumber: "Number",
  set: "Set",
  cardType: "Type",
  year: "Year",
  rarity: "Rarity",
  stage: "Stage",
  illustrator: "Illustrator",
  language: "Language"
};

export const SPECIFIC_FIELDS = Object.keys(SPECIFIC_COLUMNS)
  .filter((key) => SPECIFIC_LABELS[key])
  .sort((a, b) => Object.keys(SPECIFIC_LABELS).indexOf(a) - Object.keys(SPECIFIC_LABELS).indexOf(b))
  .map((key) => ({ key, label: SPECIFIC_LABELS[key] }));

/**
 * Which edits change what the card IS, and therefore what it would be searched
 * as. `buildQueryFromItem` composes the query from the name, the number and
 * the set, and the title decides the printing — so a change to any of these
 * means the price already on the row was worked out for a different question.
 *
 * Rarity, year and illustrator are not here: they are what you read while
 * deciding, and correcting one changes nothing about the search.
 */
const IDENTITY_FIELDS = new Set(["title", "cardName", "cardNumber", "set"]);

export function changesTheSearch(patch) {
  return Object.keys(patch || {}).some((key) => IDENTITY_FIELDS.has(key));
}

/** The specifics, as a grid of inputs. Committed on blur, so a half-typed set
 *  name never reaches the store. */
export function SpecificsEditor({ item, onPatch }) {
  return (
    <div className="ci-edit">
      {SPECIFIC_FIELDS.map(({ key, label }) => (
        <label key={key} className="ci-field">
          <span>{label}</span>
          <input
            defaultValue={item[key] || ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (item[key] || "")) onPatch({ [key]: v });
            }}
          />
        </label>
      ))}
    </div>
  );
}

/** The eBay title, with the character count eBay will refuse it on. */
export function TitleEditor({ value, onCommit, ariaLabel = "eBay title" }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const over = text.length > TITLE_MAX;
  const commit = () => {
    const next = text.trim();
    if (next && next !== value) onCommit(next);
    else setText(value);
  };
  return (
    <span className="ci-titlerow">
      <input
        className={`ci-title${over ? " ci-title-over" : ""}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(value);
        }}
        aria-label={ariaLabel}
      />
      <span className={`ci-count${over ? " ci-count-over" : ""}`}>{text.length}/{TITLE_MAX}</span>
    </span>
  );
}

/** SKU, condition and quantity — the three that are neither the title nor a
 *  card fact, and that every screen showing a card wants to correct. */
export function StockFields({ item, onPatch }) {
  return (
    <>
      <label className="ci-field">
        <span>SKU</span>
        <input
          defaultValue={item.sku || ""}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.sku || "")) onPatch({ sku: v }); }}
        />
      </label>
      <label className="ci-field">
        <span>Condition</span>
        <select value={item.condition || ""} onChange={(e) => onPatch({ condition: e.target.value })}>
          {CONDITIONS.includes(item.condition) ? null : <option value={item.condition || ""}>{item.condition || "—"}</option>}
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="ci-field">
        <span>Quantity</span>
        <input type="number" min="1" defaultValue={item.quantity ?? 1} onBlur={(e) => onPatch({ quantity: e.target.value })} />
      </label>
    </>
  );
}
