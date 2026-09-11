import React from "react";

interface DarkCardProps {
  title: string;
  subtitle?: string;
  priceTag?: string;
  badgeText?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * Reusable dark-mode card with hover elevation, subtle borders, and
 * visual hierarchy. Uses the Framer-inspired dark-theme tokens
 * (#121212 surface, #222 borders, #035bfe accent glow) declared in
 * styles/dark-theme.css. Works in light mode too (falls back to the
 * default card palette) but is designed for the sleek dark aesthetic.
 */
export const DarkCard: React.FC<DarkCardProps> = ({
  title,
  subtitle,
  priceTag,
  badgeText,
  children,
  onClick,
  className = "",
}) => {
  return (
    <div
      onClick={onClick}
      className={`group relative bg-[#121212] dark:bg-[#121212] hover:bg-[#161616] dark:hover:bg-[#161616] border border-[#222222] dark:border-[#222222] hover:border-[#333333] dark:hover:border-[#333333] rounded-2xl p-5 transition-all duration-300 cursor-pointer shadow-lg overflow-hidden flex flex-col justify-between ${className}`}
    >
      {/* Subtle Inner Gradient Glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      <div>
        {/* Top Meta Bar */}
        <div className="flex items-center justify-between gap-2 mb-3">
          {badgeText && (
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2.5 py-1 rounded-full bg-[#1e1e1e] dark:bg-[#1e1e1e] border border-[#2d2d2d] dark:border-[#2d2d2d] text-[#a1a1aa] dark:text-[#a1a1aa]">
              {badgeText}
            </span>
          )}
          {priceTag && (
            <span className="text-xs font-medium text-white/90 bg-[#1a1a1a] dark:bg-[#1a1a1a] px-2 py-0.5 rounded-md border border-[#2a2a2a] dark:border-[#2a2a2a]">
              {priceTag}
            </span>
          )}
        </div>

        {/* Content Body */}
        <h3 className="text-base font-bold text-white dark:text-white group-hover:text-[#035bfe] dark:group-hover:text-[#035bfe] transition-colors">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-[#a1a1aa] dark:text-[#a1a1aa] mt-1 line-clamp-2 leading-relaxed">
            {subtitle}
          </p>
        )}

        {children && <div className="mt-4">{children}</div>}
      </div>

      {/* Footer Accent Indicator */}
      <div className="mt-5 pt-3 border-t border-[#1f1f1f] dark:border-[#1f1f1f] flex items-center justify-between text-[11px] text-[#71717a] dark:text-[#71717a]">
        <span>Explore details</span>
        <span className="group-hover:translate-x-1 transition-transform text-white dark:text-white">
          →
        </span>
      </div>
    </div>
  );
};

export default DarkCard;
