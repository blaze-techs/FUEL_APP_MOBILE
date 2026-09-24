import { useEffect } from "react";
import { useLocation } from "react-router";
import { applySeoMeta, ROUTE_SEO } from "@/react-app/lib/seo";

/**
 * Watches the current route and applies the matching title, meta
 * description, canonical URL, robots directive, and social tags.
 * Rendered once inside the Router so every navigation re-applies SEO.
 */
export default function SeoManager() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    // The public station mini site owns its OWN head metadata (title,
    // description, canonical, robots, JSON-LD) because it reflects the
    // STATION's brand. Applying FuelPro's route metadata here would overwrite
    // the station's title/description/JSON-LD on every render.
    if (path.startsWith("/site/")) return;
    // Exact match first, then prefix match for nested paths (e.g. /join/:id).
    const meta =
      ROUTE_SEO[path] ??
      (path.startsWith("/join")
        ? ROUTE_SEO["/join"]
        : path.startsWith("/founder") || path.startsWith("/admin")
          ? ROUTE_SEO["/founder"]
          : path === "/dashboard"
            ? {
                title: "Dashboard",
                description:
                  "Fuel station dashboard: live revenue, fuel sold, pump status, tank levels, and current pump prices.",
                canonicalPath: "/",
                robots: "noindex, nofollow",
              }
            : ROUTE_SEO["/"]);
    applySeoMeta(meta);
  }, [location.pathname]);

  return null;
}
