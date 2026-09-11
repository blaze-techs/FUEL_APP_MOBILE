/**
 * SessionInspectorSection — cloud-backed, real-time user session inspector.
 * List active sessions with device/browser/os/ip/location, revoke single
 * sessions, revoke all sessions, and view stats (active count, by device).
 */

import { useMemo, useState } from "react";
import {
  Monitor,
  Smartphone,
  Tablet,
  Search,
  LogOut,
  Users,
  Activity,
  Globe,
} from "lucide-react";
import type {
  UserSession,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import { SectionHeader, IconBtn, EmptyState } from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

const DEVICE_ICON: Record<UserSession["device"], React.ElementType> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

const DEVICE_COLOR: Record<UserSession["device"], string> = {
  desktop: "text-blue-400",
  mobile: "text-green-400",
  tablet: "text-purple-400",
};

export default function SessionInspectorSection({ store, logAudit }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return store.sessions.filter((s) => {
      if (!q) return true;
      return (
        s.email.toLowerCase().includes(q) ||
        s.browser.toLowerCase().includes(q) ||
        s.os.toLowerCase().includes(q) ||
        s.ip.toLowerCase().includes(q) ||
        (s.location ?? "").toLowerCase().includes(q)
      );
    });
  }, [store.sessions, search]);

  const stats = useMemo(() => {
    const active = store.sessions.filter((s) => s.active).length;
    const byDevice = {
      desktop: store.sessions.filter((s) => s.device === "desktop" && s.active)
        .length,
      mobile: store.sessions.filter((s) => s.device === "mobile" && s.active)
        .length,
      tablet: store.sessions.filter((s) => s.device === "tablet" && s.active)
        .length,
    };
    return { active, byDevice };
  }, [store.sessions]);

  const handleRevoke = (s: UserSession) => {
    if (!confirm(`Revoke session for "${s.email}"?`)) return;
    store.revokeSession(s.id);
    logAudit("Session Revoked", `"${s.email}" (${s.device})`, "warning");
  };

  const handleRevokeAll = () => {
    const n = store.sessions.filter((s) => s.active).length;
    if (n === 0) return;
    if (!confirm(`Revoke ALL ${n} active session(s)?`)) return;
    store.revokeAllSessions();
    logAudit("All Sessions Revoked", `${n} sessions`, "danger");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Users}
        title="Session Inspector"
        subtitle="Active user sessions — real-time synced across devices"
        count={store.sessions.length}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Active"
          value={stats.active}
          icon={Activity}
          color="text-green-400"
        />
        <StatCard
          label="Desktop"
          value={stats.byDevice.desktop}
          icon={Monitor}
          color="text-blue-400"
        />
        <StatCard
          label="Mobile"
          value={stats.byDevice.mobile}
          icon={Smartphone}
          color="text-green-400"
        />
        <StatCard
          label="Tablet"
          value={stats.byDevice.tablet}
          icon={Tablet}
          color="text-purple-400"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email, browser, ip..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <button
          onClick={handleRevokeAll}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm border border-red-500/20"
        >
          <LogOut size={16} /> Revoke All
        </button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={Users} text="No sessions found" />
        )}
        {filtered.map((s) => {
          const DeviceIcon = DEVICE_ICON[s.device];
          return (
            <div
              key={s.id}
              className={`rounded-xl bg-white/5 border p-4 ${s.active ? "border-white/10" : "border-white/5 opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <DeviceIcon size={16} className={DEVICE_COLOR[s.device]} />
                    <span className="text-sm font-medium text-white truncate">
                      {s.email}
                    </span>
                    {s.active ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        active
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400 flex-wrap">
                    <span>{s.browser}</span>
                    <span>·</span>
                    <span>{s.os}</span>
                    <span>·</span>
                    <span className="font-mono">{s.ip}</span>
                    {s.location && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Globe size={10} /> {s.location}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                    <span>Login: {new Date(s.loginAt).toLocaleString()}</span>
                    <span>
                      Last active: {new Date(s.lastActiveAt).toLocaleString()}
                    </span>
                    {s.tokenExpiresAt && (
                      <span>
                        Expires: {new Date(s.tokenExpiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn
                    title="Revoke session"
                    onClick={() => handleRevoke(s)}
                  >
                    <LogOut size={15} className="text-red-400" />
                  </IconBtn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} className={color} />
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
