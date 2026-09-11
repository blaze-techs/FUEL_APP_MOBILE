/* TankTelemetry — ingest ATG/telematics (GPS/ATG) payload into TankMonitor readings.
 * Reverse-engineered from telematicsafrica/karooooo/fama/Sicuro etc. — the
 * telematics vector for tank probes. Currently client-side ingest (paste
 * JSON in the shape an ATG/GPS gateway emits). The readings persist in the
 * shared `tank_readings` cloud list (same as TankMonitor) — components
 * cross-link (this is not a new duplicate widget but an ingest front).
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Download,
  Fuel,
  Plus,
  Trash2,
  Wifi,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getFuelLabel, normalizeFuelType } from "@/react-app/config/pricing";
import {
  CLOUD_KEYS,
  classifyReading,
  downloadCsv,
  type TankReading,
} from "@/react-app/lib/forecourt-features";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

interface TelemetryReading extends TankReading {
  source: string;
}

const SAMPLE = `[
  {"product": "Super Petrol", "level_liters": 4320.5, "temperature": 22.4, "water_mm": 0.8},
  {"product": "Diesel", "level_liters": 2500, "temperature": 23.1, "water_mm": 5.2}
]`;

const SOURCE_LABEL = "telemetry-ingest";

export default function TankTelemetry() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: readings, setData: setReadings } = useCloudKV<
    TelemetryReading[]
  >(CLOUD_KEYS.tankReadings, stationId, []);

  const [open, setOpen] = useState(true);
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);

  const ingested = useMemo(
    () =>
      (readings as TelemetryReading[]).filter((r) => r.source === SOURCE_LABEL),
    [readings],
  );

  const parsePayload = (raw: string): TelemetryReading[] => {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(
        "Payload must be valid JSON (array of readings or single object).",
      );
    }
    const list = Array.isArray(obj) ? obj : [obj];
    const out: TelemetryReading[] = [];
    for (const item of list as unknown[]) {
      const r = item as Record<string, unknown> | null;
      if (!r) continue;
      const productRaw =
        (r.product as string) || (r.fuelType as string) || null;
      const measuredRaw =
        r.level_liters ?? r.level ?? r.measuredLevel ?? r.value ?? null;
      const tempRaw = r.temperature ?? r.temp_c ?? r.temp ?? undefined;
      const waterRaw = r.water_mm ?? r.water ?? undefined;
      const expectedRaw = r.expected ?? r.expectedLevel ?? undefined;
      if (!productRaw) continue;
      const measured = Number(measuredRaw);
      if (!Number.isFinite(measured) || measured < 0) continue;
      const canonical =
        normalizeFuelType(String(productRaw)) || String(productRaw);
      // Expected level is optional; if missing, rely on classifyReading default (0).
      const expected =
        expectedRaw != null && Number.isFinite(Number(expectedRaw))
          ? Number(expectedRaw)
          : 0;
      const water =
        waterRaw !== undefined && waterRaw !== null
          ? Number(waterRaw)
          : undefined;
      const temp =
        tempRaw !== undefined && tempRaw !== null ? Number(tempRaw) : undefined;
      const cls = classifyReading(measured, expected, water);
      const reading: TelemetryReading = {
        id: `tel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${out.length}`,
        fuelType: canonical,
        label: getFuelLabel(String(productRaw)),
        date: new Date().toISOString(),
        measuredLevel: measured,
        temperature: temp,
        waterMm: water,
        expectedLevel: expected,
        variance: cls.variance,
        variancePct: cls.variancePct,
        status: cls.status,
        source: SOURCE_LABEL,
      };
      out.push(reading);
    }
    return out;
  };

  const handleIngest = () => {
    if (!payload.trim()) {
      toastError("Paste a telemetry JSON payload first.");
      return;
    }
    setBusy(true);
    try {
      const parsed = parsePayload(payload);
      if (parsed.length === 0) {
        toastError("No usable readings found in the payload.");
        return;
      }
      setReadings((prev) => [...parsed, ...(prev as TelemetryReading[])]);
      toastSuccess(
        `Ingested ${parsed.length} telemetry reading(s) into Tank Monitor.`,
      );
      setPayload("");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Ingest failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (id: string) => {
    setReadings((prev) =>
      (prev as TelemetryReading[]).filter((r) => r.id !== id),
    );
    toastSuccess("Telemetry reading deleted.");
  };

  const exportCsv = () => {
    downloadCsv("tank-telemetry.csv", [
      [
        "Date",
        "Fuel",
        "Measured (L)",
        "Expected (L)",
        "Variance %",
        "Temp °C",
        "Water mm",
        "Status",
        "Source",
      ],
      ...ingested.map((r) => [
        r.date,
        r.label,
        r.measuredLevel,
        r.expectedLevel,
        r.variancePct.toFixed(2),
        r.temperature ?? "",
        r.waterMm ?? "",
        r.status,
        SOURCE_LABEL,
      ]),
    ]);
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fuel className="w-5 h-5 text-amber-500" />
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Telemetry Ingest (ATG / GPS telematics)
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Client-side ingest of ATG/telematics JSON payloads — the
              telematics vector behind tank visibility (e-telematica/karooooo
              reverse-engineer).
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {open ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {open && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-800 dark:text-blue-300">
            <Wifi className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              Paste an ATG/GPS JSON payload (array or single object). Fields
              accepted: <code>product/fuelType</code>,{" "}
              <code>level_liters/level/measuredLevel</code>,{" "}
              <code>expected</code>, <code>temperature</code>,{" "}
              <code>water_mm</code>. Ingested readings are tagged{" "}
              <code>{SOURCE_LABEL}</code> so the Tank Monitor can still
              distinguish manual entries.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-secondary"
              onClick={() => setPayload(SAMPLE)}
            >
              Fill sample payload
            </button>
            <button
              disabled={busy}
              className="btn btn-primary"
              onClick={handleIngest}
            >
              <Plus className="w-4 h-4" /> Ingest
            </button>
            <button className="btn btn-secondary" onClick={exportCsv}>
              <Download className="w-4 h-4" /> Export
            </button>
          </div>

          <textarea
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-3 text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            rows={7}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder={`Paste ATG/GPS JSON here…\n\n${SAMPLE}`}
          />

          {ingested.length > 0 ? (
            <div>
              <p className="text-xs text-gray-500">
                {ingested.length} ingested telemetry reading(
                {ingested.length === 1 ? "" : "s"})
              </p>
              <ul className="mt-2 space-y-2">
                {ingested.map((r) => (
                  <li
                    key={r.id}
                    className="rounded border border-gray-200 dark:border-gray-700 p-2 text-sm flex flex-wrap gap-2 items-center"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                      {r.label}
                    </span>
                    <span className="text-gray-600 dark:text-gray-300">
                      at {r.measuredLevel.toLocaleString()} L{" "}
                      {r.expectedLevel
                        ? `(expected ${r.expectedLevel.toLocaleString()})`
                        : ""}
                    </span>
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        r.status === "ok"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : r.status === "water"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {r.status === "ok" ? "OK" : "ALERT"}
                    </span>
                    {(r.status === "water" || r.status === "variance") && (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-rose-500 hover:text-rose-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded border border-dashed p-4 text-center text-xs text-gray-500">
              <CloudOff className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              No telemetry readings ingested yet.
            </div>
          )}
        </>
      )}
    </div>
  );
}
