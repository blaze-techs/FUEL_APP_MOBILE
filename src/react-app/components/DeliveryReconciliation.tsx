/**
 * DeliveryReconciliation.tsx — reconcile deliveries (Supplier purchase
 * orders in cloud key purchase_orders / app state supplierData purchase
 * orders) against received offloading records in FuelContext state. Shows
 * ordered vs received variance → shortage claims (Advatech / Codelab).
 * Lives inside Fuel Offloading tab as the "Delivery Audit" view.
 */
import { useMemo } from "react";
import {
  Scale,
  TriangleAlert,
  CheckCircle2,
  Download,
  PackageCheck,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { downloadCsv } from "@/react-app/lib/forecourt-features";
import { normalizeFuelType } from "@/react-app/config/pricing";

// Shape mirrors SupplierManagement.tsx `PurchaseOrder`.
type PO = {
  id?: string;
  supplierId?: string;
  supplierName?: string;
  fuelType?: string;
  liters?: number;
  pricePerLiter?: number;
  total?: number;
  status?: "pending" | "confirmed" | "delivered" | "cancelled";
  orderDate?: string;
  expectedDate?: string;
  actualDate?: string;
};

type Variance = {
  po: PO;
  delivered: number;
  variance: number;
  variancePct: number;
  shortage?: number;
};

export default function DeliveryReconciliation() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  const fuelTypeApi = useStationFuelTypes();

  const { data: orders } = useCloudKV<PO[]>("purchase_orders", stationId, []);

  const rows = useMemo(() => {
    const recs = state.offloadingRecords ?? [];
    const vars: Variance[] = orders
      .filter((po: PO) => po.status !== "cancelled")
      .map((po: PO) => {
        const poCanonical = normalizeFuelType(po.fuelType ?? "");
        const delivered = recs
          .filter((r: any) => {
            const sup = po.supplierName
              ? (r.supplier || "")
                  .toLowerCase()
                  .includes(po.supplierName.toLowerCase())
              : true;
            if (!sup) return false;
            const fu: string = r.fuelType ?? "";
            if (poCanonical) {
              const rc = normalizeFuelType(fu);
              if (rc && rc !== poCanonical) return false;
            }
            return true;
          })
          .reduce((s: number, r: any) => s + (r.quantity ?? 0), 0);
        const ordered = po.liters ?? 0;
        const variance = delivered - ordered;
        const variancePct = ordered > 0 ? (variance / ordered) * 100 : 0;
        const price =
          (po.pricePerLiter ?? 0) > 0
            ? (po.pricePerLiter as number)
            : (fuelTypeApi.getPriceFor(po.fuelType) ?? 0);
        const shortage = variance < 0 ? Math.abs(variance) * price : 0;
        return { po, delivered, variance, variancePct, shortage };
      });
    return vars;
  }, [orders, state.offloadingRecords, fuelTypeApi]);

  const totals = rows.reduce(
    (t, r) => ({
      ordered: t.ordered + (r.po.liters ?? 0),
      delivered: t.delivered + r.delivered,
      shortage: t.shortage + (r.shortage ?? 0),
      n: t.n + 1,
    }),
    { ordered: 0, delivered: 0, shortage: 0, n: 0 },
  );

  const exportRows = () =>
    downloadCsv("delivery-reconciliation.csv", [
      [
        "purchase order id",
        "supplier",
        "fuel",
        "ordered (L)",
        "received (L)",
        "variance (L)",
        "variance %",
        "shortage value",
      ],
      ...rows.map((r) => [
        r.po.id ?? "",
        r.po.supplierName ?? "",
        r.po.fuelType ?? "all",
        r.po.liters ?? 0,
        r.delivered,
        r.variance.toFixed(2),
        r.variancePct.toFixed(2),
        (r.shortage ?? 0).toFixed(2),
      ]),
    ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-500" /> Delivered vs ordered
          (shortage claims)
        </h3>
        <button
          onClick={exportRows}
          disabled={rows.length === 0}
          className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-40"
        >
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <PackageCheck className="w-4 h-4 text-gray-400" /> No purchase orders
          to reconcile yet (add them in Suppliers → Purchase Orders). Every
          received delivery in Fuel Offloading is then matched by supplier +
          fuel type.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
              <p className="text-xl font-bold">
                {formatNumber(totals.ordered, 0)}
              </p>
              <p className="text-[10px] text-gray-500">Ordered L</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
              <p className="text-xl font-bold text-blue-600">
                {formatNumber(totals.delivered, 0)}
              </p>
              <p className="text-[10px] text-gray-500">Received L</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
              <p className="text-xl font-bold text-red-500">
                {totals.shortage > 0
                  ? `${currencySymbol}${formatNumber(totals.shortage)}`
                  : "—"}
              </p>
              <p className="text-[10px] text-gray-500">Shortage claim value</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
              <p className="text-xl font-bold">{totals.n}</p>
              <p className="text-[10px] text-gray-500">PO lines</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 px-3">PO</th>
                  <th className="py-2 px-3">Supplier</th>
                  <th className="py-2 px-3">Fuel</th>
                  <th className="py-2 px-3 text-right">Ordered</th>
                  <th className="py-2 px-3 text-right">Received</th>
                  <th className="py-2 px-3 text-right">Variance</th>
                  <th className="py-2 px-3 text-right">Shortage value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={(r.po.id ?? i) as string}
                    className="border-b border-gray-100 dark:border-gray-700/60"
                  >
                    <td className="py-2 px-3 font-medium text-gray-800 dark:text-gray-200">
                      {r.po.id ?? ""}
                    </td>
                    <td className="py-2 px-3">{r.po.supplierName ?? "—"}</td>
                    <td className="py-2 px-3">{r.po.fuelType ?? "all"}</td>
                    <td className="py-2 px-3 text-right">
                      {formatNumber(r.po.liters ?? 0, 0)} L
                    </td>
                    <td className="py-2 px-3 text-right">
                      {formatNumber(r.delivered, 0)} L
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-semibold ${
                        r.variance < 0 ? "text-red-500" : "text-green-600"
                      }`}
                    >
                      {r.variance >= 0 ? "+" : ""}
                      {formatNumber(r.variance)} L ({r.variancePct.toFixed(1)}%)
                    </td>
                    <td className="py-2 px-3 text-right">
                      {r.shortage != null && r.shortage > 0 ? (
                        <span className="text-red-500 font-semibold">
                          {currencySymbol}
                          {formatNumber(r.shortage)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totals.shortage > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              <TriangleAlert className="w-3.5 h-3.5" /> Total shortage claim
              value {currencySymbol}
              {formatNumber(totals.shortage)} — claim from supplier.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> All deliveries matched —
              no shortage variance on record.
            </p>
          )}
        </>
      )}
    </div>
  );
}
