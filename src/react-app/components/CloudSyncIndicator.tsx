import { Cloud, CloudOff } from "lucide-react";
import { useFuelStore } from "@/react-app/hooks/useFuelStore";

export function CloudSyncIndicator() {
  const isOnline = useFuelStore((s) => s.isOnline);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${isOnline ? "text-green-500" : "text-red-500"}`}
    >
      {isOnline ? <Cloud size={14} /> : <CloudOff size={14} />}
      {isOnline ? "Synced" : "Offline"}
    </span>
  );
}

// Default export for backward compatibility
export default CloudSyncIndicator;
