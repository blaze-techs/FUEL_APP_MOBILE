import { Mail, Phone } from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";

const SUPPORT_EMAIL =
  import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "support@fuelpro.com";
export default function SupportFooter() {
  const { state } = useFuel();
  // Prefer an explicitly configured support number, then the station/company
  // contact already stored in FuelPro. Never publish a fabricated number.
  const supportPhone =
    import.meta.env.VITE_SUPPORT_PHONE?.trim() ||
    state.companyData?.contacts?.trim() ||
    "";
  const phoneHref = supportPhone.replace(/[^+\d]/g, "");

  return (
    <footer
      aria-label="FuelPro support"
      className="border-t border-gray-200 dark:border-white/10 bg-white/70 dark:bg-slate-950/70 backdrop-blur px-4 py-3"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
        <span>FuelPro Support</span>
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={"mailto:" + SUPPORT_EMAIL}
            className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={"Email FuelPro Support at " + SUPPORT_EMAIL}
          >
            <Mail size={13} aria-hidden="true" /> {SUPPORT_EMAIL}
          </a>
          {supportPhone && (
            <a
              href={"tel:" + phoneHref}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label={"Call FuelPro Support at " + supportPhone}
            >
              <Phone size={13} aria-hidden="true" /> {supportPhone}
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
