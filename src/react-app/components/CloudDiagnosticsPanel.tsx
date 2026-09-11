import { useState, useCallback, useEffect } from "react";
import {
  Cloud,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader,
  Trash2,
  Search,
  Activity,
  Zap,
} from "lucide-react";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

interface CloudRow {
  id: string;
  dataPreview: string;
  size: number;
  isCompressed: boolean;
  stationId: string | null;
  collection: string | null;
}

interface TestResult {
  step: string;
  status: "pass" | "fail" | "pending";
  detail: string;
  duration?: number;
}

export default function CloudDiagnosticsPanel() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CloudRow[]>([]);
  const [search, setSearch] = useState("");
  const [testKey, setTestKey] = useState("diagnostic_test");
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [runningTest, setRunningTest] = useState(false);
  const [stats, setStats] = useState({
    totalRows: 0,
    compressedRows: 0,
    totalSize: 0,
    stations: 0,
  });

  const loadAllRows = useCallback(async () => {
    setLoading(true);
    try {
      const all = await cloudStorageService.getAll<unknown>();
      const cloudRows: CloudRow[] = Object.entries(all).map(([id, data]) => {
        const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
        const isCompressed =
          typeof data === "object" && data !== null && "__compressed" in data;
        return {
          id,
          dataPreview:
            jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr,
          size: jsonStr.length,
          isCompressed,
          stationId: null,
          collection: null,
        };
      });
      setRows(cloudRows);
      const compressed = cloudRows.filter((r) => r.isCompressed).length;
      const totalSize = cloudRows.reduce((sum, r) => sum + r.size, 0);
      const uniqueStations = new Set(
        cloudRows
          .map((r) => {
            const parts = r.id.split("__");
            return parts.length >= 3 ? parts[parts.length - 1] : null;
          })
          .filter(Boolean),
      ).size;
      setStats({
        totalRows: cloudRows.length,
        compressedRows: compressed,
        totalSize,
        stations: uniqueStations,
      });
    } catch (err) {
      console.error("[CloudDiagnostics] loadAllRows failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllRows();
  }, [loadAllRows]);

  const runReadWriteTest = useCallback(async () => {
    setRunningTest(true);
    setTestResults([]);
    const results: TestResult[] = [];

    const addResult = (
      step: string,
      status: TestResult["status"],
      detail: string,
      duration?: number,
    ) => {
      results.push({ step, status, detail, duration });
      setTestResults([...results]);
    };

    const t0 = performance.now();

    // Step 1: Check auth
    if (!user) {
      addResult("Auth", "fail", "No authenticated user");
      setRunningTest(false);
      return;
    }
    addResult(
      "Auth",
      "pass",
      `User: ${user.email || user.id}, UID: ${user.id?.slice(0, 8)}...`,
    );

    // Step 2: Check station
    if (!stationId) {
      addResult(
        "Station",
        "fail",
        "No station selected — per-station keys will use user-scoped fallback",
      );
    } else {
      addResult("Station", "pass", `Station ID: ${stationId.slice(0, 8)}...`);
    }

    // Step 3: Write test
    addResult("Write", "pending", "Writing test data to cloud...");
    const testData = {
      message: "Cloud diagnostic test",
      timestamp: new Date().toISOString(),
      value: Math.random() * 1000,
    };
    try {
      const writeStart = performance.now();
      await cloudStorageService.set(testKey, testData, stationId);
      const writeDuration = Math.round(performance.now() - writeStart);
      addResult(
        "Write",
        "pass",
        `Data written to key "${testKey}"`,
        writeDuration,
      );
    } catch (err) {
      addResult("Write", "fail", `Write failed: ${(err as Error).message}`);
      setRunningTest(false);
      return;
    }

    // Step 4: Read test
    addResult("Read", "pending", "Reading test data back from cloud...");
    try {
      // Clear cache first to force a cloud read
      cloudStorageService.clearCache(testKey, stationId);
      const readStart = performance.now();
      const readBack = await cloudStorageService.get<typeof testData>(
        testKey,
        stationId,
      );
      const readDuration = Math.round(performance.now() - readStart);
      if (readBack && readBack.message === testData.message) {
        addResult(
          "Read",
          "pass",
          `Data read back successfully (value: ${readBack.value?.toFixed(2)})`,
          readDuration,
        );
      } else {
        addResult(
          "Read",
          "fail",
          `Data mismatch or null. Got: ${JSON.stringify(readBack)?.slice(0, 100)}`,
        );
      }
    } catch (err) {
      addResult("Read", "fail", `Read failed: ${(err as Error).message}`);
    }

    // Step 5: Cache test
    addResult("Cache", "pending", "Testing in-memory cache...");
    try {
      const cached = cloudStorageService.getCached<typeof testData>(
        testKey,
        stationId,
      );
      if (cached) {
        addResult(
          "Cache",
          "pass",
          `Cache hit (value: ${cached.value?.toFixed(2)})`,
        );
      } else {
        addResult(
          "Cache",
          "fail",
          "Cache miss after write — cache may not be working",
        );
      }
    } catch (err) {
      addResult(
        "Cache",
        "fail",
        `Cache test failed: ${(err as Error).message}`,
      );
    }

    // Step 6: Delete test
    addResult("Delete", "pending", "Deleting test data...");
    try {
      await cloudStorageService.delete(testKey, stationId);
      addResult("Delete", "pass", "Test data deleted");
    } catch (err) {
      addResult("Delete", "fail", `Delete failed: ${(err as Error).message}`);
    }

    // Step 7: Realtime check
    const realtimeEnabled = cloudStorageService.isRealtimeEnabled();
    addResult(
      "Realtime",
      realtimeEnabled ? "pass" : "fail",
      realtimeEnabled
        ? "Realtime subscriptions are enabled"
        : "Realtime is DISABLED (Low-bandwidth mode ON)",
    );

    const totalDuration = Math.round(performance.now() - t0);
    addResult("Total", "pass", `All steps completed in ${totalDuration}ms`);

    setRunningTest(false);
  }, [user, stationId, testKey]);

  const deleteRow = useCallback(
    async (key: string) => {
      if (!confirm(`Delete cloud data for key: ${key}? This cannot be undone.`))
        return;
      try {
        await cloudStorageService.delete(key, stationId);
        await loadAllRows();
      } catch (err) {
        toastError(`Failed to delete: ${(err as Error).message}`);
      }
    },
    [stationId, loadAllRows],
  );

  const forceReloadAll = useCallback(async () => {
    if (
      !confirm(
        "Force reload ALL cloud data? This clears the in-memory cache and re-fetches everything from Supabase. Your unsaved local changes may be lost.",
      )
    )
      return;
    setLoading(true);
    // Clear all localStorage cloud cache
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith("fuelpro_cloud_"),
    );
    keys.forEach((k) => localStorage.removeItem(k));
    // Reload
    await loadAllRows();
    // Trigger a page reload to re-initialize all components
    window.location.reload();
  }, [loadAllRows]);

  const filteredRows = rows.filter((r) =>
    r.id.toLowerCase().includes(search.toLowerCase()),
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-1">
            <Database size={18} className="text-blue-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Total Rows
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-800 dark:text-white">
            {stats.totalRows}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={18} className="text-green-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Compressed
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-800 dark:text-white">
            {stats.compressedRows}
            <span className="text-sm text-gray-400 ml-1">
              / {stats.totalRows}
            </span>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-1">
            <Cloud size={18} className="text-purple-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Data Size
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-800 dark:text-white">
            {formatSize(stats.totalSize)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-1">
            <Activity
              size={18}
              className={
                cloudStorageService.isRealtimeEnabled()
                  ? "text-green-500"
                  : "text-orange-500"
              }
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Realtime
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-800 dark:text-white">
            {cloudStorageService.isRealtimeEnabled() ? "ON" : "OFF"}
          </div>
        </div>
      </div>

      {/* Read/Write/Delete Test */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Activity size={20} className="text-blue-500" />
            Cloud Storage Read/Write Test
          </h2>
          <button
            onClick={runReadWriteTest}
            disabled={runningTest}
            className="btn btn-primary flex items-center gap-2 text-sm"
          >
            {runningTest ? (
              <Loader size={16} className="animate-spin" />
            ) : (
              <Zap size={16} />
            )}
            {runningTest ? "Running..." : "Run Test"}
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
            Test Key Name
          </label>
          <input
            type="text"
            value={testKey}
            onChange={(e) => setTestKey(e.target.value)}
            className="w-full input text-sm"
            placeholder="diagnostic_test"
          />
        </div>

        {testResults.length > 0 && (
          <div className="space-y-2">
            {testResults.map((r, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg text-sm ${
                  r.status === "pass"
                    ? "bg-green-50 dark:bg-green-900/20"
                    : r.status === "fail"
                      ? "bg-red-50 dark:bg-red-900/20"
                      : "bg-blue-50 dark:bg-blue-900/20"
                }`}
              >
                {r.status === "pass" ? (
                  <CheckCircle
                    size={16}
                    className="text-green-500 mt-0.5 flex-shrink-0"
                  />
                ) : r.status === "fail" ? (
                  <XCircle
                    size={16}
                    className="text-red-500 mt-0.5 flex-shrink-0"
                  />
                ) : (
                  <Loader
                    size={16}
                    className="text-blue-500 animate-spin mt-0.5 flex-shrink-0"
                  />
                )}
                <div className="flex-1">
                  <div className="font-medium text-gray-800 dark:text-white">
                    {r.step}
                    {r.duration != null && (
                      <span className="text-gray-400 ml-2 font-normal">
                        ({r.duration}ms)
                      </span>
                    )}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400 text-xs">
                    {r.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cloud Data Browser */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Database size={20} className="text-purple-500" />
            Cloud Data Browser ({filteredRows.length})
          </h2>
          <div className="flex gap-2">
            <button
              onClick={loadAllRows}
              disabled={loading}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={forceReloadAll}
              className="btn btn-secondary flex items-center gap-2 text-sm bg-orange-500 hover:bg-orange-600 text-white border-none"
            >
              <AlertTriangle size={14} />
              Force Reload All
            </button>
          </div>
        </div>

        <div className="mb-4 relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full input pl-10 text-sm"
            placeholder="Search cloud keys..."
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader size={24} className="animate-spin text-blue-500" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Database size={32} className="mx-auto mb-2 opacity-50" />
            {rows.length === 0
              ? "No cloud data found. Try the Force Reload button or check your auth session."
              : "No rows match your search."}
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredRows.map((row) => (
              <div
                key={row.id}
                className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-medium text-gray-800 dark:text-white truncate">
                      {row.id}
                    </span>
                    {row.isCompressed ? (
                      <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                        gzip
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 rounded">
                        raw
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {formatSize(row.size)}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                    {row.dataPreview}
                  </div>
                </div>
                <button
                  onClick={() => deleteRow(row.id)}
                  className="flex-shrink-0 p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                  title="Delete this cloud row"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
