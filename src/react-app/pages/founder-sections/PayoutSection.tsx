import { useState } from "react";
import {
  CreditCard,
  Download,
  FileText,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowUpDown,
  Search,
  Filter,
} from "lucide-react";
import {
  getDetectedCurrency,
  getCurrencySymbol,
} from "@/react-app/lib/currency";
const CUR = () => getCurrencySymbol(getDetectedCurrency());
import {
  loadPayments,
  savePayments,
  type PaymentRecord,
} from "@/react-app/lib/subscription";

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function PayoutSection({ logAudit }: Props) {
  const [payments, setPayments] = useState<PaymentRecord[]>(loadPayments);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGateway, setFilterGateway] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const gateways = [...new Set(payments.map((p) => p.gateway))];

  const filtered = payments.filter((p) => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (filterGateway !== "all" && p.gateway !== filterGateway) return false;
    if (
      searchTerm &&
      !p.transactionRef.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !p.gateway.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

  const totalRevenue = filtered
    .filter((p) => p.status === "success")
    .reduce((s, p) => s + p.amount, 0);
  const totalPending = filtered
    .filter((p) => p.status === "pending")
    .reduce((s, p) => s + p.amount, 0);
  const totalFailed = filtered.filter((p) => p.status === "failed").length;
  const totalRefunded = filtered
    .filter((p) => p.status === "refunded")
    .reduce((s, p) => s + p.amount, 0);

  const exportCSV = () => {
    const headers = [
      "ID",
      "Gateway",
      "Amount",
      "Currency",
      "Status",
      "Transaction Ref",
      "Idempotency Key",
      "Date",
    ];
    const rows = filtered.map((p) => [
      p.id,
      p.gateway,
      p.amount,
      p.currency,
      p.status,
      p.transactionRef,
      p.idempotencyKey,
      p.createdAt,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro_payments_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit(
      "Payments Exported",
      `Exported ${filtered.length} payments as CSV`,
      "success",
    );
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro_payments_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit(
      "Payments Exported",
      `Exported ${filtered.length} payments as JSON`,
      "success",
    );
  };

  const refundPayment = (id: string) => {
    if (!confirm("Mark this payment as refunded?")) return;
    setPayments((prev) => {
      const updated = prev.map((p) =>
        p.id === id ? { ...p, status: "refunded" as const } : p,
      );
      savePayments(updated);
      return updated;
    });
    logAudit("Payment Refunded", `Payment ${id} marked as refunded`, "warning");
  };

  const retryPayment = (id: string) => {
    setPayments((prev) => {
      const updated = prev.map((p) =>
        p.id === id ? { ...p, status: "pending" as const } : p,
      );
      savePayments(updated);
      return updated;
    });
    setTimeout(() => {
      setPayments((prev) => {
        const updated = prev.map((p) =>
          p.id === id ? { ...p, status: "success" as const } : p,
        );
        savePayments(updated);
        return updated;
      });
      logAudit(
        "Payment Retried",
        `Payment ${id} retried and succeeded`,
        "success",
      );
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <CreditCard size={18} className="text-blue-400" /> Payments &
            Reconciliation
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            View, refund, and export all transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors flex items-center gap-1"
          >
            <Download size={12} /> CSV
          </button>
          <button
            onClick={exportJSON}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors flex items-center gap-1"
          >
            <FileText size={12} /> JSON
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Revenue",
            value: `${CUR()} ${totalRevenue.toLocaleString()}`,
            icon: CheckCircle2,
            color: "text-emerald-400",
          },
          {
            label: "Pending",
            value: `${CUR()} ${totalPending.toLocaleString()}`,
            icon: RefreshCw,
            color: "text-amber-400",
          },
          {
            label: "Failed",
            value: totalFailed.toString(),
            icon: XCircle,
            color: "text-red-400",
          },
          {
            label: "Refunded",
            value: `${CUR()} ${totalRefunded.toLocaleString()}`,
            icon: ArrowUpDown,
            color: "text-gray-400",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-gray-500">{s.label}</span>
              <s.icon size={14} className={s.color} />
            </div>
            <p className="text-lg font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search transactions..."
            className="w-full pl-8 pr-3 py-2 bg-[#161618] border border-white/[0.06] rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-[#161618] border border-white/[0.06] rounded-lg text-xs text-white focus:outline-none focus:border-blue-500/30"
        >
          <option value="all">All Status</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
        <select
          value={filterGateway}
          onChange={(e) => setFilterGateway(e.target.value)}
          className="px-3 py-2 bg-[#161618] border border-white/[0.06] rounded-lg text-xs text-white focus:outline-none focus:border-blue-500/30"
        >
          <option value="all">All Gateways</option>
          {gateways.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{filtered.length} results</span>
      </div>

      {/* Table */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {["Status", "Gateway", "Amount", "Ref", "Date", ""].map((h) => (
                <th
                  key={h}
                  className="text-left text-[10px] text-gray-500 font-medium px-4 py-2.5"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((p) => (
              <tr
                key={p.id}
                className="border-b border-white/[0.04] hover:bg-white/[0.02]"
              >
                <td className="px-4 py-2.5">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${p.status === "success" ? "bg-emerald-500/10 text-emerald-400" : p.status === "failed" ? "bg-red-500/10 text-red-400" : p.status === "refunded" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-300 capitalize">
                  {p.gateway}
                </td>
                <td className="px-4 py-2.5 text-xs text-white">
                  {p.currency} {p.amount.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-[10px] text-gray-500 font-mono">
                  {p.transactionRef.slice(0, 20)}...
                </td>
                <td className="px-4 py-2.5 text-[10px] text-gray-500">
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    {p.status === "success" && (
                      <button
                        onClick={() => refundPayment(p.id)}
                        className="px-2 py-1 text-[10px] bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20"
                      >
                        Refund
                      </button>
                    )}
                    {p.status === "failed" && (
                      <button
                        onClick={() => retryPayment(p.id)}
                        className="px-2 py-1 text-[10px] bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-center text-gray-600 py-8 text-xs"
                >
                  No payments found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
