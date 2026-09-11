/* ItemMovementLedger — reverse-engineered Codelab FMS "Item Ledger Report /
 * Item Movement Report": a per-product chronological ledger of every stock
 * movement (purchase, sale, adjustment, transfer, wastage) with running
 * balance. Complements the existing History sub-tab (raw inventory
 * transactions) by grouping movements per item with running totals.
 * Cloud KV `item_movement_entries` (station-scoped).
 */
import { BookOpen, Download, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { fetchInventoryTransactions } from "@/react-app/lib/pos-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "item_movement_entries";

export type MovementType =
  "purchase" | "sale" | "adjustment" | "transfer" | "wastage";

interface MovementEntry {
  id: string;
  item: string;
  type: MovementType;
  date: string;
  qty: number;
  reference: string;
  /** "auto" = derived from the real stock/payment matrix (inventory
   *  transactions) — read-only. undefined = manual entry. */
  source?: "auto" | "manual";
}

/** Maps the real inventory_transactions.transaction_type onto the ledger's
 *  movement vocabulary so actual stock operations show up automatically. */
function mapTransactionType(raw: string): MovementType {
  const t = (raw || "").toLowerCase();
  if (t === "sale" || t === "sell") return "sale";
  if (t === "restock" || t === "purchase" || t === "receive") return "purchase";
  if (t === "transfer") return "transfer";
  if (t === "wastage" || t === "waste" || t === "damage") return "wastage";
  return "adjustment";
}

function id() {
  return `mv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const TYPE_SIGN: Record<MovementType, 1 | -1> = {
  purchase: 1,
  sale: -1,
  adjustment: 1,
  transfer: -1,
  wastage: -1,
};

export default function ItemMovementLedger() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: entries, setData: setEntries } = useCloudKV<MovementEntry[]>(
    KEY,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    item: "",
    type: "purchase" as MovementType,
    qty: "",
    reference: "",
  });
  const [filterItem, setFilterItem] = useState("");

  // Data-sharing matrix: pull REAL stock movements from the
  // inventory_transactions table (written by Products adjustments, stock
  // transfers, wastage logs, reorder fulfillment, POS checkout) so the
  // ledger reflects actual operations without double data entry.
  const [autoEntries, setAutoEntries] = useState<MovementEntry[]>([]);
  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    (async () => {
      const txns = await fetchInventoryTransactions(stationId, undefined, 200);
      if (cancelled) return;
      setAutoEntries(
        txns.map((t: any) => ({
          id: `auto_${t.id}`,
          item: t.products?.name || "Unknown item",
          type: mapTransactionType(t.transaction_type || ""),
          date: t.created_at || "",
          qty: Math.abs(t.quantity_change ?? 0),
          reference: t.notes || t.reference_type || "",
          source: "auto" as const,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  // Manual entries + auto-derived movements, unified (auto rows are
  // read-only; manual rows keep full CRUD).
  const allEntries = useMemo(() => {
    const manual = (entries || []).map((e) => ({
      ...e,
      source: "manual" as const,
    }));
    return [...autoEntries, ...manual];
  }, [entries, autoEntries]);

  const items = useMemo(
    () => Array.from(new Set(allEntries.map((e) => e.item))).sort(),
    [allEntries],
  );

  const visible = useMemo(
    () =>
      allEntries
        .filter((e) => !filterItem || e.item === filterItem)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [allEntries, filterItem],
  );

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...allEntries].sort((a, b) => a.date.localeCompare(b.date));
    for (const e of sorted) {
      map.set(e.id, (map.get(e.item) ?? 0) + TYPE_SIGN[e.type] * e.qty);
      map.set(e.item, map.get(e.id)!);
    }
    return map;
  }, [allEntries]);

  const addEntry = () => {
    const item = form.item.trim();
    const qty = parseFloat(form.qty);
    if (!item) return toastError("Item name is required.");
    if (!Number.isFinite(qty) || qty <= 0)
      return toastError("Quantity must be greater than 0.");
    setEntries([
      {
        id: id(),
        item,
        type: form.type,
        date: new Date().toISOString().split("T")[0],
        qty,
        reference: form.reference.trim(),
      },
      ...(entries || []),
    ]);
    setForm({ item: "", type: form.type, qty: "", reference: "" });
    toastSuccess("Movement recorded.");
  };

  const removeEntry = (entry: MovementEntry) => {
    setEntries((entries || []).filter((e) => e.id !== entry.id));
    toastSuccess("Movement removed.");
  };

  const exportCsv = () => {
    const rows = [
      ["Item", "Date", "Type", "Qty", "Reference", "Running Balance"],
      ...visible.map((e) => [
        e.item,
        e.date,
        e.type,
        e.qty,
        e.reference,
        balances.get(e.id) ?? 0,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `item-movement-ledger-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Ledger exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Item Movement Ledger
            </h4>
            <p className="text-xs text-gray-500">
              Per-item chronological movements with running balance. Real stock
              operations (adjustments, transfers, wastage, restocks) appear
              automatically; manual entries can also be recorded.
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={visible.length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div className="form-group !mb-0 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-500">Item</p>
          <input
            value={form.item}
            onChange={(e) => setForm((f) => ({ ...f, item: e.target.value }))}
            list="movement-items"
            placeholder="e.g. Engine Oil 5L"
            className="px-2 py-1 rounded text-xs"
          />
          <datalist id="movement-items">
            {items.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Type</p>
          <select
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({ ...f, type: e.target.value as MovementType }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="purchase">Purchase</option>
            <option value="sale">Sale</option>
            <option value="adjustment">Adjustment</option>
            <option value="transfer">Transfer</option>
            <option value="wastage">Wastage</option>
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Qty</p>
          <input
            type="number"
            min={0}
            value={form.qty}
            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Reference</p>
          <input
            value={form.reference}
            onChange={(e) =>
              setForm((f) => ({ ...f, reference: e.target.value }))
            }
            placeholder="PO/Invoice no."
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addEntry} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Record
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Filter item:</label>
        <select
          value={filterItem}
          onChange={(e) => setFilterItem(e.target.value)}
          className="px-2 py-1 rounded text-xs !min-h-0 h-8"
        >
          <option value="">All items</option>
          {items.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-72 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {visible.length === 0 ? (
          <p className="p-3 text-xs text-gray-500">
            No movements recorded yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Item</th>
                <th className="text-left px-2 py-1.5">Type</th>
                <th className="text-right px-2 py-1.5">Qty</th>
                <th className="text-left px-2 py-1.5">Reference</th>
                <th className="text-right px-2 py-1.5">Balance</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5">
                    {e.date
                      ? new Date(e.date).toLocaleDateString(undefined, {
                          dateStyle: "short",
                        })
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 font-medium">
                    {e.item}
                    {e.source === "auto" && (
                      <span
                        className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 align-middle"
                        title="Recorded automatically from stock operations"
                      >
                        auto
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 capitalize">{e.type}</td>
                  <td className="px-2 py-1.5 text-right">
                    {TYPE_SIGN[e.type] === 1 ? "+" : "−"}
                    {e.qty.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5">{e.reference || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">
                    {(balances.get(e.id) ?? 0).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {e.source !== "auto" && (
                      <button
                        onClick={() => removeEntry(e)}
                        className="text-red-500"
                        aria-label="Remove movement"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
