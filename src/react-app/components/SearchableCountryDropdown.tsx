import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, ChevronDown, Globe, MapPin } from "lucide-react";
import { ALL_COUNTRIES } from "@/react-app/lib/world-country-utils";
import { resolveCountryFromBrowser } from "@/react-app/lib/geo-utils";

export interface SearchableCountryDropdownProps {
  value: string;
  onChange: (countryCode: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  showFlag?: boolean;
  /** Optional filter to show only specific countries */
  filterCountries?: string[];
  /** Auto-detect label */
  showAutoDetect?: boolean;
}

/** A searchable dropdown for selecting from 250+ countries without UI oversaturation.
 *  Features: search filtering, keyboard navigation, auto-detect button, virtual-scroll friendly.
 */
export default function SearchableCountryDropdown({
  value,
  onChange,
  label = "Select Country / Region",
  placeholder = "Search countries...",
  className = "",
  id,
  showFlag = true,
  filterCountries,
  showAutoDetect = true,
}: SearchableCountryDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const countries = useMemo(() => {
    let list = ALL_COUNTRIES;
    if (filterCountries?.length) {
      const upper = filterCountries.map((c) => c.toUpperCase());
      list = list.filter((c) => upper.includes(c.code));
    }
    return list;
  }, [filterCountries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.currency.toLowerCase().includes(q),
    );
  }, [search, countries]);

  const selected = useMemo(
    () => countries.find((c) => c.code === value) || null,
    [value, countries],
  );

  // Auto-detect from browser timezone / localStorage
  const handleAutoDetect = useCallback(() => {
    try {
      const saved = localStorage.getItem("fuelpro_location_country");
      if (saved) {
        const parsed = JSON.parse(saved);
        const cc = parsed.currentCountry || parsed.country;
        if (cc) {
          onChange(cc.toUpperCase());
          setIsOpen(false);
          setSearch("");
          return;
        }
      }
    } catch {
      /* */
    }
    // Use shared geo utility (250+ timezone mappings)
    const cc = resolveCountryFromBrowser();
    if (cc && cc !== "US") {
      onChange(cc);
    }
    setIsOpen(false);
    setSearch("");
  }, [onChange]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search on open + edge-flip detection
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
      setHighlightedIndex(0);
      // Rule 2: detect viewport edge and flip menu if needed
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const menuHeight = 320;
        if (spaceBelow < menuHeight && rect.top > menuHeight) {
          setPlacement("top");
        } else {
          setPlacement("bottom");
        }
      }
    } else {
      setPlacement("bottom");
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[highlightedIndex]) {
            onChange(filtered[highlightedIndex].code);
            setIsOpen(false);
            setSearch("");
          }
          break;
        case "Escape":
          setIsOpen(false);
          setSearch("");
          break;
      }
    },
    [isOpen, filtered, highlightedIndex, onChange],
  );

  return (
    <div
      className={`relative ${className}`}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      {label && (
        <label className="text-xs text-gray-400 mb-1.5 block flex items-center gap-1">
          <Globe size={11} /> {label}
        </label>
      )}

      {/* Trigger button — Rule 1: 48px touch target, hover feedback, ARIA */}
      <button
        type="button"
        id={id}
        onClick={() => setIsOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="w-full flex h-12 items-center justify-between gap-2 px-4 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white hover:bg-white/[0.06] hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-150"
      >
        <div className="flex items-center gap-2 min-w-0">
          {showFlag && selected && (
            <span className="text-base shrink-0">{selected.flag}</span>
          )}
          <span className="truncate">
            {selected ? `${selected.code} - ${selected.name}` : placeholder}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-500 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown — Rule 2: edge-flip, Rule 5: 150ms animation */}
      {isOpen && (
        <div
          className={`absolute z-[100] w-full bg-[#1c1c1e] border border-white/[0.08] rounded-lg shadow-2xl overflow-hidden transition-all duration-150 ${
            placement === "top"
              ? "bottom-full mb-2 origin-bottom"
              : "top-full mt-2 origin-top"
          } opacity-100 scale-100 translate-y-0`}
        >
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
            <Search size={13} className="text-gray-500 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlightedIndex(0);
              }}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
            />
            {showAutoDetect && (
              <button
                type="button"
                onClick={handleAutoDetect}
                className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-[10px] bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20 transition-colors"
                title="Auto-detect from location"
              >
                <MapPin size={9} /> Auto
              </button>
            )}
          </div>

          {/* Country count */}
          <div className="px-3 py-1 text-[10px] text-gray-600 border-b border-white/[0.04]">
            {filtered.length} of {countries.length} countries
          </div>

          {/* List — Rule 3: ARIA listbox, Rule 1: 40px touch targets */}
          <div className="max-h-56 overflow-y-auto" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-600">
                No countries match &quot;{search}&quot;
              </div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={c.code === value}
                  onClick={() => {
                    onChange(c.code);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex h-10 items-center gap-2 px-3 text-sm transition-colors duration-150 text-left ${
                    c.code === value
                      ? "bg-amber-500/10 text-amber-300"
                      : i === highlightedIndex
                        ? "bg-white/[0.06] text-white"
                        : "text-gray-300 hover:bg-white/[0.04]"
                  }`}
                >
                  {showFlag && (
                    <span className="text-base shrink-0">{c.flag}</span>
                  )}
                  <span className="truncate flex-1">{c.name}</span>
                  <span className="text-[10px] text-gray-600 shrink-0 ml-1">
                    {c.code}
                  </span>
                  <span className="text-[10px] text-gray-700 shrink-0">
                    {c.currency}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Lightweight inline searchable country selector for compact UI */
export function InlineCountrySelector({
  value,
  onChange,
  className = "",
}: Omit<
  SearchableCountryDropdownProps,
  "label" | "placeholder" | "showFlag" | "showAutoDetect"
>) {
  return (
    <SearchableCountryDropdown
      value={value}
      onChange={onChange}
      label=""
      placeholder="Country..."
      className={className}
      showFlag
      showAutoDetect={false}
    />
  );
}
