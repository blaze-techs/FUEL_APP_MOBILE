import { useState, useEffect, useCallback, useRef } from "react";
import {
  Lock,
  User,
  LogIn,
  Shield,
  AlertCircle,
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
import { redeemCompanyGrant } from "@/react-app/lib/company-grant-service";
import {
  getStationSnapshot,
  type StationSnapshot,
} from "@/react-app/lib/station-snapshot-service";
import MemberPortal from "@/react-app/components/MemberPortal";

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

  // Station search (lookup by name/code instead of manual UUID entry).
  const [stationQuery, setStationQuery] = useState("");
  const [stationResults, setStationResults] = useState<StationLookupResult[]>(
    [],
  );
  const [stationSearching, setStationSearching] = useState(false);
  const [showManualIds, setShowManualIds] = useState(false);
  // QR-grant redemption state (a shared Company QR link carries ?grant=).
  const [grantCode, setGrantCode] = useState("");
  const [grantRedeeming, setGrantRedeeming] = useState(false);
  const grantedRef = useRef(false);

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
    const grant = params.get("grant");
    if (grant) setGrantCode(grant);
  }, []);

  // Auto-redeem a Company QR grant passed via the URL (?grant=<code>). This
  // is the "scan the QR / tap the shared link" flow — no account, no
  // password. The unauthenticated member redeems via the SECURITY DEFINER
  // RPC; on success we switch straight to the read-only snapshot viewer.
  useEffect(() => {
    if (!grantCode || grantedRef.current) return;
    setGrantRedeeming(true);
    setError("");
    redeemCompanyGrant(grantCode)
      .then((res) => {
        if (!res) {
          setError(
            "This link is invalid, expired, or has been revoked by the station owner.",
          );
          return;
        }
        grantedRef.current = true;
        const session: StationAccessSession = {
          accessCodeId: `grant_${res.grantId}`,
          method: "qr-grant",
          memberName: res.memberName,
          memberRole: res.memberRole,
          allowedTabs: res.allowedTabs,
          readOnly: res.readOnly,
          accessMode: res.accessMode,
          stationId: res.stationId,
          stationOwnerId: res.stationOwnerId,
          loginTime: Date.now(),
          grantExpiresAt: res.expiresAt
            ? new Date(res.expiresAt).getTime()
            : null,
        };
        localStorage.setItem(
          "fuelpro_station_access_session",
          JSON.stringify(session),
        );
        setSession(session);
      })
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : "This link could not be redeemed.",
        );
      })
      .finally(() => setGrantRedeeming(false));
  }, [grantCode, setGrantRedeeming, setError, setSession]);

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

  if (session) {
    return (
      <MemberPortal
        session={session}
        snapshot={snapshot}
        snapshotLoading={snapshotLoading}
        onRefresh={() => loadSnapshot(session.stationId)}
        onLogout={handleLogout}
      />
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

        {/* QR-grant redemption (a shared Company QR link carries ?grant=) */}
        {grantCode && !session && (
          <div className="mb-4 px-3 py-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <Shield size={13} className="shrink-0" />
              {grantRedeeming
                ? "Verifying your access link…"
                : "You've been granted access via a secure QR link."}
            </p>
            {grantRedeeming && (
              <span className="mt-2 block w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
            )}
            {error && !grantRedeeming && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">
                {error}
              </p>
            )}
            {!grantRedeeming && error && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setGrantCode("");
                }}
                className="mt-1 text-[11px] underline text-gray-500"
              >
                Clear link and sign in with a username instead
              </button>
            )}
          </div>
        )}

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
