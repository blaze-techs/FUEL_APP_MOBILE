/* PunchCardLoyalty — reverse-engineered Veira CRM "Punch Card System" mode:
 * visit-count-based rewards — e.g. "10th visit free" — where each customer
 * visit stamps their card and a full card redeems the reward. Complements
 * the points-based Customer Loyalty tab (which tracks spend points) with a
 * visits-based scheme. Cloud KV `punch_cards` (station-scoped).
 */
import { Gift, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "punch_cards";
const GOAL_KEY = "punch_card_goal";

interface PunchCard {
  id: string;
  customerName: string;
  visits: number;
  reward: string;
}

function id() {
  return `pc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function PunchCardLoyalty() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: cards, setData: setCards } = useCloudKV<PunchCard[]>(
    KEY,
    stationId,
    [],
  );
  const { data: goal, setData: setGoal } = useCloudKV<number>(
    GOAL_KEY,
    stationId,
    10,
  );

  const [form, setForm] = useState({ customerName: "", reward: "" });
  const [goalInput, setGoalInput] = useState("");

  const target = goal ?? 10;

  const addCard = () => {
    const name = form.customerName.trim();
    if (!name) return toastError("Customer name is required.");
    setCards([
      ...(cards || []),
      {
        id: id(),
        customerName: name,
        visits: 0,
        reward: form.reward.trim() || "Free reward",
      },
    ]);
    setForm({ customerName: "", reward: "" });
    toastSuccess(`Punch card created for ${name}.`);
  };

  const stamp = (card: PunchCard) => {
    setCards(
      (cards || []).map((c) =>
        c.id === card.id ? { ...c, visits: c.visits + 1 } : c,
      ),
    );
    toastSuccess(`${card.customerName}: ${card.visits + 1}/${target} stamps.`);
  };

  const redeem = (card: PunchCard) => {
    if (card.visits < target) {
      return toastError(
        `Not full yet — ${target - card.visits} visit(s) left.`,
      );
    }
    setCards(
      (cards || []).map((c) => (c.id === card.id ? { ...c, visits: 0 } : c)),
    );
    toastSuccess(
      `"${card.reward}" redeemed for ${card.customerName}. Card reset.`,
    );
  };

  const remove = (card: PunchCard) => {
    setCards((cards || []).filter((c) => c.id !== card.id));
    toastSuccess("Card removed.");
  };

  const applyGoal = () => {
    const n = parseInt(goalInput, 10);
    if (Number.isFinite(n) && n > 0 && n <= 100) {
      setGoal(n);
      setGoalInput("");
      toastSuccess(`Punch goal set to ${n} visits.`);
    } else {
      toastError("Enter a goal between 1 and 100 visits.");
    }
  };

  const fullCards = useMemo(
    () => (cards || []).filter((c) => c.visits >= target),
    [cards, target],
  );

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <Gift className="w-5 h-5 text-pink-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Punch Cards (Visits-based Loyalty)
          </h4>
          <p className="text-xs text-gray-500">
            Veira punch-card mode: {fullCards.length} card(s) ready to redeem of{" "}
            {(cards || []).length}.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">Goal:</span>
        <input
          type="number"
          min={1}
          max={100}
          value={goalInput}
          onChange={(e) => setGoalInput(e.target.value)}
          placeholder={`${target} visits`}
          className="w-20 px-2 py-1 rounded text-xs"
        />
        <button
          onClick={applyGoal}
          className="btn btn-secondary !p-1.5 !text-xs"
        >
          Set
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Customer</p>
          <input
            value={form.customerName}
            onChange={(e) =>
              setForm((f) => ({ ...f, customerName: e.target.value }))
            }
            placeholder="Customer name"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Reward</p>
          <input
            value={form.reward}
            onChange={(e) => setForm((f) => ({ ...f, reward: e.target.value }))}
            placeholder="e.g. Free 5L fuel"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addCard} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> New Card
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {(cards || []).map((card) => {
          const full = card.visits >= target;
          const pct = Math.min(100, (card.visits / target) * 100);
          return (
            <div
              key={card.id}
              className={`rounded border p-3 space-y-2 ${full ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/20" : "border-gray-200 dark:border-gray-700"}`}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm">{card.customerName}</p>
                <button
                  onClick={() => remove(card)}
                  className="text-red-500"
                  aria-label="Remove card"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <p className="text-xs text-gray-500">{card.reward}</p>
              <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                <div
                  className={`h-full ${full ? "bg-emerald-500" : "bg-pink-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>
                  {card.visits}/{target} visits
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => stamp(card)}
                    className="btn btn-secondary !p-1 !text-xs"
                    disabled={full}
                  >
                    Stamp
                  </button>
                  <button
                    onClick={() => redeem(card)}
                    className="btn btn-primary !p-1 !text-xs"
                    disabled={!full}
                  >
                    Redeem
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {(cards || []).length === 0 && (
          <p className="text-xs text-gray-500 col-span-full">
            No punch cards yet — create one per frequent customer.
          </p>
        )}
      </div>
    </div>
  );
}
