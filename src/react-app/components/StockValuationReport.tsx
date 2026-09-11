/* StockValuationReport — reverse-engineered Codelab FMS "Closing stock on
 * As per Purchase Rate / Sale Rate": values the current stock of each
 * product at BOTH cost (purchase) rate and selling rate, with the
 * unrealised margin. Reads the live products table (same source as the
 * Products sub-tab) so valuation always reflects real stock — no duplicate
 * data entry. Pure computed view (no cloud writes).
 */
import { Download, Scale } from "lucide-react";
import { useMemo } from "react";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess } from "@/react-app/lib/toast";

interface ProductLike {
  id?: string | number;
  name?: string;
  sku?: string;
  category?: string;
  stock_quantity?: number | null;
  cost_price?: number | null;
  selling_price?: number | null;
}

export default function StockValuationReport({
  products,
}: {
  products: ProductLike[];
}) {
  const currency = getCurrencySymbol();

  const rows = useMemo(
    () =>
      (products || []).map((p) => {
        const qty = Number(p.stock_quantity) || 0;
        const cost = Number(p.cost_price) || 0;
        const sell = Number(p.selling_price) || 0;
        return {
          id: String(p.id ?? p.sku ?? p.name),
          name: p.name || p.sku || "Unnamed",
          category: p.category || "—",
          qty,
          cost,
          sell,
          atCost: qty * cost,
          atSale: qty * sell,
          margin: qty * (sell - cost),
        };
      }),
    [products],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          qty: acc.qty + r.qty,
          atCost: acc.atCost + r.atCost,
          atSale: acc.atSale + r.atSale,
          margin: acc.margin + r.margin,
        }),
        { qty: 0, atCost: 0, atSale: 0, margin: 0 },
      ),
    [rows],
  );

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportCsv = () => {
    const csvRows = [
      [
        "Product",
        "Category",
        "Qty",
        "Cost Rate",
        "Sale Rate",
        "Value @ Cost",
        "Value @ Sale",
        "Unrealised Margin",
      ],
      ...rows.map((r) => [
        r.name,
        r.category,
        r.qty,
        r.cost,
        r.sell,
        r.atCost,
        r.atSale,
        r.margin,
      ]),
      [
        "TOTAL",
        "",
        totals.qty,
        "",
        "",
        totals.atCost,
        totals.atSale,
        totals.margin,
      ],
    ];
    const csv = csvRows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-valuation-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Valuation exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-purple-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Stock Valuation (Purchase vs Sale Rate)
            </h4>
            <p className="text-xs text-gray-500">
              Closing stock valued at cost and selling rates (Codelab dual-rate
              stock report). Computed live from products.
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={rows.length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500">Units on hand</p>
          <p className="text-lg font-bold">{totals.qty.toLocaleString()}</p>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500">Value @ cost</p>
          <p className="text-lg font-bold">{fmt(totals.atCost)}</p>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500">Value @ sale</p>
          <p className="text-lg font-bold">{fmt(totals.atSale)}</p>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500">Unrealised margin</p>
          <p
            className={`text-lg font-bold ${totals.margin >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {fmt(totals.margin)}
          </p>
        </div>
      </div>

      <div className="max-h-80 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-gray-500">No products loaded.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Product</th>
                <th className="text-left px-2 py-1.5">Category</th>
                <th className="text-right px-2 py-1.5">Qty</th>
                <th className="text-right px-2 py-1.5">Cost</th>
                <th className="text-right px-2 py-1.5">Sale</th>
                <th className="text-right px-2 py-1.5">@ Cost</th>
                <th className="text-right px-2 py-1.5">@ Sale</th>
                <th className="text-right px-2 py-1.5">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5 font-medium">{r.name}</td>
                  <td className="px-2 py-1.5">{r.category}</td>
                  <td className="px-2 py-1.5 text-right">
                    {r.qty.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.cost)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.sell)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.atCost)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.atSale)}</td>
                  <td
                    className={`px-2 py-1.5 text-right ${r.margin >= 0 ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {fmt(r.margin)}
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
