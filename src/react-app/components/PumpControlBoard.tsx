/* PumpControlBoard — per-nozzle authorize/start/stop/lock control.
 * Reverse-engineered from telematicsafrica service-station management
 * (pump control + POS) and Pesapal/Codelab authorization: a live status
 * board over the station's configured nozzles (from FuelContext pumps).
 * Cloud KV `pump_control`.
 */
import { useMemo, useState } from "react";
import { Fuel, Lock, Play, PowerOff, Unlock } from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getFuelCode } from "@/react-app/config/pricing";
import { toastSuccess } from "@/react-app/lib/toast";

type NozzleStatus = "idle" | "authorized" | "locked";

interface ControlMap {
  [nozzleName: string]: NozzleStatus;
}

const KEY = "pump_control";

export default function PumpControlBoard() {
  const { currentStation } = useStations();
  const { state } = useFuel();
  const { data: map, setData: setMap } = useCloudKV<ControlMap>(
    KEY,
    currentStation?.id,
    {},
  );
  const [allLocked, setAllLocked] = useState(false);

  const nozzles = useMemo(() => {
    const out: { name: string; label: string }[] = [];
    (state.pmsPumps || []).forEach((p, i) =>
      out.push({ name: `${(p as any).name || "PMS"}-${i + 1}`, label: "PMS" }),
    );
    (state.agoPumps || []).forEach((p, i) =>
      out.push({ name: `${(p as any).name || "AGO"}-${i + 1}`, label: "AGO" }),
    );
    for (const [type, arr] of Object.entries(state.fuelPumpsByType || {})) {
      (arr as any[]).forEach((p, i) =>
        out.push({ name: `${p?.name || type}-${i + 1}`, label: type }),
      );
    }
    const seen = new Set<string>();
    return out.filter((n) =>
      seen.has(n.name) ? false : (seen.add(n.name), true),
    );
  }, [state.pmsPumps, state.agoPumps, state.fuelPumpsByType]);

  const statusOf = (name: string): NozzleStatus => map[name] || "idle";

  const setStatus = (name: string, s: NozzleStatus) => {
    setMap((m) => ({ ...m, [name]: s }));
  };

  const toggleLockAll = (lock: boolean) => {
    setAllLocked(lock);
    setMap((m) => {
      const next = { ...m } as ControlMap;
      for (const n of nozzles) next[n.name] = lock ? "locked" : "idle";
      return next;
    });
    toastSuccess(lock ? "All nozzles locked." : "All nozzles unlocked.");
  };

  return (
    <div className="card space-y-3 rounded border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fuel className="w-5 h-5 text-amber-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Pump Control Board
            </h4>
            <p className="text-xs text-gray-500">
              Nozzle authorize / lock control over the station's configured
              pumps (telematicafrica service-station vector).
            </p>
          </div>
        </div>
        <button
          onClick={() => toggleLockAll(!allLocked)}
          className="btn btn-secondary"
        >
          {allLocked ? (
            <Unlock className="w-4 h-4" />
          ) : (
            <Lock className="w-4 h-4" />
          )}{" "}
          {allLocked ? "Unlock all" : "Lock all"}
        </button>
      </div>
      {nozzles.length === 0 ? (
        <p className="text-xs text-gray-500">
          Configure pumps first (Fuel Type Manager / Setup Wizard) to control
          them here.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {nozzles.map((n) => {
            const s = statusOf(n.name);
            return (
              <div
                key={n.name}
                className="rounded border p-2 flex items-center gap-2"
              >
                <span className="font-medium text-sm">{n.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">
                  {getFuelCode(n.label) || n.label}
                </span>
                <span
                  className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full ml-auto ${
                    s === "authorized"
                      ? "bg-green-100 text-green-700"
                      : s === "locked"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {s}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setStatus(n.name, "authorized")}
                    disabled={s === "authorized"}
                    className="text-green-600 disabled:opacity-40"
                    title="Authorize"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setStatus(n.name, "idle")}
                    className="text-gray-400"
                    title="Stop / idle"
                  >
                    <PowerOff className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setStatus(n.name, "locked")}
                    className="text-rose-500"
                    title="Lock"
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
