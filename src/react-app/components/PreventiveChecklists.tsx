/* PreventiveChecklists — Maratech/planned-maintenance style: defines PM
 * checklist templates (task + frequency) and ticks items done this
 * day/week/month. Cloud KV `pm_checklists` so the plan syncs cross-device.
 */
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface PmTask {
  id: string;
  task: string;
  frequency: "daily" | "weekly" | "monthly";
  done: boolean;
}

export default function PreventiveChecklists() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: tasks, setData: setTasks } = useCloudKV<PmTask[]>(
    "pm_checklists",
    stationId,
    [],
  );
  const [task, setTask] = useState("");
  const [frequency, setFrequency] = useState<PmTask["frequency"]>("daily");

  const addTask = () => {
    if (!task.trim()) return;
    setTasks((prev) => [
      ...(prev || []),
      {
        id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        task: task.trim(),
        frequency,
        done: false,
      },
    ]);
    setTask("");
  };

  const toggleDone = (id: string) =>
    setTasks((prev) =>
      (prev || []).map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );

  const removeTask = (id: string) =>
    setTasks((prev) => (prev || []).filter((t) => t.id !== id));

  const grouped = (["daily", "weekly", "monthly"] as const).map((f) => ({
    frequency: f,
    items: (tasks || []).filter((t) => t.frequency === f),
  }));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <ListChecks size={16} /> Preventive Maintenance Checklists
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Planned-maintenance templates — tick items as they are done.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Task (e.g. Check pump filters)"
          className="flex-1 min-w-[200px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as PmTask["frequency"])}
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <button
          onClick={addTask}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {(tasks || []).length === 0 ? (
        <p className="text-sm text-gray-500">
          No checklist templates — add the daily/weekly/monthly tasks the crew
          should complete.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) =>
            g.items.length === 0 ? null : (
              <div key={g.frequency}>
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-1.5">
                  {g.frequency}
                </h4>
                <div className="space-y-1">
                  {g.items.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded border border-gray-200 dark:border-gray-600 px-2.5 py-1.5"
                    >
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={() => toggleDone(t.id)}
                      />
                      <span
                        className={`flex-1 text-sm ${t.done ? "line-through text-gray-400" : "text-gray-900 dark:text-gray-900 dark:text-white"}`}
                      >
                        {t.task}
                      </span>
                      <button
                        onClick={() => removeTask(t.id)}
                        className="text-red-400 hover:text-red-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
