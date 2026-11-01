import React from "react";
import { groupFor } from "@/react-app/config/subtab-groups";

export interface SubTab {
  id: string;
  label: string;
  icon?: React.ElementType;
  /** Optional explicit group heading (overrides the config lookup). */
  group?: string;
}

interface SubTabBarProps {
  tabs: SubTab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  /** Host tab id; looks up related-tab groups in `subtab-groups.ts`. */
  host?: string;
}

/**
 * Reusable sub-tab bar for modules that host several inner views.
 *
 * Every tab is always visible: the strip wraps rather than scrolling, and when
 * the host has group definitions related tabs sit together under a small
 * heading, so nothing is hidden past a scroll edge.
 */
export default function SubTabBar({
  tabs,
  active,
  onChange,
  className = "",
  host,
}: SubTabBarProps) {
  const sections = React.useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, SubTab[]>();
    for (const tab of tabs) {
      const g = tab.group ?? groupFor(host, tab.id);
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(tab);
    }
    return order.map((g) => ({ group: g, tabs: byGroup.get(g)! }));
  }, [tabs, host]);

  const grouped = sections.some((s) => s.group);

  const renderTab = (tab: SubTab) => {
    const Icon = tab.icon;
    const isActive = active === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        data-active={isActive}
        aria-current={isActive ? "page" : undefined}
        onClick={() => onChange(tab.id)}
        className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
          isActive
            ? "bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm"
            : "text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white"
        }`}
      >
        {Icon && <Icon size={16} />}
        {tab.label}
      </button>
    );
  };

  if (!grouped) {
    return (
      <div
        className={`flex flex-wrap gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 ${className}`}
      >
        {tabs.map(renderTab)}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap gap-x-4 gap-y-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-2 ${className}`}
    >
      {sections.map((s) => (
        <div
          key={s.group || "_"}
          role="group"
          aria-label={s.group || undefined}
          className="flex flex-col gap-1"
        >
          {s.group && (
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {s.group}
            </span>
          )}
          <div className="flex flex-wrap gap-1">{s.tabs.map(renderTab)}</div>
        </div>
      ))}
    </div>
  );
}
