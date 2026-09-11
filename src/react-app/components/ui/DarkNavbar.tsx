import React from "react";

interface DarkNavbarLink {
  label: string;
  href: string;
}

interface DarkNavbarProps {
  brand?: string;
  brandGlyph?: React.ReactNode;
  links?: DarkNavbarLink[];
  onSignIn?: () => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  /** Optional right-side extra node (e.g. a user menu). */
  rightSlot?: React.ReactNode;
}

/**
 * Floating dark navigation header with glassmorphism blur and seamless
 * button styling (Framer-inspired). This is a reusable presentational
 * navbar — it is NOT a replacement for the functional app Header
 * (which carries Edit Info, Theme, Tabs, Logo, QR, Search, Admin,
 * Logout). Use it for marketing/landing surfaces or embedded sub-views
 * that need a sleek standalone nav.
 */
export const DarkNavbar: React.FC<DarkNavbarProps> = ({
  brand = "FuelPro",
  brandGlyph = <span className="text-lg">⬡</span>,
  links = [],
  onSignIn,
  onPrimaryAction,
  primaryActionLabel = "Get Started →",
  rightSlot,
}) => {
  return (
    <header className="sticky top-0 z-50 w-full bg-[#0a0a0a]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md border-b border-[#1f1f1f] dark:border-[#1f1f1f] px-6 py-4 flex items-center justify-between">
      {/* Brand Logo */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-white text-black font-extrabold flex items-center justify-center">
          {brandGlyph}
        </div>
        <span className="font-bold text-white dark:text-white tracking-tight text-base">
          {brand}
        </span>
      </div>

      {/* Navigation Links */}
      {links.length > 0 && (
        <nav className="hidden md:flex items-center gap-6 text-xs text-[#a1a1aa] dark:text-[#a1a1aa]">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hover:text-white dark:hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        {rightSlot}
        {onSignIn && (
          <button
            onClick={onSignIn}
            className="text-xs text-[#a1a1aa] dark:text-[#a1a1aa] hover:text-white dark:hover:text-white px-3 py-1.5 transition-colors"
          >
            Sign In
          </button>
        )}
        {onPrimaryAction && (
          <button
            onClick={onPrimaryAction}
            className="text-xs font-semibold text-black bg-white hover:bg-neutral-200 dark:hover:bg-neutral-200 px-4 py-2 rounded-xl transition-all shadow-md"
          >
            {primaryActionLabel}
          </button>
        )}
      </div>
    </header>
  );
};

export default DarkNavbar;
