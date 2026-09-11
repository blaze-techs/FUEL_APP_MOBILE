import React from "react";

export interface SubTab {
  id: string;
  label: string;
  icon?: React.ElementType;
}

interface SubTabBarProps {
  tabs: SubTab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * Lightweight, reusable horizontal sub-tab bar used by merged tabs that
 * host multiple formerly-standalone features as inner views. Styled to match
 * the existing FuelPro dark/light tab chrome.
 */
export default function SubTabBar({
  tabs,
  active,
  onChange,
  className = "",
}: SubTabBarProps) {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [showEdgeHint, setShowEdgeHint] = React.useState(true);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => {
      setShowEdgeHint(el.scrollWidth > el.clientWidth + 8);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [tabs.length]);

  // Auto-scroll the active tab into view on mobile (so the active pill is
  // always visible even if the row overflows off-screen).
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const activeBtn = el.querySelector('[data-active="true"]');
    activeBtn?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [active]);

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className={`flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 overflow-x-auto overscroll-x-contain ${className}`}
        style={{ scrollbarWidth: "thin" }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              data-active={isActive}
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                isActive
                  ? "bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white"
              }`}
            >
              {Icon && <Icon size={16} />}
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* Edge fade hint on the right when the row overflows (mobile) */}
      {showEdgeHint && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-gray-100 dark:from-gray-800 to-transparent"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
