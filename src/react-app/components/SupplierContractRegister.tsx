/* SupplierContractRegister — Supplier Management "contracts" view: records
 * standing supply agreements (product, agreed price, start, expiry) so the
 * purchase team never buys blind and can see which deals need renewal.
 * Cloud KV `supplier_contracts`.
 */
import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface Contract {
  id: string;
  supplier: string;
  product: string;
  price: number;
  start: string;
  expiry: string;
}

export default function SupplierContractRegister() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: contracts, setData: setContracts } = useCloudKV<Contract[]>(
    "supplier_contracts",
    stationId,
    [],
  );
  const [supplier, setSupplier] = useState("");
  const [product, setProduct] = useState("");
  const [price, setPrice] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [expiry, setExpiry] = useState("");

  const addContract = () => {
    const p = Number(price);
    if (!supplier.trim() || !product.trim() || !p || p <= 0) return;
    setContracts((prev) => [
      ...(prev || []),
      {
        id: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        supplier: supplier.trim(),
        product: product.trim(),
        price: p,
        start,
        expiry,
      },
    ]);
    setSupplier("");
    setProduct("");
    setPrice("");
  };

  const expiring = (contracts || []).filter((c) => {
    if (!c.expiry) return false;
    return new Date(c.expiry).getTime() < Date.now() + 30 * 86400000;
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <FileText size={16} /> Supplier Contracts
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Standing supply agreements; renew as they age out.
        {expiring.length > 0 && ` ${expiring.length} expiring within 30 days.`}
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Supplier"
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="Product"
          className="flex-1 min-w-[160px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          placeholder={`Agreed price (${currency})`}
          className="w-40 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={start}
          onChange={(e) => setStart(e.target.value)}
          type="date"
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          type="date"
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addContract}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {(contracts || []).length === 0 ? (
        <p className="text-sm text-gray-500">No supplier contracts recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700">
              <th className="py-2">Supplier</th>
              <th>Product</th>
              <th className="text-right">Price</th>
              <th className="text-right">Start</th>
              <th className="text-right">Expires</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {(contracts || []).map((c) => {
              const exp =
                c.expiry &&
                new Date(c.expiry).getTime() < Date.now() + 30 * 86400000;
              return (
                <tr
                  key={c.id}
                  className="border-b border-gray-100 dark:border-gray-700/60"
                >
                  <td className="py-1.5 font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                    {c.supplier}
                  </td>
                  <td>{c.product}</td>
                  <td className="text-right">
                    {currency}
                    {c.price.toLocaleString()}
                  </td>
                  <td className="text-right">{c.start}</td>
                  <td className="text-right">{c.expiry}</td>
                  <td className="text-right">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${exp ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
                    >
                      {exp ? "Renew soon" : "Active"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
