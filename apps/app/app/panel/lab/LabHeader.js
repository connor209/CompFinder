"use client";

import SectionTabs from "../SectionTabs";

/**
 * One header for every lab page. The four pages each had their own — a row
 * of buttons on two, a "← Lab" link on one, nothing on another — so where you
 * were and how to get elsewhere changed from page to page. Now: the same tabs
 * in the same order, the current one lit, on every lab page — drawn by
 * SectionTabs, the strip every multi-screen module now carries.
 */
const TABS = [
  { key: "overview", label: "Overview", href: "/panel/lab" },
  { key: "batches", label: "Batches", href: "/panel/lab/add" },
  { key: "inventory", label: "Inventory", href: "/panel/lab/inventory" },
  { key: "settings", label: "Listing settings", href: "/panel/lab/settings" }
];

export default function LabHeader({ current }) {
  return <SectionTabs label="Lab" tabs={TABS} current={current} />;
}

