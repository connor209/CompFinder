// A small, cohesive line-icon set for the module navigation. All icons share a
// 24×24 grid, 1.8 stroke, round caps/joins and currentColor, so they read as
// one family instead of the mixed-weight emoji they replace.
const ICONS = {
  // Dashboard — a house.
  home: (
    <>
      <path d="M3.6 11 12 4l8.4 7" />
      <path d="M6 9.6V19.4a.6.6 0 0 0 .6.6h10.8a.6.6 0 0 0 .6-.6V9.6" />
    </>
  ),
  // Pricing — magnifier.
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m20.5 20.5-4.1-4.1" />
    </>
  ),
  // Browse — a grid (catalogue of cards).
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  // Buy — shopping cart.
  cart: (
    <>
      <circle cx="9.2" cy="19.2" r="1.25" />
      <circle cx="16.6" cy="19.2" r="1.25" />
      <path d="M3 4h2.1l1.9 10a1.2 1.2 0 0 0 1.2 1h8.1a1.2 1.2 0 0 0 1.18-.94L19.2 8H6.3" />
    </>
  ),
  // eBay / selling — a price tag.
  tag: (
    <>
      <path d="M4.5 4.5h5.9a1 1 0 0 1 .71.29l8 8a1 1 0 0 1 0 1.42l-4.99 4.99a1 1 0 0 1-1.42 0l-8-8A1 1 0 0 1 4.4 10.4V4.5Z" />
      <circle cx="8.2" cy="8.2" r="1.25" />
    </>
  ),
  // Accounts / P&L — a bar chart.
  chart: (
    <>
      <path d="M3.6 20.2h16.8" />
      <path d="M7 20V13.5" />
      <path d="M12 20V8.5" />
      <path d="M17 20v-4" />
    </>
  ),
  // Arbitrage — a rising trend line.
  trend: (
    <>
      <path d="M3.5 16.5 9.5 10.5l3.4 3.4L20.5 6.3" />
      <path d="M15.8 6.3h4.7V11" />
    </>
  )
};

export function Icon({ name, size = 22, className = "" }) {
  const paths = ICONS[name];
  if (!paths) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

export default Icon;
