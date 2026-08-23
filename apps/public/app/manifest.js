/**
 * Installable, so the launch splash in lib/splash-frame.js has something to be
 * the launch of. Background matches the splash ground exactly — the system
 * paints it before our image, and any difference shows as a flash.
 */
export default function manifest() {
  return {
    name: "Last Comp",
    short_name: "Last Comp",
    description: "Real eBay UK sold prices for Pokémon cards, and the cheapest one you could buy today.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B1011",
    theme_color: "#0B1011",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" }
    ]
  };
}
