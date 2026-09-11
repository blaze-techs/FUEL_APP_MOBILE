import { useState, useMemo } from "react";
import {
  Clock,
  Users,
  ArrowRight,
  AlertTriangle,
  Globe,
  Smartphone,
  Shield,
  CheckCircle2,
} from "lucide-react";
import {
  getTrial,
  getSubscription,
  checkTrialStatus,
  loadPayments,
} from "@/react-app/lib/subscription";

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function TrialAnalyticsSection({ logAudit }: Props) {
  const trial = getTrial();
  const sub = getSubscription();
  const trialStatus = checkTrialStatus();
  const payments = loadPayments();

  // Build funnel stages
  const funnel = useMemo(() => {
    const stages = [
      { label: "Trial Started", count: trial ? 1 : 0, color: "bg-blue-400" },
      {
        label: "Trial Active",
        count: trialStatus.active ? 1 : 0,
        color: "bg-green-400",
      },
      {
        label: "Trial Expired",
        count: trial && !trialStatus.active && !sub ? 1 : 0,
        color: "bg-amber-400",
      },
      {
        label: "Subscribed",
        count: sub?.status === "active" ? 1 : 0,
        color: "bg-purple-400",
      },
    ];
    const maxCount = Math.max(...stages.map((s) => s.count), 1);
    return stages.map((s) => ({ ...s, pct: (s.count / maxCount) * 100 }));
  }, [trial, trialStatus, sub]);

  const conversionRate = useMemo(() => {
    if (!trial) return 0;
    return sub?.status === "active" ? 100 : 0;
  }, [trial, sub]);

  const avgTimeToConvert = useMemo(() => {
    if (!trial || !sub) return "N/A";
    const trialStart = new Date(trial.trialStartedAt).getTime();
    const subStart = new Date(sub.createdAt).getTime();
    const diff = subStart - trialStart;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }, [trial, sub]);

  const trialRemaining = useMemo(() => {
    if (!trialStatus.active) return "Expired";
    const mins = Math.floor(trialStatus.remainingMs / 60000);
    const secs = Math.floor((trialStatus.remainingMs % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }, [trialStatus]);

  const abuseFlags = useMemo(() => {
    const flags: {
      label: string;
      level: "low" | "medium" | "high";
      desc: string;
    }[] = [];
    if (!trial) return flags;

    // Check if multiple attempts
    const abuseData = localStorage.getItem("fuelpro_trial_abuse");
    if (abuseData) {
      try {
        const data = JSON.parse(abuseData);
        if (data.length > 3)
          flags.push({
            label: "Multiple Signups",
            level: "medium",
            desc: `${data.length} fingerprint records detected`,
          });
      } catch {
        /* */
      }
    }

    // VPN detection hint
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes("America") || tz.includes("Europe")) {
      flags.push({
        label: "Timezone Mismatch",
        level: "low",
        desc: `Timezone ${tz} differs from selected region`,
      });
    }

    return flags;
  }, [trial]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Clock size={18} className="text-cyan-400" /> Trial Analytics
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Conversion funnel and abuse detection
          </p>
        </div>
      </div>

      {/* Trial Status Card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-gray-500">Trial Status</span>
            <Clock
              size={14}
              className={
                trialStatus.active ? "text-green-400" : "text-gray-600"
              }
            />
          </div>
          <p className="text-lg font-bold text-white">
            {trialStatus.active ? "Active" : trial ? "Expired" : "Not Started"}
          </p>
          <p className="text-[10px] text-gray-500 mt-1">
            Remaining: {trialRemaining}
          </p>
        </div>
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-gray-500">Conversion Rate</span>
            <Users size={14} className="text-purple-400" />
          </div>
          <p className="text-lg font-bold text-white">{conversionRate}%</p>
          <p className="text-[10px] text-gray-500 mt-1">
            {sub?.status === "active"
              ? "Converted to paid"
              : "Not yet converted"}
          </p>
        </div>
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-gray-500">Time to Convert</span>
            <ArrowRight size={14} className="text-amber-400" />
          </div>
          <p className="text-lg font-bold text-white">{avgTimeToConvert}</p>
          <p className="text-[10px] text-gray-500 mt-1">
            From trial start to subscription
          </p>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4">
          Conversion Funnel
        </h3>
        <div className="space-y-3">
          {funnel.map((stage, i) => (
            <div key={stage.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">
                  {i + 1}. {stage.label}
                </span>
                <span className="text-white font-medium">{stage.count}</span>
              </div>
              <div className="h-6 bg-white/5 rounded-lg overflow-hidden">
                <div
                  className={`h-full ${stage.color} rounded-lg flex items-center px-3 transition-all`}
                  style={{ width: `${Math.max(stage.pct, 5)}%` }}
                >
                  <span className="text-[10px] text-white font-medium">
                    {stage.count > 0 ? stage.count : ""}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Abuse Detection */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <Shield size={14} className="text-red-400" /> Abuse Detection
        </h3>
        {abuseFlags.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 size={14} /> No abuse flags detected. Trial usage
            appears legitimate.
          </div>
        ) : (
          <div className="space-y-2">
            {abuseFlags.map((flag, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 p-3 rounded-lg ${flag.level === "high" ? "bg-red-500/5 border border-red-500/20" : flag.level === "medium" ? "bg-amber-500/5 border border-amber-500/20" : "bg-blue-500/5 border border-blue-500/20"}`}
              >
                <AlertTriangle
                  size={14}
                  className={
                    flag.level === "high"
                      ? "text-red-400"
                      : flag.level === "medium"
                        ? "text-amber-400"
                        : "text-blue-400"
                  }
                />
                <div>
                  <p className="text-xs text-white">{flag.label}</p>
                  <p className="text-[10px] text-gray-500">{flag.desc}</p>
                </div>
                <span
                  className={`ml-auto text-[10px] px-2 py-0.5 rounded ${flag.level === "high" ? "bg-red-500/10 text-red-400" : flag.level === "medium" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}
                >
                  {flag.level}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trial Details */}
      {trial && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white mb-3">
            Trial Record Details
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              { label: "User ID", value: trial.userId.slice(0, 20) + "..." },
              { label: "Email", value: trial.email },
              {
                label: "Started",
                value: new Date(trial.trialStartedAt).toLocaleString(),
              },
              {
                label: "Device FP",
                value: trial.deviceFingerprint.slice(0, 16) + "...",
              },
              { label: "IP Hash", value: trial.ipHash },
              { label: "Verified", value: trial.verified ? "Yes" : "No" },
              { label: "Used", value: trial.trialUsed ? "Yes" : "No" },
            ].map((d) => (
              <div
                key={d.label}
                className="flex justify-between py-1 border-b border-white/[0.04]"
              >
                <span className="text-gray-500">{d.label}</span>
                <span className="text-gray-300 font-mono">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
