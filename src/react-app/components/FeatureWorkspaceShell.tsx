import { useMemo } from "react";
import { ChevronRight, CircleDot, Database, Layers3, Wifi, WifiOff } from "lucide-react";
import { getFeatureContract } from "@/react-app/config/feature-registry";
import { NAVIGATION_WORKSPACES } from "@/react-app/config/navigation-config";

type Props = {
  tabId: string;
  children: React.ReactNode;
  onTabChange?: (tabId: string) => void;
};

const STAGE_META = {
  review: { label: "Review", icon: CircleDot },
  operate: { label: "Operate", icon: Layers3 },
  reconcile: { label: "Reconcile", icon: Database },
  configure: { label: "Configure", icon: Layers3 },
} as const;

export default function FeatureWorkspaceShell({ tabId, children, onTabChange }: Props) {
  const contract = getFeatureContract(tabId);

  const workspace = useMemo(
    () => NAVIGATION_WORKSPACES.find((w) => w.id === contract?.workspace),
    [contract?.workspace],
  );

  if (!contract) return <>{children}</>;

  const stage = STAGE_META[contract.workflowStage || "review"];
  const StageIcon = stage.icon;
  const related = (contract.relatedModules || [])
    .map((id) => getFeatureContract(id))
    .filter(Boolean)
    .slice(0, 3);

  return (
    <section className="space-y-3" data-feature-workspace={tabId}>
      <div className="rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/95">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
              <span>FuelPro</span>
              <ChevronRight size={11} aria-hidden />
              {workspace && <span>{workspace.label}</span>}
              <ChevronRight size={11} aria-hidden />
              <span className="text-slate-700 dark:text-slate-200">{contract.purpose}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">{contract.primaryAction}</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <StageIcon size={11} /> {stage.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Database size={11} /> {contract.dataBoundary}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {contract.offlineMode === "none" ? <WifiOff size={11} /> : <Wifi size={11} />}
                {contract.offlineMode === "full" ? "Offline ready" : contract.offlineMode === "read-only" ? "Offline read" : "Online"}
              </span>
            </div>
          </div>

          {(contract.subTabs?.length || related.length) ? (
            <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5">
              {(contract.subTabs || []).map((subTab) => (
                <span key={subTab} className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {subTab}
                </span>
              ))}
              {related.map((item) => item && (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange?.(item.id)}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {item.purpose}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}
