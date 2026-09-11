import { useState, useEffect, useCallback, useRef } from "react";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Download,
  Upload,
  Smartphone,
  Laptop,
  Tablet,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  HardDrive,
  Clock,
  Zap,
} from "lucide-react";
import {
  getSyncState,
  getPendingQueue,
  cleanupSynced,
  markSynced,
  exportAllData,
  importAllData,
  syncMonitor,
  onMutation,
  type SyncItem,
} from "@/react-app/lib/syncEngine";

export default function SyncDashboard() {
  const [state, setState] = useState({
    lastSync: 0,
    deviceId: "",
    pendingCount: 0,
    isOnline: navigator.onLine,
  });
  const [pending, setPending] = useState<SyncItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [exportData, setExportData] = useState("");
  const [importText, setImportText] = useState("");
  const [toast, setToast] = useState("");
  const [stats, setStats] = useState({
    totalDocs: 0,
    totalStorage: 0,
    lastActivity: "Never",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubState = syncMonitor.subscribe(setState);
    syncMonitor.start(5000);
    loadPending();
    loadStats();

    // Listen for cross-tab mutations
    const unsubMutation = onMutation((item) => {
      setToast(`Synced: ${item.collection} ${item.operation}`);
      setTimeout(() => setToast(""), 3000);
      loadPending();
      loadStats();
    });

    // Listen for online/offline
    const onOnline = () => setState((s) => ({ ...s, isOnline: true }));
    const onOffline = () => setState((s) => ({ ...s, isOnline: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      unsubState();
      unsubMutation();
      syncMonitor.stop();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const loadPending = useCallback(async () => {
    const queue = await getPendingQueue();
    setPending(queue);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      let totalDocs = 0;
      let totalStorage = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("fuelpro_")) {
          totalDocs++;
          totalStorage += (localStorage.getItem(key) || "").length * 2;
        }
      }
      setStats({
        totalDocs,
        totalStorage,
        lastActivity: new Date().toLocaleTimeString(),
      });
    } catch {
      /* */
    }
  }, []);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      // Mark all pending as synced
      for (const item of pending) {
        await markSynced(item.id);
      }
      localStorage.setItem("fuelpro_last_sync", String(Date.now()));
      await loadPending();
      await loadStats();
      setToast(`Synced ${pending.length} items`);
    } catch {
      setToast("Sync failed");
    }
    setIsSyncing(false);
    setTimeout(() => setToast(""), 3000);
  }, [pending, loadPending, loadStats]);

  const handleExport = useCallback(async () => {
    const data = await exportAllData();
    setExportData(data);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("Data exported");
    setTimeout(() => setToast(""), 3000);
  }, []);

  const handleImport = useCallback(async () => {
    if (!importText.trim()) return;
    try {
      const result = await importAllData(importText.trim());
      setToast(`Imported: ${result.imported} items, ${result.errors} errors`);
      await loadStats();
    } catch {
      setToast("Import failed - invalid data");
    }
    setImportText("");
    setTimeout(() => setToast(""), 3000);
  }, [importText, loadStats]);

  const handleFileImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await importAllData(String(reader.result));
          setToast(
            `Imported: ${result.imported} items, ${result.errors} errors`,
          );
          await loadStats();
        } catch {
          setToast("Import failed");
        }
        setTimeout(() => setToast(""), 3000);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [loadStats],
  );

  const handleCleanup = useCallback(async () => {
    const cleared = await cleanupSynced();
    setToast(`Cleaned up ${cleared} old items`);
    await loadPending();
    setTimeout(() => setToast(""), 3000);
  }, [loadPending]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  };

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        color: "var(--blend-border)",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 20,
            fontWeight: 700,
            color: "var(--blend-text-primary)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <RefreshCw size={22} style={{ color: "var(--blend-amber)" }} />{" "}
          Cross-Device Sync
        </h2>
        <p
          style={{ margin: 0, fontSize: 12, color: "var(--blend-text-muted)" }}
        >
          Sync data across all your devices and browsers instantly
        </p>
      </div>

      {/* Status bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <StatCard
          icon={state.isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
          label="Connection"
          value={state.isOnline ? "Online" : "Offline"}
          color={state.isOnline ? "var(--blend-green)" : "var(--blend-red)"}
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Pending Sync"
          value={String(state.pendingCount)}
          color="var(--blend-amber)"
        />
        <StatCard
          icon={<HardDrive size={16} />}
          label="Storage Used"
          value={formatSize(stats.totalStorage)}
          color="var(--blend-blue)"
        />
        <StatCard
          icon={<CheckCircle2 size={16} />}
          label="Data Items"
          value={String(stats.totalDocs)}
          color="var(--blend-blue)"
        />
      </div>

      {/* Device ID */}
      <div
        style={{
          background: "rgba(30,30,35,0.6)",
          borderRadius: 10,
          padding: 12,
          border: "1px solid var(--blend-text-secondary)",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--blend-text-muted)",
            marginBottom: 4,
          }}
        >
          Device ID (unique to this browser)
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--blend-text-secondary)",
            fontFamily: "monospace",
            wordBreak: "break-all",
          }}
        >
          {state.deviceId}
        </div>
      </div>

      {/* Actions */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
      >
        <button
          onClick={handleSync}
          disabled={isSyncing || pending.length === 0}
          style={{
            padding: "10px 18px",
            background:
              isSyncing || pending.length === 0
                ? "var(--blend-text-secondary)"
                : "var(--blend-amber)",
            color: "var(--blend-surface-dark)",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor:
              isSyncing || pending.length === 0 ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {isSyncing ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Zap size={14} />
          )}{" "}
          Sync Now
        </button>
        <button
          onClick={handleExport}
          style={{
            padding: "10px 18px",
            background: "#1a1a1f",
            color: "var(--blend-border)",
            border: "1px solid var(--blend-text-secondary)",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Download size={14} /> Export Data
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            padding: "10px 18px",
            background: "#1a1a1f",
            color: "var(--blend-border)",
            border: "1px solid var(--blend-text-secondary)",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Upload size={14} /> Import File
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          onChange={handleFileImport}
          style={{ display: "none" }}
        />
        <button
          onClick={handleCleanup}
          style={{
            padding: "10px 18px",
            background: "transparent",
            color: "var(--blend-red)",
            border: "1px solid var(--blend-red)",
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Trash2 size={14} /> Cleanup Old
        </button>
      </div>

      {/* Import textarea */}
      <div style={{ marginBottom: 16 }}>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste exported JSON data here to import..."
          style={{
            width: "100%",
            minHeight: 80,
            padding: 10,
            background: "#1a1a1f",
            border: "1px solid var(--blend-text-secondary)",
            borderRadius: 8,
            color: "var(--blend-border)",
            fontSize: 12,
            fontFamily: "monospace",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        {importText && (
          <button
            onClick={handleImport}
            style={{
              marginTop: 8,
              padding: "8px 16px",
              background: "var(--blend-green)",
              color: "var(--blend-text-primary)",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Import Data
          </button>
        )}
      </div>

      {/* Pending queue */}
      <div style={{ marginBottom: 16 }}>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--blend-text-primary)",
            margin: "0 0 10px",
          }}
        >
          Pending Sync Queue
        </h3>
        {pending.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: 24,
              color: "var(--blend-text-secondary)",
              fontSize: 13,
            }}
          >
            <CheckCircle2 size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <p>All data synced</p>
          </div>
        ) : (
          <div
            style={{
              maxHeight: 240,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {pending.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "rgba(30,30,35,0.6)",
                  borderRadius: 8,
                  border: "1px solid var(--blend-text-secondary)",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "var(--blend-amber)" }}>
                  <RefreshCw size={12} />
                </span>
                <span style={{ flex: 1, color: "var(--blend-border)" }}>
                  {item.collection}
                </span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 10,
                    background:
                      item.operation === "create"
                        ? "rgba(16,185,129,0.1)"
                        : item.operation === "delete"
                          ? "rgba(239,68,68,0.1)"
                          : "rgba(59,130,246,0.1)",
                    color:
                      item.operation === "create"
                        ? "var(--blend-green)"
                        : item.operation === "delete"
                          ? "var(--blend-red)"
                          : "var(--blend-blue)",
                  }}
                >
                  {item.operation}
                </span>
                <span
                  style={{ color: "var(--blend-text-secondary)", fontSize: 10 }}
                >
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync explanation */}
      <div
        style={{
          background: "rgba(30,30,35,0.6)",
          borderRadius: 10,
          padding: 12,
          border: "1px solid var(--blend-text-secondary)",
          fontSize: 11,
          color: "var(--blend-text-muted)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--blend-text-secondary)" }}>
          How Cross-Device Sync Works:
        </strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
          <li>
            <strong style={{ color: "var(--blend-amber)" }}>
              Same Browser:
            </strong>{" "}
            Data syncs instantly across all tabs via BroadcastChannel
          </li>
          <li>
            <strong style={{ color: "var(--blend-amber)" }}>
              Different Devices:
            </strong>{" "}
            Export data as JSON from one device, import on another
          </li>
          <li>
            <strong style={{ color: "var(--blend-amber)" }}>Offline:</strong>{" "}
            All changes queue in IndexedDB and sync when you reconnect
          </li>
          <li>
            <strong style={{ color: "var(--blend-amber)" }}>Storage:</strong>{" "}
            Data persists in IndexedDB even after browser close
          </li>
        </ul>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            padding: "10px 16px",
            background: "#1a1a1f",
            border: "1px solid var(--blend-text-secondary)",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--blend-border)",
            zIndex: 9999,
            animation: "slideUp 0.2s ease",
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "rgba(30,30,35,0.6)",
        borderRadius: 10,
        padding: 12,
        border: "1px solid var(--blend-text-secondary)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${color}20`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--blend-text-primary)",
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--blend-text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
