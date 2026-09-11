/**
 * TerminalSessions.tsx
 * Terminal sessions: open/close shifts, cash reconciliation, variance.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  X,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
  ShoppingCart,
  ClipboardList,
  BarChart3,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { supabase } from "@/supabase/client";
import { formatMoney as fmtMoney } from "../lib/currency";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import ShiftHandoverChecklist from "@/react-app/components/ShiftHandoverChecklist";
import GiftVoucherRegister from "@/react-app/components/GiftVoucherRegister";
import DiscountApprovalQueue from "@/react-app/components/DiscountApprovalQueue";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  openTerminalSession,
  closeTerminalSession,
} from "@/react-app/lib/pos-service";

const safeMoney = (amount: number | null | undefined) =>
  fmtMoney(Number.isFinite(amount as number) ? (amount as number) : 0);

export default function TerminalSessions() {
  const { currentStation } = useStations();
  const [sessions, setSessions] = useState<any[]>([]);
  const [openSession, setOpenSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingSession, setClosingSession] = useState<any>(null);
  const [openingCash, setOpeningCash] = useState(0);
  const [countedCash, setCountedCash] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!currentStation?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("terminal_sessions")
        .select("*")
        .eq("station_id", currentStation.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        console.error("Failed to load terminal sessions:", error.message);
        setSessions([]);
        setOpenSession(null);
      } else {
        setSessions(data || []);
        setOpenSession(data?.find((s) => s.status === "open") || null);
      }
    } catch (error) {
      console.error("Failed:", error);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [currentStation?.id]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Realtime: refresh when a session is opened/closed on another device.
  // Respects the global Realtime kill-switch (egress saver).
  useEffect(() => {
    if (!currentStation?.id) return;
    if (!cloudStorageService.isRealtimeEnabled()) return;
    const channel = supabase
      .channel(`terminal_sessions:${currentStation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "terminal_sessions",
          filter: `station_id=eq.${currentStation.id}`,
        },
        () => loadSessions(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentStation?.id, loadSessions]);

  const handleOpenSession = async () => {
    if (!currentStation?.id) return;
    setLoading(true);
    setError(null);
    try {
      await openTerminalSession(currentStation.id, openingCash);
      setShowOpenModal(false);
      setOpeningCash(0);
      loadSessions();
    } catch (err: any) {
      console.error("Failed:", err);
      setError(err?.message || "Failed to open session");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSession = async () => {
    if (!closingSession) return;
    setLoading(true);
    setError(null);
    try {
      const result = await closeTerminalSession(closingSession.id, countedCash);
      if (result.success) {
        setShowCloseModal(false);
        setClosingSession(null);
        setCountedCash(0);
        loadSessions();
      } else {
        setError(result.error || "Failed to close session");
      }
    } catch (err: any) {
      console.error("Failed:", err);
      setError(err?.message || "Failed to close session");
    } finally {
      setLoading(false);
    }
  };

  const openSessionsTotal = openSession
    ? (openSession.cash_sales || 0) +
      (openSession.mpesa_sales || 0) +
      (openSession.card_sales || 0) +
      (openSession.opening_cash || 0)
    : 0;

  if (loading) {
    return (
      <div className="flex justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
          Terminal Sessions
        </h1>
        {!openSession && (
          <button
            onClick={() => setShowOpenModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-gray-900 dark:text-gray-900 dark:text-white rounded-xl"
          >
            <Plus size={20} /> Open Session
          </button>
        )}
      </div>

      {/* Summary Stats */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
            <p className="text-[10px] text-gray-500">Total Sessions</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {sessions.length}
            </p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Open</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {sessions.filter((s) => s.status === "open").length}
            </p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Closed</p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {sessions.filter((s) => s.status === "closed").length}
            </p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-3">
            <p className="text-[10px] text-gray-500">Total Sales</p>
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
              {safeMoney(
                sessions.reduce(
                  (sum, s) =>
                    sum +
                    (typeof s.total_sales === "number"
                      ? s.total_sales
                      : Number(s.total_sales) || 0),
                  0,
                ),
              )}
            </p>
          </div>
        </div>
      )}

      {/* Cross-tab interlinks — quick navigation to related tabs */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 hover:text-red-300"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => switchToTab("pos")}
          className="bg-slate-700/60 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-600"
        >
          <ShoppingCart size={14} />
          Point of Sale
        </button>
        <button
          onClick={() => switchToTab("sales")}
          className="bg-slate-700/60 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-600"
        >
          <ClipboardList size={14} />
          Sales Tracking
        </button>
        <button
          onClick={() => switchToTab("reports")}
          className="bg-slate-700/60 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs border border-slate-600"
        >
          <BarChart3 size={14} />
          Reports Center
        </button>
      </div>

      {/* Active Session */}
      {openSession && (
        <div className="bg-gradient-to-r from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-emerald-400 font-semibold">
              Session Active
            </span>
            <span className="text-gray-500 dark:text-gray-500 dark:text-gray-400">
              •
            </span>
            <span className="text-gray-300">{openSession.session_number}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-xs mb-1">
                Opening Cash
              </p>
              <p className="text-gray-900 dark:text-gray-900 dark:text-white font-medium">
                {safeMoney(openSession.opening_cash)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-xs mb-1">
                Cash Sales
              </p>
              <p className="text-emerald-400 font-medium">
                {safeMoney(openSession.cash_sales)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-xs mb-1">
                M-PESA
              </p>
              <p className="text-blue-400 font-medium">
                {safeMoney(openSession.mpesa_sales)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-xs mb-1">
                Card
              </p>
              <p className="text-purple-400 font-medium">
                {safeMoney(openSession.card_sales)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-emerald-500/20">
            <div>
              <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-sm">
                Expected Cash
              </p>
              <p className="text-gray-900 dark:text-gray-900 dark:text-white text-2xl font-bold">
                {safeMoney(openSessionsTotal)}
              </p>
            </div>
            <button
              onClick={() => {
                setClosingSession(openSession);
                setShowCloseModal(true);
              }}
              className="px-6 py-3 bg-red-500 hover:bg-red-600 text-gray-900 dark:text-gray-900 dark:text-white font-medium rounded-xl"
            >
              Close Session
            </button>
          </div>
        </div>
      )}

      {/* Session History */}
      <div className="bg-gray-50 dark:bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-white/10">
          <h3 className="text-gray-900 dark:text-gray-900 dark:text-white font-semibold">
            Session History
          </h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-400 px-4 py-3">
                Session
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-400 px-4 py-3">
                Opened
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-400 px-4 py-3">
                Closed
              </th>
              <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-400 px-4 py-3">
                Sales
              </th>
              <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-400 px-4 py-3">
                Variance
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-500 dark:text-gray-400 px-4 py-3">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.filter((s) => s.status !== "open").length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-500 dark:text-gray-400">
                    No session history
                  </p>
                </td>
              </tr>
            ) : (
              sessions
                .filter((s) => s.status !== "open")
                .map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-white/5 hover:bg-gray-50 dark:bg-white/5"
                  >
                    <td className="px-4 py-4 text-gray-900 dark:text-gray-900 dark:text-white font-medium">
                      {session.session_number}
                    </td>
                    <td className="px-4 py-4 text-gray-300 text-sm">
                      {new Date(session.opening_time).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-gray-300 text-sm">
                      {session.closing_time
                        ? new Date(session.closing_time).toLocaleString()
                        : "-"}
                    </td>
                    <td className="px-4 py-4 text-right text-amber-400 font-medium">
                      {safeMoney(session.total_sales)}
                    </td>
                    <td
                      className={`px-4 py-4 text-right font-medium ${session.variance > 0 ? "text-emerald-400" : session.variance < 0 ? "text-red-400" : "text-gray-300"}`}
                    >
                      {session.variance ? safeMoney(session.variance) : "-"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${session.status === "closed" ? "bg-gray-500/20 text-gray-500 dark:text-gray-500 dark:text-gray-400" : "bg-amber-500/20 text-amber-400"}`}
                      >
                        {session.status}
                      </span>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      {/* Open Session Modal */}
      {showOpenModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md border border-gray-200 dark:border-gray-200 dark:border-white/10">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                Open Session
              </h3>
              <button
                onClick={() => setShowOpenModal(false)}
                className="text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-gray-900 dark:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                  Opening Cash (Float)
                </label>
                <input
                  type="number"
                  value={openingCash ?? ""}
                  onChange={(e) =>
                    setOpeningCash(
                      e.target.value === ""
                        ? 0
                        : parseFloat(e.target.value) || 0,
                    )
                  }
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-gray-900 dark:text-white"
                  min="0"
                  placeholder="0"
                />
              </div>
              <button
                onClick={handleOpenSession}
                disabled={loading}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 text-gray-900 dark:text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <CheckCircle size={18} />
                )}{" "}
                Start Session
              </button>
            </div>
          </div>
        </div>
      )}

      <ShiftHandoverChecklist />
      <GiftVoucherRegister />
      <DiscountApprovalQueue />

      {/* Close Session Modal */}
      {showCloseModal && closingSession && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md border border-gray-200 dark:border-gray-200 dark:border-white/10">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                Close Session
              </h3>
              <button
                onClick={() => {
                  setShowCloseModal(false);
                  setClosingSession(null);
                }}
                className="text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-gray-900 dark:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-50 dark:bg-white/5 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-500 dark:text-gray-400">
                    Opening Cash
                  </span>
                  <span className="text-gray-900 dark:text-gray-900 dark:text-white">
                    {safeMoney(closingSession.opening_cash)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-500 dark:text-gray-400">
                    Cash Sales
                  </span>
                  <span className="text-gray-900 dark:text-gray-900 dark:text-white">
                    {safeMoney(closingSession.cash_sales)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-gray-300">Expected</span>
                  <span className="text-gray-900 dark:text-gray-900 dark:text-white">
                    {safeMoney(openSessionsTotal)}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-gray-500 dark:text-gray-500 dark:text-gray-400 text-xs mb-2 block">
                  Counted Cash
                </label>
                <input
                  type="number"
                  value={countedCash ?? ""}
                  onChange={(e) =>
                    setCountedCash(
                      e.target.value === ""
                        ? 0
                        : parseFloat(e.target.value) || 0,
                    )
                  }
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-gray-900 dark:text-white"
                  min="0"
                  placeholder="0"
                />
              </div>
              {countedCash !== openSessionsTotal && (
                <div
                  className={`flex items-center gap-2 p-3 rounded-lg ${countedCash > openSessionsTotal ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
                >
                  <AlertTriangle size={18} />
                  <span>
                    Variance: {safeMoney(countedCash - openSessionsTotal)}
                  </span>
                </div>
              )}
              <button
                onClick={handleCloseSession}
                disabled={loading}
                className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-600 text-gray-900 dark:text-gray-900 dark:text-white font-medium rounded-xl flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <CheckCircle size={18} />
                )}{" "}
                Close & Reconcile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
