/**
 * What the panel shows while the server is answering a page load: a saved
 * run's URL, a ?pool or ?import link, a reload. Switching sections no longer
 * comes here at all (lib/client-nav.js); without this the old screen simply
 * sat there with no sign anything was happening.
 */
export default function PanelLoading() {
  return (
    <div className="panel-loading" role="status">
      <span className="spinner" /> Loading…
    </div>
  );
}
