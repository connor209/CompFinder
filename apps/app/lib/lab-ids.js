"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { liveLabItemIds } from "./lab-store.js";

/**
 * "Is this eBay listing a lab listing?" for screens outside the lab, read
 * once per page and shared: every Deal, Stream and Show button on a screen
 * asks, and one read answers them all. Until it answers — and if it fails —
 * the set is EMPTY, which hides nothing; the server-side guards
 * (checkoutStackCard, the pull sheet) don't depend on it.
 */
let shared = null;
function load() {
  if (!shared) {
    shared = (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return new Set();
      const r = await liveLabItemIds(sb, user.id);
      return r.ids;
    })().catch(() => new Set());
  }
  return shared;
}

export function useLabItemIds() {
  const [ids, setIds] = useState(() => new Set());
  useEffect(() => {
    let live = true;
    load().then((s) => { if (live) setIds(s); });
    return () => { live = false; };
  }, []);
  return ids;
}

/** Test a listing (anything carrying an eBay item id) against the set. */
export const isLabListing = (ids, itemId) => Boolean(itemId) && ids.has(String(itemId));
