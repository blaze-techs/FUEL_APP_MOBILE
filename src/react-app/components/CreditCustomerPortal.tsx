/* CreditCustomerPortal — reverse-engineered Codelab FMS "personalised
 * portal for Credit Customer": a shareable read-only snapshot the station
 * owner can copy and send to a credit customer — their current balance,
 * limit, recent activity, and payment instructions. Unlike the internal
 * Credit Accounts view, this formats a customer-facing card + copies a
 * ready-to-send WhatsApp/SMS text. Uses live credit account data.
 */
import { Copy, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess } from "@/react-app/lib/toast";

interface CreditAccountLike {
  id: string;
  customerName?: string;
  name?: string;
  balance?: number;
  creditLimit?: number;
  phone?: string;
  email?: string;
}

interface CreditTransactionLike {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  description?: string;
  date?: string;
  createdAt?: string;
}

function formatMoney(currency: string, n: number): string {
  return `${currency}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function CreditCustomerPortal() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: accounts } = useCloudKV<CreditAccountLike[]>(
    "credit_accounts",
    stationId,
    [],
  );
  const { data: transactions } = useCloudKV<CreditTransactionLike[]>(
    "credit_transactions",
    stationId,
    [],
  );

  const [accountId, setAccountId] = useState("");

  const account = (accounts || []).find((a) => a.id === accountId);
  const accountName = account
    ? account.customerName || account.name || "Customer"
    : "";

  const recent = useMemo(() => {
    if (!account) return [];
    return (transactions || [])
      .filter((t) => t.accountId === account.id)
      .sort((a, b) =>
        (b.date || b.createdAt || "").localeCompare(
          a.date || a.createdAt || "",
        ),
      )
      .slice(0, 5);
  }, [account, transactions]);

  const balance = account?.balance ?? 0;
  const limit = account?.creditLimit ?? 0;
  const available = Math.max(0, limit - balance);
  const stationName = currentStation?.name || "Your fuel station";

  const portalText = useMemo(() => {
    if (!account) return "";
    const lines = [
      `${stationName} — Credit Account Statement`,
      `Customer: ${accountName}`,
      `Balance: ${formatMoney(currency, balance)} of ${formatMoney(currency, limit)} limit`,
      `Available credit: ${formatMoney(currency, available)}`,
      ``,
      `Recent activity:`,
      ...recent.map(
        (t) =>
          `- ${t.date || t.createdAt}: ${t.type} ${formatMoney(currency, t.amount)}${t.description ? ` (${t.description})` : ""}`,
      ),
      ``,
      `Please settle your balance at the station or via the agreed payment channel.`,
    ];
    return lines.join("\n");
  }, [
    account,
    accountName,
    balance,
    limit,
    available,
    recent,
    stationName,
    currency,
  ]);

  const copyPortal = async () => {
    if (!portalText) return;
    try {
      await navigator.clipboard.writeText(portalText);
      toastSuccess("Portal snapshot copied — paste into WhatsApp/SMS/email.");
    } catch {
      toastSuccess("Select and copy the snapshot text manually.");
    }
  };

  const shareWhatsApp = () => {
    if (!portalText) return;
    const phone = (account?.phone || "").replace(/\D/g, "");
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(portalText)}`
      : `https://wa.me/?text=${encodeURIComponent(portalText)}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <Share2 className="w-5 h-5 text-sky-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Credit Customer Portal
          </h4>
          <p className="text-xs text-gray-500">
            Customer-facing account snapshot to share (Codelab personalised
            credit-customer portal).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Customer account</p>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="">Select account…</option>
            {(accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.customerName || a.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={copyPortal}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={!account}
        >
          <Copy className="w-3 h-3" /> Copy Snapshot
        </button>
        <button
          onClick={shareWhatsApp}
          className="btn btn-primary !p-2 !text-xs"
          disabled={!account}
        >
          <Share2 className="w-3 h-3" /> WhatsApp
        </button>
      </div>

      {account && (
        <div className="rounded border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/20 p-4 space-y-2">
          <p className="font-semibold text-sm">
            {stationName} — Credit Account
          </p>
          <p className="text-sm">{accountName}</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-gray-500">Balance</p>
              <p className="font-bold text-red-600">
                {formatMoney(currency, balance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Limit</p>
              <p className="font-bold">{formatMoney(currency, limit)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Available</p>
              <p className="font-bold text-emerald-600">
                {formatMoney(currency, available)}
              </p>
            </div>
          </div>
          {recent.length > 0 && (
            <div className="text-xs space-y-0.5">
              <p className="font-semibold">Recent activity</p>
              {recent.map((t) => (
                <p key={t.id}>
                  {t.date || t.createdAt} — {t.type}{" "}
                  {formatMoney(currency, t.amount)}
                  {t.description ? ` (${t.description})` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
