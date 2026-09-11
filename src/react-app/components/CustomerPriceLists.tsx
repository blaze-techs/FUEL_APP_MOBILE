/* CustomerPriceLists — B2B/contract pricing per customer (Pesapal/Shell
 * contract-pricing style): stores per-customer, per-fuel price overrides in
 * a station-scoped cloud KV. POS/Invoice can consult this list for the
 * standing price a fleet/customer agreed to.
 */
import { Tag, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface PriceRule {
  id: string;
  customer: string;
  fuelType: string;
  price: number;
}

export default function CustomerPriceLists() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: rules, setData: setRules } = useCloudKV<PriceRule[]>(
    "customer_price_lists",
    stationId,
    [],
  );
  const [customer, setCustomer] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [price, setPrice] = useState("");

  const addRule = () => {
    const p = Number(price);
    if (!customer.trim() || !fuelType.trim() || !p || p <= 0) return;
    setRules((prev) => [
      ...(prev || []),
      {
        id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        customer: customer.trim(),
        fuelType: fuelType.trim(),
        price: p,
      },
    ]);
    setCustomer("");
    setFuelType("");
    setPrice("");
  };

  const removeRule = (id: string) =>
    setRules((prev) => (prev || []).filter((r) => r.id !== id));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Tag size={16} /> Customer Price Lists
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Contract pricing per customer per fuel. {rules?.length || 0} active
        rules.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="Customer"
          className="w-40 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={fuelType}
          onChange={(e) => setFuelType(e.target.value)}
          placeholder="Fuel type"
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          placeholder={`Price (${currency})`}
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addRule}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Add rule
        </button>
      </div>
      {(rules || []).length === 0 ? (
        <p className="text-sm text-gray-500">
          No contract prices — add a rule to give a customer a standing fuel
          price.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700">
              <th className="py-2">Customer</th>
              <th>Fuel</th>
              <th className="text-right">Contract price</th>
              <th className="text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {(rules || []).map((r) => (
              <tr
                key={r.id}
                className="border-b border-gray-100 dark:border-gray-700/60"
              >
                <td className="py-1.5 font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {r.customer}
                </td>
                <td>{r.fuelType}</td>
                <td className="text-right font-medium">
                  {currency}
                  {r.price.toLocaleString()}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => removeRule(r.id)}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
