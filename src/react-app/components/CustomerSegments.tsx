import { useMemo, useState } from "react";
import {
  Users,
  Download,
  MessageSquare,
  Crown,
  AlertTriangle,
  UserPlus,
  Cake,
  Search,
} from "lucide-react";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import {
  downloadCsv,
  segmentOf,
  daysSince,
  SEGMENT_LABELS,
  type CustomerSegment,
} from "@/react-app/lib/forecourt-features";

interface LoyaltyCustomer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  loyaltyPoints?: number;
  totalSpent?: number;
  visits?: number;
  lastVisit?: string;
  tier?: string;
  notes?: string;
}

/**
 * CustomerSegments — Veira-style CRM segmentation + Codelab-style event
 * reminders. Customers are grouped into VIP / Active / At Risk / Dormant /
 * New from their real loyalty data (points, spend, last visit). Each
 * segment can be exported and messaged via the Communication tab. Birthday
 * reminders parse an optional `birthday: DD/MM` token from the customer's
 * notes field — conventions only, no fabricated data.
 */
export default function CustomerSegments({
  customers,
}: {
  customers: LoyaltyCustomer[];
}) {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const currencySymbol = state.companyData?.currency
    ? resolveCurrencySymbol(
        state.companyData.currency,
        currentStation?.currency,
      )
    : resolveCurrencySymbol(undefined, currentStation?.currency);

  const [filter, setFilter] = useState<CustomerSegment | "all">("all");
  const [query, setQuery] = useState("");

  const enriched = useMemo(
    () =>
      customers.map((c) => ({
        ...c,
        segment: segmentOf(c),
        daysAgo: daysSince(c.lastVisit),
      })),
    [customers],
  );

  const counts = useMemo(() => {
    const m = new Map<CustomerSegment, number>();
    for (const c of enriched) m.set(c.segment, (m.get(c.segment) ?? 0) + 1);
    return m;
  }, [enriched]);

  const filtered = useMemo(
    () =>
      enriched.filter(
        (c) =>
          (filter === "all" || c.segment === filter) &&
          (query.trim() === "" ||
            c.name?.toLowerCase().includes(query.toLowerCase()) ||
            c.phone?.includes(query)),
      ),
    [enriched, filter, query],
  );

  // Birthday tokens in notes ("birthday: MM/DD") — within next 30 days.
  const birthdays = useMemo(
    () =>
      enriched
        .map((c) => {
          const m = /birthday\s*:\s*(\d{1,2})\/(\d{1,2})/i.exec(c.notes || "");
          if (!m) return null;
          const now = new Date();
          const next = new Date(now.getFullYear(), +m[2] - 1, +m[1]);
          if (next.getTime() < now.getTime())
            next.setFullYear(now.getFullYear() + 1);
          const inDays = Math.ceil((next.getTime() - now.getTime()) / 86400000);
          return { customer: c, inDays, when: `${m[1]}/${m[2]}` };
        })
        .filter(Boolean)
        .filter((b) => b!.inDays <= 30)
        .sort((a, b) => a!.inDays - b!.inDays) as {
        customer: LoyaltyCustomer & {
          segment: CustomerSegment;
          daysAgo: number | null;
        };
        inDays: number;
        when: string;
      }[],
    [enriched],
  );

  const exportCsv = () => {
    downloadCsv(
      `customer-segments-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        [
          "Name",
          "Phone",
          "Segment",
          "Tier",
          "Points",
          "Total Spent",
          "Last Visit",
        ],
        ...filtered.map((c) => [
          c.name,
          c.phone ?? "",
          SEGMENT_LABELS[c.segment],
          c.tier ?? "",
          c.loyaltyPoints ?? 0,
          c.totalSpent ?? 0,
          c.lastVisit ?? "",
        ]),
      ],
    );
  };

  const messageSegment = (seg: CustomerSegment) => {
    const names = filtered
      .filter((c) => c.segment === seg)
      .map((c) => c.name)
      .join(", ");
    navigateToTab("communication", {
      contactName: names || SEGMENT_LABELS[seg],
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
          Customer Segments & Events
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customers"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Segment cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(Object.keys(SEGMENT_LABELS) as CustomerSegment[]).map((seg) => (
          <button
            key={seg}
            onClick={() => setFilter((f) => (f === seg ? "all" : seg))}
            className={`rounded-xl border p-3 text-left transition-all ${
              filter === seg
                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-amber-400"
            }`}
          >
            <div className="flex items-center gap-1.5">
              {seg === "vip" ? (
                <Crown className="w-4 h-4 text-amber-500" />
              ) : seg === "at-risk" || seg === "dormant" ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : seg === "new" ? (
                <UserPlus className="w-4 h-4 text-sky-500" />
              ) : (
                <Users className="w-4 h-4 text-green-500" />
              )}
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {SEGMENT_LABELS[seg]}
              </span>
            </div>
            <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
              {counts.get(seg) ?? 0}
            </div>
          </button>
        ))}
      </div>

      {/* Birthdays / events */}
      {birthdays.length > 0 && (
        <div className="rounded-xl border border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-900/10 p-3 flex flex-wrap items-center gap-2">
          <Cake className="w-4 h-4 text-pink-500" />
          <span className="text-sm font-medium text-pink-800 dark:text-pink-300">
            Upcoming birthdays:{" "}
            {birthdays
              .slice(0, 4)
              .map((b) => `${b.customer.name} (in ${b.inDays}d)`)
              .join(", ")}
            {birthdays.length > 4 ? "…" : ""}
          </span>
          <button
            onClick={() => navigateToTab("communication")}
            className="ml-auto text-xs font-semibold text-pink-700 dark:text-pink-300 underline"
          >
            Send wishes (Communication)
          </button>
        </div>
      )}

      {/* Segment table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {filtered.length === 0 ? (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            No customers in this segment.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Segment</th>
                  <th className="px-4 py-2">Tier</th>
                  <th className="px-4 py-2 text-right">Points</th>
                  <th className="px-4 py-2 text-right">Total Spent</th>
                  <th className="px-4 py-2">Last Visit</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-100 dark:border-gray-700/50"
                  >
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                      {c.name}
                      {c.phone && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {c.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                        {SEGMENT_LABELS[c.segment]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                      {c.tier ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {c.loyaltyPoints ?? 0}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {currencySymbol} {formatNumber(c.totalSpent ?? 0, 2)}
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                      {c.daysAgo != null ? `${c.daysAgo}d ago` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => messageSegment(c.segment)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                        title="Message this segment via Communication"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Message
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
