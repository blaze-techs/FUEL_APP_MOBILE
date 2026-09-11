import { useState, useEffect, useCallback } from "react";
import {
  Lock,
  User,
  LogIn,
  LogOut,
  Eye,
  Shield,
  Fuel,
  ShoppingBag,
  CreditCard,
  Receipt,
  Truck,
  Users,
  Gauge,
  DollarSign,
  RefreshCw,
  AlertCircle,
  LayoutDashboard,
  TrendingUp,
  Search,
  Building2,
  CheckCircle2,
} from "lucide-react";
import {
  loginWithAccessCode,
  getAccessSession,
  clearAccessSession,
  lookupStation,
  type StationAccessSession,
  type StationLookupResult,
} from "@/react-app/lib/station-access-code-service";
import {
  getStationSnapshot,
  type StationSnapshot,
} from "@/react-app/lib/station-snapshot-service";
import { getCurrencySymbol } from "@/react-app/lib/currency";

/**
 * Station Access page — lets a team member log in with a username + password
 * provided by the station owner (NO signup needed). The member enters the
 * credentials and gains restricted (read-only or tab-limited) access to the
 * station's shared data.
 *
 * URL: /#/station-access
 *
 * The owner creates access codes in the Team Manager tab.
 */
export default function StationAccess() {
  const [session, setSession] = useState<StationAccessSession | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [stationOwnerId, setStationOwnerId] = useState("");
  const [stationId, setStationId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<StationSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [activeView, setActiveView] = useState<string>("dashboard");
  // Station search (lookup by name/code instead of manual UUID entry).
  const [stationQuery, setStationQuery] = useState("");
  const [stationResults, setStationResults] = useState<StationLookupResult[]>(
    [],
  );
  const [stationSearching, setStationSearching] = useState(false);
  const [showManualIds, setShowManualIds] = useState(false);

  useEffect(() => {
    setSession(getAccessSession());
    // Pre-fill from URL query params if present (owner can share a
    // pre-filled link: /#/station-access?owner=<uid>&station=<sid>).
    const params = new URLSearchParams(
      window.location.hash.split("?")[1] || "",
    );
    const owner = params.get("owner");
    const station = params.get("station");
    if (owner) setStationOwnerId(owner);
    if (station) setStationId(station);
  }, []);

  // Debounced station search by name or code.
  const handleStationSearch = useCallback((value: string) => {
    setStationQuery(value);
    setStationOwnerId("");
    setStationId("");
    const q = value.trim();
    if (q.length < 2) {
      setStationResults([]);
      return;
    }
    setStationSearching(true);
    const t = setTimeout(async () => {
      const results = await lookupStation(q);
      setStationResults(results);
      setStationSearching(false);
      if (results.length === 0) setShowManualIds(true);
      else setShowManualIds(false);
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const handleSelectStation = (s: StationLookupResult) => {
    setStationOwnerId(s.ownerId);
    setStationId(s.stationId);
    setStationQuery(s.stationName);
    setStationResults([]);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password.");
      return;
    }
    if (!stationOwnerId.trim() || !stationId.trim()) {
      setError(
        "Please search for and select your station, or enter the IDs manually.",
      );
      return;
    }
    setLoading(true);
    try {
      const s = await loginWithAccessCode(
        username,
        password,
        stationOwnerId,
        stationId,
      );
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch the public station snapshot (no Supabase session needed — the
  // object is in a public Storage bucket). Re-fetches every 30s so the
  // member sees near-live updates when the owner republishes.
  const loadSnapshot = useCallback(async (sid: string) => {
    setSnapshotLoading(true);
    try {
      const snap = await getStationSnapshot(sid);
      setSnapshot(snap);
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.stationId) return;
    loadSnapshot(session.stationId);
    const interval = setInterval(() => {
      loadSnapshot(session.stationId);
    }, 30000);
    return () => clearInterval(interval);
  }, [session?.stationId, loadSnapshot]);

  const handleLogout = () => {
    clearAccessSession();
    setSession(null);
    setSnapshot(null);
    setUsername("");
    setPassword("");
  };

  // The allowed-views list, filtered by the access code's allowedTabs. If
  // allowedTabs is empty, the member can see everything (read-only).
  const allowedTabs = session?.allowedTabs ?? [];
  const allViews = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "sales", label: "Sales", icon: TrendingUp },
    { id: "pos", label: "Point of Sale", icon: ShoppingBag },
    { id: "inventory", label: "Inventory", icon: Gauge },
    { id: "credit", label: "Credit", icon: CreditCard },
    { id: "invoices", label: "Invoices", icon: Receipt },
    { id: "offloading", label: "Offloading", icon: Truck },
    { id: "team", label: "Team", icon: Users },
    { id: "fuelprices", label: "Fuel Prices", icon: Fuel },
    { id: "expenses", label: "Expenses", icon: DollarSign },
  ];
  const visibleViews =
    allowedTabs.length === 0
      ? allViews
      : allViews.filter((v) => allowedTabs.includes(v.id));

  if (session) {
    const currency = snapshot?.currency || "USD";
    // Country-aware symbol (was hardcoded `currency === "KES" ? "KSh" : "$"`,
    // which showed "$" for every non-Kenya station — wrong for EUR/GBP/NGN…).
    const currencySymbol = getCurrencySymbol(currency);
    const fmt = (n: number | undefined | null) =>
      Number.isFinite(n as number)
        ? `${currencySymbol}${(n as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : "—";

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
        {/* Header */}
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center">
                <Fuel className="text-green-600" size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold dark:text-white leading-tight">
                  {snapshot?.stationName || "Station Access"}
                </h1>
                <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Shield size={11} /> {session.memberName} ·{" "}
                    {session.memberRole}
                  </span>
                  <span
                    className={`flex items-center gap-1 ${session.readOnly ? "text-blue-600" : "text-green-600"}`}
                  >
                    <Eye size={11} />
                    {session.readOnly ? "Read-Only" : "Full Access"}
                  </span>
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
            >
              <LogOut size={14} /> Log Out
            </button>
          </div>
          {/* View switcher — the "approved sections" the member can access */}
          <div className="max-w-6xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
            {visibleViews.map((v) => {
              const Icon = v.icon;
              const isActive = activeView === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setActiveView(v.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${isActive ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"}`}
                >
                  <Icon size={14} /> {v.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
          {snapshotLoading && !snapshot && (
            <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
              <RefreshCw size={18} className="animate-spin" />
              Loading station data…
            </div>
          )}

          {!snapshotLoading && !snapshot && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6 text-center">
              <AlertCircle className="mx-auto text-amber-500 mb-2" size={32} />
              <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-1">
                No shared data available yet
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                The station owner hasn't published a data snapshot. Please ask
                them to open the Team Manager tab → Access Codes → "Refresh
                shared snapshot". The data will appear here automatically.
              </p>
            </div>
          )}

          {snapshot && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>
                  Last updated: {new Date(snapshot.updatedAt).toLocaleString()}
                </span>
                <button
                  onClick={() => loadSnapshot(session.stationId)}
                  className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>

              {/* DASHBOARD */}
              {activeView === "dashboard" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard
                    label="Total Revenue"
                    value={fmt(snapshot.salesKpis.totalRevenue)}
                    icon={DollarSign}
                    color="green"
                  />
                  <StatCard
                    label="Fuel Sold (L)"
                    value={(
                      snapshot.salesKpis.totalFuelSold || 0
                    ).toLocaleString()}
                    icon={Fuel}
                    color="blue"
                  />
                  <StatCard
                    label="Transactions"
                    value={String(snapshot.salesKpis.transactionCount || 0)}
                    icon={ShoppingBag}
                    color="indigo"
                  />
                  <StatCard
                    label="Fuel Types"
                    value={String(snapshot.fuelPrices.length)}
                    icon={Gauge}
                    color="purple"
                  />
                </div>
              )}

              {/* FUEL PRICES */}
              {activeView === "fuelprices" && (
                <Card title="Current Pump Prices">
                  {snapshot.fuelPrices.length === 0 ? (
                    <Empty text="No fuel prices published." />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {snapshot.fuelPrices.map((f, i) => (
                        <div
                          key={i}
                          className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                        >
                          <p className="text-xs text-gray-500">{f.label}</p>
                          <p className="text-lg font-bold dark:text-white">
                            {fmt(f.price)}
                          </p>
                          {f.code && (
                            <p className="text-[10px] text-gray-400">
                              {f.code}/L
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* SALES */}
              {activeView === "sales" && (
                <Card title="Recent Sales">
                  {snapshot.recentSales.length === 0 ? (
                    <Empty text="No sales published." />
                  ) : (
                    <Table
                      headers={[
                        "Invoice",
                        "Date",
                        "Fuel",
                        "Litres",
                        "Total",
                        "Payment",
                      ]}
                    >
                      {snapshot.recentSales.map((s, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {s.invoice || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.date || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.fuel || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.litres ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {fmt(s.total)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.payment || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}

              {/* POS (same recent sales, framed as POS history) */}
              {activeView === "pos" && (
                <Card title="Point of Sale — Recent Transactions">
                  {snapshot.recentSales.length === 0 ? (
                    <Empty text="No POS transactions published." />
                  ) : (
                    <Table
                      headers={["Invoice", "Date", "Fuel", "Litres", "Total"]}
                    >
                      {snapshot.recentSales.map((s, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {s.invoice || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.date || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.fuel || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {s.litres ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {fmt(s.total)}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}

              {/* INVENTORY (pumps + tank levels) */}
              {activeView === "inventory" && (
                <div className="space-y-4">
                  <Card title="Pump Status">
                    {snapshot.pumps.length === 0 ? (
                      <Empty text="No pump data published." />
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {snapshot.pumps.map((p, i) => (
                          <div
                            key={i}
                            className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center"
                          >
                            <p className="text-xs text-gray-500">{p.fuel}</p>
                            <p className="text-xl font-bold dark:text-white">
                              {p.count}
                            </p>
                            <p className="text-[10px] text-gray-400">pumps</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                  <Card title="Tank Levels">
                    {snapshot.tankLevels.length === 0 ? (
                      <Empty text="No tank data published." />
                    ) : (
                      <Table
                        headers={[
                          "Fuel",
                          "Opening (L)",
                          "Closing (L)",
                          "Remaining (L)",
                        ]}
                      >
                        {snapshot.tankLevels.map((t, i) => (
                          <tr
                            key={i}
                            className="border-t border-gray-100 dark:border-gray-800"
                          >
                            <td className="px-3 py-2 text-xs dark:text-white">
                              {t.fuel}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {(t.opening || 0).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {(t.closing || 0).toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-xs dark:text-white">
                              {(t.closing || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </Table>
                    )}
                  </Card>
                </div>
              )}

              {/* CREDIT */}
              {activeView === "credit" && (
                <Card title="Credit Accounts">
                  {snapshot.creditAccounts.length === 0 ? (
                    <Empty text="No credit accounts published." />
                  ) : (
                    <Table headers={["Customer", "Balance", "Limit", "Status"]}>
                      {snapshot.creditAccounts.map((c, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {c.name}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {fmt(c.balance)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {fmt(c.limit)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {c.status || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}

              {/* INVOICES */}
              {activeView === "invoices" && (
                <Card title="Invoices">
                  {snapshot.invoices.length === 0 ? (
                    <Empty text="No invoices published." />
                  ) : (
                    <Table
                      headers={[
                        "Invoice #",
                        "Customer",
                        "Total",
                        "Date",
                        "Status",
                      ]}
                    >
                      {snapshot.invoices.map((inv, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {inv.number || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {inv.customer || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {fmt(inv.total)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {inv.date || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {inv.status || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}

              {/* OFFLOADING */}
              {activeView === "offloading" && (
                <Card title="Fuel Offloading Records">
                  {snapshot.offloading.length === 0 ? (
                    <Empty text="No offloading records published." />
                  ) : (
                    <Table headers={["Truck", "Fuel", "Litres", "Date"]}>
                      {snapshot.offloading.map((o, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {o.truck || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {o.fuel || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {(o.litres || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {o.date || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}

              {/* TEAM */}
              {activeView === "team" && (
                <Card title="Team Members">
                  {snapshot.employees.length === 0 ? (
                    <Empty text="No team data published." />
                  ) : (
                    <Table headers={["Name", "Role", "Status"]}>
                      {snapshot.employees.map((e, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {e.name}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {e.role}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {e.status || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}

              {/* EXPENSES */}
              {activeView === "expenses" && (
                <Card title="Recent Expenses">
                  {snapshot.expenses.length === 0 ? (
                    <Empty text="No expenses published." />
                  ) : (
                    <Table headers={["Category", "Amount", "Date"]}>
                      {snapshot.expenses.map((e, i) => (
                        <tr
                          key={i}
                          className="border-t border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {e.category}
                          </td>
                          <td className="px-3 py-2 text-xs dark:text-white">
                            {fmt(e.amount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {e.date || "—"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              )}
            </div>
          )}
        </main>

        <footer className="text-center text-[10px] text-gray-400 py-3 px-4">
          Read-only access via access code · Changes are not saved · Data
          auto-refreshes every 30s
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center">
            <Lock className="text-blue-600" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold dark:text-white">
              Station Access
            </h1>
            <p className="text-sm text-gray-500">
              Team member login — no signup needed
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Station search (by name or code) — replaces manual UUID entry */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Find Your Station
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={stationQuery}
                onChange={(e) => handleStationSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-white"
                placeholder="Station name or code"
                autoFocus
              />
              {stationSearching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              )}
            </div>
            {/* Search results */}
            {stationResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {stationResults.map((s) => (
                  <button
                    key={s.stationId}
                    type="button"
                    onClick={() => handleSelectStation(s)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors ${stationOwnerId === s.ownerId ? "bg-green-500/10 border border-green-500/30" : "bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                  >
                    <Building2
                      size={14}
                      className="text-green-600 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium dark:text-white truncate">
                        {s.stationName}
                      </p>
                      {s.code && (
                        <p className="text-[10px] text-gray-500 truncate">
                          Code: {s.code}
                        </p>
                      )}
                    </div>
                    {stationOwnerId === s.ownerId && (
                      <CheckCircle2
                        size={14}
                        className="text-green-600 flex-shrink-0"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* Selected station confirmation */}
            {stationOwnerId && stationResults.length === 0 && stationQuery && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2">
                <CheckCircle2
                  size={14}
                  className="text-green-600 flex-shrink-0"
                />
                <span className="text-xs text-green-700 dark:text-green-400 truncate">
                  {stationQuery}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setStationQuery("");
                    setStationOwnerId("");
                    setStationId("");
                  }}
                  className="ml-auto text-[10px] text-gray-400 hover:text-gray-600"
                >
                  Change
                </button>
              </div>
            )}
            {/* Manual ID entry fallback */}
            {showManualIds &&
              !stationOwnerId &&
              stationQuery.length >= 2 &&
              !stationSearching && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertCircle size={14} />
                    No stations found by search. Enter the IDs from your access
                    link.
                  </p>
                  <input
                    type="text"
                    value={stationOwnerId}
                    onChange={(e) => setStationOwnerId(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:text-white"
                    placeholder="Station Owner ID"
                  />
                  <input
                    type="text"
                    value={stationId}
                    onChange={(e) => setStationId(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:text-white"
                    placeholder="Station ID"
                  />
                </div>
              )}
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="text-xs text-gray-500 mb-1 block">Username</label>
            <div className="relative">
              <User
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-white"
                placeholder="Enter your username"
                autoComplete="username"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Password</label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-white"
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 fp-icon-only"
            title="Sign in"
            aria-label="Sign in"
          >
            <LogIn size={18} />
            {loading ? "Logging in…" : "Access Station"}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Enter the credentials provided by your station owner. If you don't
          have them, ask the owner to create an access code for you in the Team
          Manager tab.
        </p>
      </div>
    </div>
  );
}

// --- Read-only viewer helper components ---

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: "green" | "blue" | "indigo" | "purple";
}) {
  const colorMap = {
    green: "bg-green-500/10 text-green-600",
    blue: "bg-blue-500/10 text-blue-600",
    indigo: "bg-indigo-500/10 text-indigo-600",
    purple: "bg-purple-500/10 text-purple-600",
  };
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorMap[color]}`}
        >
          <Icon size={16} />
        </div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold dark:text-white">{value}</p>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold dark:text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Table({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px]">
        <thead>
          <tr className="text-left">
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-400 font-semibold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 text-center py-6">{text}</p>;
}
