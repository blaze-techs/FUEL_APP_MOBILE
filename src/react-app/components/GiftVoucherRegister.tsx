/* GiftVoucherRegister — gift card/voucher inventory (Pesapal retail-style):
 * issues vouchers (code/denomination/expires) and tracks redemption. Cloud
 * KV `gift_vouchers` so cashier + office see the same register.
 */
import { Gift, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

interface Voucher {
  id: string;
  code: string;
  amount: number;
  buyer: string;
  redeemed: boolean;
}

export default function GiftVoucherRegister() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: vouchers, setData: setVouchers } = useCloudKV<Voucher[]>(
    "gift_vouchers",
    stationId,
    [],
  );
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [buyer, setBuyer] = useState("");

  const issue = () => {
    const a = Number(amount);
    if (!code.trim() || !a || a <= 0) return;
    const voucher: Voucher = {
      id: `gv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      code: code.trim().toUpperCase(),
      amount: a,
      buyer: buyer.trim(),
      redeemed: false,
    };
    setVouchers((prev) => [...(prev || []), voucher]);
    emitFeatureEvent({
      type: "voucher.issued",
      payload: {
        code: voucher.code,
        amount: voucher.amount,
        buyer: voucher.buyer || undefined,
      },
    });
    setCode("");
    setAmount("");
    setBuyer("");
  };

  const toggleRedeem = (id: string) => {
    const found = (vouchers || []).find((v) => v.id === id);
    setVouchers((prev) =>
      (prev || []).map((v) =>
        v.id === id ? { ...v, redeemed: !v.redeemed } : v,
      ),
    );
    if (found) {
      emitFeatureEvent({
        type: !found.redeemed ? "voucher.redeemed" : "voucher.issued",
        payload: {
          code: found.code,
          amount: found.amount,
          buyer: found.buyer || undefined,
        },
      });
    }
  };

  const outstanding = useMemo(
    () =>
      (vouchers || [])
        .filter((v) => !v.redeemed)
        .reduce((s, v) => s + v.amount, 0),
    [vouchers],
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Gift size={16} /> Gift Vouchers
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {outstanding
          ? `${currency}${outstanding.toLocaleString()} outstanding`
          : "No outstanding vouchers"}
        .
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Voucher code"
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          placeholder={`Amount (${currency})`}
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={buyer}
          onChange={(e) => setBuyer(e.target.value)}
          placeholder="Buyer (optional)"
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={issue}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Issue
        </button>
      </div>
      <div className="space-y-1.5">
        {(vouchers || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No vouchers issued.</p>
        ) : (
          [...(vouchers || [])]
            .reverse()
            .slice(0, 30)
            .map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                    {v.code} • {currency}
                    {v.amount.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {v.buyer || "Unknown buyer"}
                  </p>
                </div>
                <button
                  onClick={() => toggleRedeem(v.id)}
                  className={`rounded px-2 py-1 text-xs font-medium ${v.redeemed ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
                >
                  {v.redeemed ? "Redeemed" : "Redeem"}
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
