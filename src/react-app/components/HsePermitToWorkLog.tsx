/* HsePermitToWorkLog — HSSE permit-to-work register: any contractor work
 * on the forecourt (hot work, electrical, confined space) requires a
 * permit. Logs issue/close with signer names. Cloud KV `hsse_permits`.
 */
import { FileSignature, Plus } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

interface Permit {
  id: string;
  issued: string;
  work: string;
  contractor: string;
  issuer: string;
  closed: boolean;
}

export default function HsePermitToWorkLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: permits, setData: setPermits } = useCloudKV<Permit[]>(
    "hsse_permits",
    stationId,
    [],
  );
  const [work, setWork] = useState("");
  const [contractor, setContractor] = useState("");
  const [issuer, setIssuer] = useState("");

  const issuePermit = () => {
    if (!work.trim() || !contractor.trim() || !issuer.trim()) return;
    const permit: Permit = {
      id: `ptw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      issued: new Date().toISOString().slice(0, 10),
      work: work.trim(),
      contractor: contractor.trim(),
      issuer: issuer.trim(),
      closed: false,
    };
    setPermits((prev) => [...(prev || []), permit]);
    emitFeatureEvent({
      type: "permit.issued",
      payload: {
        permitId: permit.id,
        work: permit.work,
        contractor: permit.contractor,
      },
    });
    setWork("");
    setContractor("");
    setIssuer("");
  };

  const closePermit = (id: string) => {
    const found = (permits || []).find((p) => p.id === id);
    setPermits((prev) =>
      (prev || []).map((p) => (p.id === id ? { ...p, closed: !p.closed } : p)),
    );
    if (found) {
      emitFeatureEvent({
        type: !found.closed ? "permit.closed" : "permit.issued",
        payload: {
          permitId: id,
          work: found.work,
          contractor: found.contractor,
        },
      });
    }
  };

  const openCount = (permits || []).filter((p) => !p.closed).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <FileSignature size={16} /> Permit to Work
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {openCount} open permits — close them on completion.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={work}
          onChange={(e) => setWork(e.target.value)}
          placeholder="Work (e.g. Hot work on canopy)"
          className="flex-1 min-w-[200px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={contractor}
          onChange={(e) => setContractor(e.target.value)}
          placeholder="Contractor"
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="Issued by"
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={issuePermit}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Issue
        </button>
      </div>
      <div className="space-y-1.5">
        {(permits || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No permits issued.</p>
        ) : (
          [...(permits || [])]
            .reverse()
            .slice(0, 20)
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white ${p.closed ? "line-through opacity-60" : ""}`}
                  >
                    {p.work}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {p.issued} • {p.contractor} • issued by {p.issuer}
                  </p>
                </div>
                <button
                  onClick={() => closePermit(p.id)}
                  className={`rounded px-2 py-1 text-xs font-medium ${p.closed ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
                >
                  {p.closed ? "Closed" : "Close"}
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
