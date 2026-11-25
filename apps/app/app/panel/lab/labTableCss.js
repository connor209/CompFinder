/**
 * The lab's table look (Inventory, Add copies), laid out like CardUploader's
 * inventory. One copy, so the two pages can't drift apart.
 */
/** Scoped to .li-*, built on the app's own colour tokens so it follows light and dark. */
export const LAB_TABLE_CSS = `
.li-wrap { max-width: 1600px; margin: 0 auto; padding: 16px; color: var(--ink); }
.li-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.li-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.li-title h1 { margin: 0; font-size: 24px; }
.li-totals { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--ink-soft); }
.li-totals b { color: var(--ink); }
.li-headbtns, .li-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.li-toolbar { margin-bottom: 10px; }
.li-spacer { flex: 1 1 auto; }
.li-btn, .li-select, .li-chip { font: inherit; font-size: 13px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 7px 12px; cursor: pointer; text-decoration: none; }
.li-btn:disabled, .li-chip:disabled { opacity: .45; cursor: default; }
.li-btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.li-select.on { border-color: var(--accent); }
.li-chip { padding: 4px 10px; font-size: 12px; background: var(--surface-2); }
.li-chip.danger, .li-menu .danger { color: var(--bad); }
.li-search { flex: 1 1 280px; min-width: 0; font: inherit; font-size: 14px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); }
.li-num { width: 90px; font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); }
.li-seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
.li-seg button { font: inherit; font-size: 12px; padding: 7px 10px; border: 0; background: var(--surface); color: var(--ink-soft); cursor: pointer; }
.li-seg button.on { background: var(--accent-soft); color: var(--ink); font-weight: 600; }
.li-icon { font: inherit; border: 0; background: transparent; color: var(--ink-soft); cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.li-icon:disabled { opacity: .35; cursor: default; }
.li-boxed { border: 1px solid var(--line-strong); padding: 6px 10px; }
.li-iconpad { display: inline-block; width: 22px; }
.li-panel { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px; margin-bottom: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font-size: 13px; }
.li-panel.inset { margin: 0; border-radius: 0; border-width: 0 0 1px; background: var(--surface-2); }
.li-panel label { display: flex; gap: 6px; align-items: center; color: var(--ink-soft); }
.li-check { display: inline-flex; gap: 6px; align-items: center; }
.li-plan { flex-basis: 100%; max-height: 220px; overflow: auto; font-size: 13px; line-height: 1.6; }
.li-plan .skip { color: var(--ink-faint); }
.li-frame { width: 100%; min-height: 220px; background: #fff; border: 1px solid var(--line); border-radius: 8px; margin-top: 6px; }
.li-msg { margin: 0 0 8px; color: var(--good); font-size: 14px; }
.li-msg.bad { color: var(--bad); }
.li-warn { color: var(--warn); }
.li-dim { color: var(--ink-faint); font-size: 12px; }
.li-link { font: inherit; border: 0; background: none; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; }
.li-card { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
.li-bulk, .li-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.li-foot { border-bottom: 0; border-top: 1px solid var(--line); }
.li-pager { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--ink-soft); }
.li-scroll { overflow-x: auto; }
.li-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.li-table th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; padding: 10px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.li-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; white-space: nowrap; }
.li-table tr:hover td { background: var(--surface-2); }
.li-table tr.ended td { opacity: .5; }
.li-table tr.li-sub td { background: var(--surface-sink); padding-top: 6px; padding-bottom: 6px; }
.li-table .r { text-align: right; }
.li-table .price { color: var(--good); font-weight: 600; }
.li-table .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.li-table small { display: block; color: var(--ink-faint); font-size: 11px; font-family: inherit; }
.li-cb { width: 32px; }
.li-cardcell { display: flex; align-items: center; gap: 8px; white-space: normal; min-width: 240px; }
.li-cardcell b { display: block; }
.li-thumb { position: relative; display: inline-block; width: 36px; height: 50px; flex: none; background: var(--surface-sink); border-radius: 4px; overflow: hidden; }
.li-thumb img { width: 100%; height: 100%; object-fit: contain; }
.li-thumb img.onshow { outline: 2px solid var(--accent); outline-offset: -2px; }
.li-thumb i { position: absolute; left: 0; right: 0; bottom: 0; font-style: normal; font-size: 8px; text-align: center; background: rgba(0,0,0,.65); color: #fff; }
.li-status { display: inline-block; border: 1px solid var(--line-strong); border-radius: 6px; padding: 2px 7px; font-size: 11px; white-space: nowrap; }
.li-status.s-live, .li-status.s-next { border-color: var(--good); color: var(--good); }
.li-status.s-soldout, .li-status.s-sold { border-color: var(--warn); color: var(--warn); }
.li-status.s-ended, .li-status.s-picked { color: var(--ink-faint); }
.li-status.sm-only { display: none; }
@media (max-width: 760px) { .li-table .sm-hide { display: none; } .li-status.sm-only { display: inline-block; margin-top: 3px; } .li-cardcell { min-width: 150px; } .li-wrap { padding: 12px; } .li-table td, .li-table th { padding-left: 6px; padding-right: 6px; } }
.li-empty { text-align: center; color: var(--ink-faint); padding: 32px !important; }
.li-menucell { position: relative; width: 40px; text-align: right; }
.li-menu { position: absolute; right: 8px; top: 36px; z-index: 20; min-width: 180px; background: var(--surface); border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: var(--shadow-2); padding: 4px; text-align: left; }
.li-menu a, .li-menu button { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; padding: 8px 10px; border: 0; background: none; color: var(--ink); border-radius: 6px; cursor: pointer; text-decoration: none; }
.li-menu a:hover, .li-menu button:hover { background: var(--surface-2); }
`;
