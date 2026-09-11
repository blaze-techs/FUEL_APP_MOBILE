/**
 * CommandPaletteSection — a searchable command center for the Founder Console.
 * Lists every available section/action as a searchable, keyboard-navigable
 * command. Selecting a command navigates to that section. Demonstrates the
 * "more actions / more flexibility" requirement.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Command,
} from "lucide-react";
import { SectionHeader } from "./WebhooksManagerSection";

interface CommandItem {
  id: string;
  label: string;
  group: string;
  keywords: string;
  icon?: React.ElementType;
}

interface Props {
  commands: CommandItem[];
  onRun: (id: string) => void;
}

export default function CommandPaletteSection({ commands, onRun }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        c.keywords.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIndex];
      if (cmd) onRun(cmd.id);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return Array.from(map.entries());
  }, [filtered]);

  let runningIndex = -1;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Command}
        title="Command Palette"
        subtitle="Search and jump to any console section instantly"
      />

      <div className="relative">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type to search commands... (↑↓ to navigate, Enter to select)"
          className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-base text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
        />
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <ArrowUp size={12} />
          <ArrowDown size={12} /> Navigate
        </span>
        <span className="flex items-center gap-1">
          <CornerDownLeft size={12} /> Select
        </span>
        <span>{filtered.length} results</span>
      </div>

      <div className="rounded-xl bg-white/5 border border-white/10 max-h-[60vh] overflow-y-auto">
        {grouped.length === 0 && (
          <div className="py-12 text-center text-gray-500 text-sm">
            No commands match "{query}"
          </div>
        )}
        {grouped.map(([group, items]) => (
          <div key={group}>
            <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 bg-white/5 sticky top-0">
              {group}
            </div>
            {items.map((c) => {
              runningIndex++;
              const idx = runningIndex;
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => onRun(c.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    activeIndex === idx
                      ? "bg-amber-500/10 text-white"
                      : "text-gray-300 hover:bg-white/5"
                  }`}
                >
                  {Icon && (
                    <Icon
                      size={16}
                      className={
                        activeIndex === idx ? "text-amber-400" : "text-gray-500"
                      }
                    />
                  )}
                  <span className="text-sm">{c.label}</span>
                  {activeIndex === idx && (
                    <CornerDownLeft
                      size={12}
                      className="ml-auto text-amber-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
