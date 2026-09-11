import { useAutoSync } from "@/react-app/hooks/useAutoSync";
import {
  Bell,
  X,
  AlertTriangle,
  Info,
  CheckCircle2,
  Fuel,
  FileText,
  Shield,
  Calendar,
} from "lucide-react";
import { useState } from "react";

interface RegulatoryAlertsProps {
  countryCode: string;
}

const categoryIcons: Record<string, typeof Fuel> = {
  fuel_price: Fuel,
  tax: FileText,
  compliance: Shield,
  license: FileText,
  safety: Shield,
};

const priorityStyles = {
  high: "border-l-red-500 bg-red-500/5",
  medium: "border-l-amber-500 bg-amber-500/5",
  low: "border-l-blue-500 bg-blue-500/5",
};

const priorityLabels = {
  high: "High Priority",
  medium: "Medium",
  low: "Low",
};

export default function RegulatoryAlerts({
  countryCode,
}: RegulatoryAlertsProps) {
  const {
    regulatoryUpdates,
    markUpdateRead,
    dismissUpdate,
    unreadCount,
    highPriorityCount,
  } = useAutoSync(countryCode);
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visibleUpdates = regulatoryUpdates
    .filter((u) => !dismissedIds.has(u.id))
    .filter((u) => (expanded ? true : !u.read))
    .slice(0, expanded ? undefined : 3);

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
    dismissUpdate(id);
  };

  if (visibleUpdates.length === 0 && !expanded) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
        <CheckCircle2 size={14} className="text-green-500" />
        <span>All caught up! No pending alerts.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell
            size={14}
            className={
              highPriorityCount > 0
                ? "text-red-500"
                : unreadCount > 0
                  ? "text-amber-500"
                  : "text-gray-400"
            }
          />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Regulatory Alerts
          </span>
          {unreadCount > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${highPriorityCount > 0 ? "bg-red-500 text-white" : "bg-amber-500 text-white"}`}
            >
              {unreadCount}
            </span>
          )}
        </div>
        {regulatoryUpdates.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {expanded ? "Show less" : `View all (${regulatoryUpdates.length})`}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visibleUpdates.map((update) => {
          const Icon = categoryIcons[update.category] || Info;
          return (
            <div
              key={update.id}
              className={`relative border-l-2 ${priorityStyles[update.priority]} rounded-r-lg p-3 transition-all hover:bg-white/5 ${update.read ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <Icon
                    size={14}
                    className={`flex-shrink-0 mt-0.5 ${update.priority === "high" ? "text-red-400" : update.priority === "medium" ? "text-amber-400" : "text-blue-400"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h5 className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                        {update.title}
                      </h5>
                      <span
                        className={`text-[9px] px-1 rounded ${update.priority === "high" ? "bg-red-500/20 text-red-400" : update.priority === "medium" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}
                      >
                        {priorityLabels[update.priority]}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                      {update.summary}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[9px] text-gray-500 dark:text-gray-500 flex items-center gap-1">
                        <Calendar size={8} />
                        {new Date(update.effectiveDate).toLocaleDateString()}
                      </span>
                      <a
                        href={update.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-blue-500 hover:underline"
                      >
                        Source: {update.source}
                      </a>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!update.read && (
                    <button
                      onClick={() => markUpdateRead(update.id)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-green-400 transition-colors"
                      title="Mark as read"
                    >
                      <CheckCircle2 size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDismiss(update.id)}
                    className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
                    title="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
