import { Mail, Phone } from "lucide-react";

const SUPPORT_EMAIL = "support@fuelpro.com";
const SUPPORT_PHONE = "+254 700 000 000";

export default function SupportFooter() {
  return (
    <footer className="border-t border-gray-200 dark:border-white/10 bg-white/70 dark:bg-slate-950/70 backdrop-blur px-4 py-3">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>FuelPro Support</span>
        <div className="flex flex-wrap items-center gap-4">
          <a href={"mailto:" + SUPPORT_EMAIL} className="inline-flex items-center gap-1.5 hover:text-indigo-500">
            <Mail size={13} /> {SUPPORT_EMAIL}
          </a>
          <a href={"tel:" + SUPPORT_PHONE.replace(/\s/g, "")} className="inline-flex items-center gap-1.5 hover:text-indigo-500">
            <Phone size={13} /> {SUPPORT_PHONE}
          </a>
        </div>
      </div>
    </footer>
  );
}
