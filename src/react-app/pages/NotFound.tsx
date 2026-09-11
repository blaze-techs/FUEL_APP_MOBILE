import { useEffect } from "react";
import { Link } from "react-router";
import { applySeoMeta, ROUTE_SEO } from "@/react-app/lib/seo";

/**
 * In-app 404 — shown for any unmatched client-side route. A branded static
 * /404.html covers server-side misses (e.g. Cloudflare Pages).
 */
export default function NotFound() {
  useEffect(() => {
    applySeoMeta(ROUTE_SEO["/404"]);
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0e17] flex items-center justify-center px-6 py-12">
      <div className="bg-[#111625] border border-[#2d3748] rounded-2xl px-8 sm:px-12 py-12 max-w-lg w-full text-center shadow-2xl">
        <img
          src="/icon-192.png"
          alt="FuelPro logo"
          width={72}
          height={72}
          className="w-[72px] h-[72px] rounded-2xl mx-auto mb-5"
        />
        <div className="text-5xl font-extrabold text-[#c5a059] tracking-widest leading-none">
          404
        </div>
        <h1 className="text-2xl font-bold text-[#f9fafb] mt-3 mb-2">
          Page not found
        </h1>
        <p className="text-[#a1a1aa] text-[15px] leading-relaxed mb-8">
          The page you are looking for doesn't exist or may have been moved.
          Head back to FuelPro to manage your fuel station.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            to="/"
            className="inline-block px-6 py-3 rounded-xl bg-[#c5a059] text-[#0a0e17] font-semibold text-[15px] hover:bg-[#d4b475] transition-colors"
          >
            Go to Dashboard
          </Link>
          <Link
            to="/sign-in"
            className="inline-block px-6 py-3 rounded-xl border border-[#2d3748] text-[#f9fafb] font-semibold text-[15px] hover:border-[#c5a059] transition-colors"
          >
            Sign in
          </Link>
        </div>
        <nav
          aria-label="Helpful links"
          className="mt-7 pt-5 border-t border-[#2d3748] flex gap-5 justify-center flex-wrap"
        >
          <Link
            to="/"
            className="text-[13px] text-[#a1a1aa] hover:text-[#c5a059] transition-colors"
          >
            Home
          </Link>
          <Link
            to="/sign-up"
            className="text-[13px] text-[#a1a1aa] hover:text-[#c5a059] transition-colors"
          >
            Create account
          </Link>
          <Link
            to="/station-access"
            className="text-[13px] text-[#a1a1aa] hover:text-[#c5a059] transition-colors"
          >
            Station access
          </Link>
        </nav>
      </div>
    </main>
  );
}
