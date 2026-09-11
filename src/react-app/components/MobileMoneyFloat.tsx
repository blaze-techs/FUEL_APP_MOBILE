/* MobileMoneyFloat — reverse-engineered Veira POS "Mobile Money Agent":
 * track the till float held by each mobile-money agent (M-Pesa, Airtel Money,
 * T-Kash), counting float top-ups, withdrawals paid out, and the resulting
 * float balance per agent. Sits in Live Transaction alongside payment
 * sources — float drives transaction success-rate where cash-out queues
 * fail. Cloud KV `mobile_money_agents`.
 */
import { Plus, Smartphone, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "mobile_money_agents";

interface AgentEntry {
  id: string;
  date: string;
  kind: "topup" | "payout";
  amount: number;
  note: string;
}

interface Agent {
  id: string;
  name: string;
  network: string;
  entries: AgentEntry[];
}

function id() {
  return `mm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function MobileMoneyFloat() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: agents, setData: setAgents } = useCloudKV<Agent[]>(
    KEY,
    stationId,
    [],
  );

  const [agentForm, setAgentForm] = useState({ name: "", network: "M-Pesa" });
  const [entryForm, setEntryForm] = useState({
    agentId: "",
    kind: "topup" as "topup" | "payout",
    amount: "",
    note: "",
  });

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of agents || []) {
      let bal = 0;
      for (const e of a.entries) {
        bal += e.kind === "topup" ? e.amount : -e.amount;
      }
      map.set(a.id, bal);
    }
    return map;
  }, [agents]);

  const lowFloatThreshold = 5000;
  const lowFloat = useMemo(
    () =>
      (agents || [])
        .filter((a) => (balances.get(a.id) ?? 0) < lowFloatThreshold)
        .map((a) => a.name),
    [agents, balances],
  );

  const addAgent = () => {
    const name = agentForm.name.trim();
    if (!name) return toastError("Agent name/number is required.");
    setAgents([
      ...(agents || []),
      { id: id(), name, network: agentForm.network, entries: [] },
    ]);
    setAgentForm({ name: "", network: agentForm.network });
    toastSuccess(`Agent "${name}" registered.`);
  };

  const addEntry = () => {
    const amount = parseFloat(entryForm.amount);
    const agent = (agents || []).find((a) => a.id === entryForm.agentId);
    if (!agent) return toastError("Choose an agent.");
    if (!Number.isFinite(amount) || amount <= 0)
      return toastError("Amount must be greater than 0.");
    setAgents(
      (agents || []).map((a) =>
        a.id === entryForm.agentId
          ? {
              ...a,
              entries: [
                {
                  id: id(),
                  date: new Date().toISOString().split("T")[0],
                  kind: entryForm.kind,
                  amount,
                  note: entryForm.note.trim(),
                },
                ...a.entries,
              ],
            }
          : a,
      ),
    );
    setEntryForm({ agentId: "", kind: "topup", amount: "", note: "" });
    toastSuccess("Float entry recorded.");
  };

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-emerald-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Mobile Money Agent Float
          </h4>
          <p className="text-xs text-gray-500">
            Veira mobile-money agent float — top-ups vs payouts per agent till.{" "}
            {lowFloat.length > 0 && (
              <span className="text-amber-600 font-semibold">
                Low float: {lowFloat.join(", ")}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Agent</p>
          <input
            value={agentForm.name}
            onChange={(e) =>
              setAgentForm((f) => ({ ...f, name: e.target.value }))
            }
            placeholder="Till name / number"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Network</p>
          <select
            value={agentForm.network}
            onChange={(e) =>
              setAgentForm((f) => ({ ...f, network: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option>M-Pesa</option>
            <option>Airtel Money</option>
            <option>T-Kash</option>
            <option>Other</option>
          </select>
        </div>
        <button onClick={addAgent} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Add Agent
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Record float</p>
          <select
            value={entryForm.agentId}
            onChange={(e) =>
              setEntryForm((f) => ({ ...f, agentId: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="">Select agent…</option>
            {(agents || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.network})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Kind</p>
          <select
            value={entryForm.kind}
            onChange={(e) =>
              setEntryForm((f) => ({
                ...f,
                kind: e.target.value as "topup" | "payout",
              }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="topup">Top-up</option>
            <option value="payout">Payout</option>
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Amount</p>
          <input
            type="number"
            min={0}
            value={entryForm.amount}
            onChange={(e) =>
              setEntryForm((f) => ({ ...f, amount: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Note</p>
          <input
            value={entryForm.note}
            onChange={(e) =>
              setEntryForm((f) => ({ ...f, note: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addEntry} className="btn btn-secondary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Record
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {(agents || []).map((a) => {
          const bal = balances.get(a.id) ?? 0;
          return (
            <div
              key={a.id}
              className={`rounded border p-3 space-y-1 ${
                bal < lowFloatThreshold
                  ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-900/10"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm flex items-center gap-1">
                  <Smartphone className="w-3 h-3" /> {a.name}
                </p>
                <button
                  onClick={() =>
                    setAgents((agents || []).filter((x) => x.id !== a.id))
                  }
                  className="text-red-500"
                  aria-label="Delete agent"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <p className="text-xs text-gray-500">
                {a.network} · float balance
              </p>
              <p className="text-lg font-bold">{fmt(bal)}</p>
              <div className="max-h-24 overflow-auto text-xs space-y-0.5">
                {a.entries.slice(0, 8).map((e) => (
                  <p key={e.id}>
                    {e.date} — {e.kind === "topup" ? "+" : "−"}
                    {fmt(e.amount)} {e.note ? `(${e.note})` : ""}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
        {(agents || []).length === 0 && (
          <p className="text-xs text-gray-500 col-span-full">
            No agents yet — register your mobile-money tills.
          </p>
        )}
      </div>
    </div>
  );
}
