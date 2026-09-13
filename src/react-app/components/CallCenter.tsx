import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone,
  Plus,
  Mic,
  Search,
  Users,
  Clock,
  Trash2,
  Headphones,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

const CLOUD_CALLS_KEY = "call_center_calls";
const CLOUD_QUEUES_KEY = "call_center_queues";
const CLOUD_FOLLOW_KEY = "call_center_followups";
const CLOUD_REC_KEY = "call_center_recordings";
const STORAGE_CALLS = "fuelpro_call_center_calls_v2";
const STORAGE_QUEUES = "fuelpro_call_center_queues_v2";

type CallDirection = "inbound" | "outbound";
type CallStatus = "ringing" | "in-progress" | "completed" | "missed" | "failed";
type CallOutcome =
  "resolved" | "follow-up" | "voicemail" | "abandoned" | "not-set";

interface CallLog {
  id: string;
  contactName: string;
  phone: string;
  direction: CallDirection;
  status: CallStatus;
  outcome: CallOutcome;
  durationSec: number;
  agent: string;
  notes: string;
  queueName: string;
  startedAt: string;
  stationId: string;
}

interface CallQueue {
  id: string;
  name: string;
  greeting: string;
  routing: "ring-all" | "round-robin";
  members: string[];
  ivrDigits: string;
  enabled: boolean;
  createdAt: string;
  stationId: string;
}

interface FollowUp {
  id: string;
  contactName: string;
  phone: string;
  note: string;
  dueAt: string;
  done: boolean;
  createdAt: string;
  stationId: string;
}

interface Recording {
  id: string;
  callId: string;
  contactName: string;
  phone: string;
  durationSec: number;
  url: string;
  createdAt: string;
  stationId: string;
}

const VALID_STATUSES: CallStatus[] = [
  "ringing",
  "in-progress",
  "completed",
  "missed",
  "failed",
];
const VALID_OUTCOMES: CallOutcome[] = [
  "resolved",
  "follow-up",
  "voicemail",
  "abandoned",
  "not-set",
];

const STATUS_META: Record<CallStatus, { label: string; cls: string }> = {
  ringing: {
    label: "Ringing",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  "in-progress": {
    label: "In progress",
    cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  missed: {
    label: "Missed",
    cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  },
  failed: {
    label: "Failed",
    cls: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
  },
};

const OUTCOME_META: Record<CallOutcome, { label: string; cls: string }> = {
  resolved: {
    label: "Resolved",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  "follow-up": {
    label: "Follow-up",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  voicemail: {
    label: "Voicemail",
    cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  },
  abandoned: {
    label: "Abandoned",
    cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  },
  "not-set": {
    label: "Not set",
    cls: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
  },
};

function durLabel(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function normalizeCall(c: Partial<CallLog> | null | undefined): CallLog {
  const id =
    c?.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    contactName: c?.contactName ?? "",
    phone: c?.phone ?? "",
    direction: c?.direction === "outbound" ? "outbound" : "inbound",
    status: VALID_STATUSES.includes(c?.status as CallStatus)
      ? (c!.status as CallStatus)
      : "completed",
    outcome: VALID_OUTCOMES.includes(c?.outcome as CallOutcome)
      ? (c!.outcome as CallOutcome)
      : "not-set",
    durationSec: typeof c?.durationSec === "number" ? c.durationSec : 0,
    agent: c?.agent ?? "",
    notes: c?.notes ?? "",
    queueName: c?.queueName ?? "",
    startedAt: c?.startedAt ?? new Date().toISOString(),
    stationId: c?.stationId ?? "default",
  };
}
function normalizeCalls(arr: unknown): CallLog[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => normalizeCall(c as Partial<CallLog>));
}

function normalizeQueue(q: Partial<CallQueue> | null | undefined): CallQueue {
  const id =
    q?.id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: q?.name ?? "",
    greeting: q?.greeting ?? "",
    routing: q?.routing === "round-robin" ? "round-robin" : "ring-all",
    members: Array.isArray(q?.members) ? q!.members.map(String) : [],
    ivrDigits: q?.ivrDigits ?? "",
    enabled: q?.enabled !== false,
    createdAt: q?.createdAt ?? new Date().toISOString(),
    stationId: q?.stationId ?? "default",
  };
}
function normalizeQueues(arr: unknown): CallQueue[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((q) => normalizeQueue(q as Partial<CallQueue>));
}

function normalizeFollowUp(f: Partial<FollowUp> | null | undefined): FollowUp {
  const id = f?.id || `fup_${Date.now()}_${Math.round(Math.random() * 1000)}`;
  return {
    id,
    contactName: f?.contactName ?? "",
    phone: f?.phone ?? "",
    note: f?.note ?? "",
    dueAt: f?.dueAt ?? "",
    done: f?.done === true,
    createdAt: f?.createdAt ?? new Date().toISOString(),
    stationId: f?.stationId ?? "default",
  };
}
function normalizeFollowUps(arr: unknown): FollowUp[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((f) => normalizeFollowUp(f as Partial<FollowUp>));
}

function normalizeRecording(
  r: Partial<Recording> | null | undefined,
): Recording {
  const id = r?.id || `rec_${Date.now()}_${Math.round(Math.random() * 1000)}`;
  return {
    id,
    callId: r?.callId ?? "",
    contactName: r?.contactName ?? "",
    phone: r?.phone ?? "",
    durationSec: typeof r?.durationSec === "number" ? r.durationSec : 0,
    url: r?.url ?? "",
    createdAt: r?.createdAt ?? new Date().toISOString(),
    stationId: r?.stationId ?? "default",
  };
}
function normalizeRecordings(arr: unknown): Recording[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => normalizeRecording(r as Partial<Recording>));
}

export default function CallCenter() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const [calls, setCalls] = useState<CallLog[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_CALLS_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeCalls(cached);
    try {
      const s = localStorage.getItem(STORAGE_CALLS);
      if (s) return normalizeCalls(JSON.parse(s));
    } catch {}
    return [];
  });
  const [queues, setQueues] = useState<CallQueue[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_QUEUES_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeQueues(cached);
    try {
      const s = localStorage.getItem(STORAGE_QUEUES);
      if (s) return normalizeQueues(JSON.parse(s));
    } catch {}
    return [];
  });
  const [followUps, setFollowUps] = useState<FollowUp[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_FOLLOW_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeFollowUps(cached);
    try {
      const s = localStorage.getItem("fuelpro_call_center_followups_v2");
      if (s) return normalizeFollowUps(JSON.parse(s));
    } catch {}
    return [];
  });
  const [recordings] = useState<Recording[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      CLOUD_REC_KEY,
      stationId,
    );
    if (Array.isArray(cached)) return normalizeRecordings(cached);
    return [];
  });

  const [activeView, setActiveView] = useState<
    "calls" | "queues" | "followups" | "recordings"
  >("calls");
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCallForm, setShowCallForm] = useState(false);
  const [callForm, setCallForm] = useState<Partial<CallLog>>({});
  const [showQueueForm, setShowQueueForm] = useState(false);
  const [queueForm, setQueueForm] = useState<Partial<CallQueue>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const localModifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const queuesRef = useRef(queues);
  queuesRef.current = queues;
  const followUpsRef = useRef(followUps);
  followUpsRef.current = followUps;

  const flagLocalModified = () => {
    localModifiedRef.current = true;
    if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    localModifiedTimer.current = setTimeout(() => {
      localModifiedRef.current = false;
    }, 3000);
  };

  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const [c, q, f] = await Promise.all([
          cloudStorageService.get<unknown[]>(CLOUD_CALLS_KEY, stationId),
          cloudStorageService.get<unknown[]>(CLOUD_QUEUES_KEY, stationId),
          cloudStorageService.get<unknown[]>(CLOUD_FOLLOW_KEY, stationId),
        ]);
        if (cancelled) return;
        if (!localModifiedRef.current) {
          if (c) setCalls(normalizeCalls(c));
          if (q) setQueues(normalizeQueues(q));
          if (f) setFollowUps(normalizeFollowUps(f));
        }
      } catch {}
      if (!cancelled) {
        cloudLoadCompleteRef.current = true;
        if (localModifiedRef.current) {
          cloudStorageService
            .set(CLOUD_CALLS_KEY, callsRef.current, stationId)
            .catch(() => {});
          cloudStorageService
            .set(CLOUD_QUEUES_KEY, queuesRef.current, stationId)
            .catch(() => {});
        }
      }
    })();
    const unsubC = cloudStorageService.subscribe<unknown[]>(
      CLOUD_CALLS_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && Array.isArray(val))
          setCalls(normalizeCalls(val));
      },
    );
    const unsubQ = cloudStorageService.subscribe<unknown[]>(
      CLOUD_QUEUES_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && Array.isArray(val))
          setQueues(normalizeQueues(val));
      },
    );
    return () => {
      cancelled = true;
      unsubC();
      unsubQ();
    };
  }, [user?.id, stationId]);

  useEffect(() => {
    if (!cloudLoadCompleteRef.current) return;
    try {
      localStorage.setItem(STORAGE_CALLS, JSON.stringify(calls));
      localStorage.setItem(STORAGE_QUEUES, JSON.stringify(queues));
    } catch {}
    cloudStorageService
      .set(CLOUD_CALLS_KEY, calls, stationId)
      .then(() => {
        localModifiedRef.current = false;
      })
      .catch(() => {});
    cloudStorageService
      .set(CLOUD_QUEUES_KEY, queues, stationId)
      .catch(() => {});
    cloudStorageService
      .set(CLOUD_FOLLOW_KEY, followUps, stationId)
      .catch(() => {});
    cloudStorageService
      .set(CLOUD_REC_KEY, recordings, stationId)
      .catch(() => {});
  }, [calls, queues, followUps, recordings, stationId]);

  const toast = (message: string, type: "success" | "warning" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const openNewCallForm = () => {
    setEditingId(null);
    setCallForm({
      contactName: "",
      phone: "",
      direction: "inbound",
      status: "completed",
      outcome: "resolved",
      durationSec: 0,
      agent: user?.email || "",
      notes: "",
      queueName: "",
    });
    setShowCallForm(true);
  };

  const handleSaveCall = () => {
    if (!callForm.phone && !callForm.contactName) {
      toast("Enter a phone number or contact name", "warning");
      return;
    }
    flagLocalModified();
    if (editingId) {
      setCalls(
        calls.map((c) => (c.id === editingId ? { ...c, ...callForm } : c)),
      );
      toast("Call updated");
    } else {
      setCalls([
        normalizeCall({
          ...callForm,
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          stationId: stationId || "default",
        }),
        ...calls,
      ]);
      toast("Call logged");
    }
    setShowCallForm(false);
  };

  const deleteCall = (id: string) => {
    flagLocalModified();
    setCalls(calls.filter((c) => c.id !== id));
    toast("Call deleted");
  };

  const openNewQueueForm = () => {
    setEditingId(null);
    setQueueForm({
      name: "",
      greeting: "",
      routing: "ring-all",
      members: [],
      ivrDigits: "",
      enabled: true,
    });
    setShowQueueForm(true);
  };

  const handleSaveQueue = () => {
    if (!queueForm.name) {
      toast("Queue name is required", "warning");
      return;
    }
    flagLocalModified();
    if (editingId) {
      setQueues(
        queues.map((q) => (q.id === editingId ? { ...q, ...queueForm } : q)),
      );
      toast("Queue updated");
    } else {
      setQueues([
        ...queues,
        normalizeQueue({
          ...queueForm,
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          stationId: stationId || "default",
        }),
      ]);
      toast("Queue created");
    }
    setShowQueueForm(false);
  };

  const toggleQueue = (id: string) => {
    flagLocalModified();
    setQueues(
      queues.map((q) => (q.id === id ? { ...q, enabled: !q.enabled } : q)),
    );
  };
  const deleteQueue = (id: string) => {
    flagLocalModified();
    setQueues(queues.filter((q) => q.id !== id));
    toast("Queue deleted");
  };

  const addFollowUp = (call: CallLog) => {
    flagLocalModified();
    const fu = normalizeFollowUp({
      contactName: call.contactName,
      phone: call.phone,
      note: call.notes || "Follow-up on missed call",
      dueAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      stationId: stationId || "default",
    });
    setFollowUps([fu, ...followUpsRef.current]);
    toast("Follow-up scheduled");
  };

  const toggleFollowUp = (id: string) => {
    flagLocalModified();
    setFollowUps(
      followUps.map((f) => (f.id === id ? { ...f, done: !f.done } : f)),
    );
  };
  const deleteFollowUp = (id: string) => {
    flagLocalModified();
    setFollowUps(followUps.filter((f) => f.id !== id));
    toast("Follow-up removed");
  };

  const filteredCalls = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return calls
      .filter((c) => {
        if (!q) return true;
        return c.contactName.toLowerCase().includes(q) || c.phone.includes(q);
      })
      .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  }, [calls, searchTerm]);

  const stats = useMemo(() => {
    const total = calls.length;
    const missed = calls.filter((c) => c.status === "missed").length;
    const resolved = calls.filter((c) => c.outcome === "resolved").length;
    const avgDur =
      total > 0 ? calls.reduce((s, c) => s + c.durationSec, 0) / total : 0;
    const ongoing = calls.filter((c) => c.status === "in-progress").length;
    return { total, missed, resolved, ongoing, avgDur };
  }, [calls]);

  return (
    <div className="w-full">
      {notification && (
        <div
          className={`mb-3 px-4 py-2.5 rounded-lg text-sm font-medium ${notification.type === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"}`}
        >
          {notification.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Headphones size={20} className="text-amber-500" /> Call Center
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Browser softphone, queues &amp; IVR, call history and recordings
          </p>
        </div>
        <div className="flex gap-2">
          {(["calls", "queues", "followups", "recordings"] as const).map(
            (v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeView === v ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"}`}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search calls..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
        {activeView === "calls" && (
          <button
            onClick={openNewCallForm}
            className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
          >
            <Plus size={16} /> Log Call
          </button>
        )}
        {activeView === "queues" && (
          <button
            onClick={openNewQueueForm}
            className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
          >
            <Plus size={16} /> New Queue
          </button>
        )}
      </div>

      {activeView === "calls" && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Total Calls
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.total}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Missed
            </div>
            <div className="text-2xl font-bold text-red-500">
              {stats.missed}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Resolved
            </div>
            <div className="text-2xl font-bold text-emerald-500">
              {stats.resolved}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Ongoing
            </div>
            <div className="text-2xl font-bold text-blue-500">
              {stats.ongoing}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Avg Duration
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {durLabel(Math.round(stats.avgDur))}
            </div>
          </div>
        </div>
      )}

      {activeView === "calls" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left">Contact</th>
                  <th className="px-3 py-2.5 text-left">Direction</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Outcome</th>
                  <th className="px-3 py-2.5 text-right">Duration</th>
                  <th className="px-3 py-2.5 text-left">Agent</th>
                  <th className="px-3 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredCalls.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-10 text-center text-gray-500 dark:text-gray-400"
                    >
                      <Phone size={24} className="mx-auto mb-2 opacity-40" /> No
                      calls yet — log your first call.
                    </td>
                  </tr>
                )}
                {filteredCalls.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {c.contactName || "Unknown"}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {c.phone}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.direction === "inbound" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"}`}
                      >
                        {c.direction === "inbound" ? "Inbound" : "Outbound"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_META[c.status].cls}`}
                      >
                        {STATUS_META[c.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${OUTCOME_META[c.outcome].cls}`}
                      >
                        {OUTCOME_META[c.outcome].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white">
                      {durLabel(c.durationSec)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">
                      {c.agent || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {c.status === "missed" && (
                          <button
                            onClick={() => addFollowUp(c)}
                            title="Schedule follow-up"
                            className="p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-500"
                          >
                            <Mic size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingId(c.id);
                            setCallForm(c);
                            setShowCallForm(true);
                          }}
                          title="Edit"
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteCall(c.id)}
                          title="Delete"
                          className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 dark:text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === "queues" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {queues.length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-500 dark:text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-40" /> No queues
              yet — create one to route incoming calls.
            </div>
          )}
          {queues.map((q) => (
            <div
              key={q.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                  <Phone size={15} className="text-amber-500" /> {q.name}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleQueue(q.id)}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${q.enabled ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-gray-400"}`}
                  >
                    {q.enabled ? "Active" : "Paused"}
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(q.id);
                      setQueueForm(q);
                      setShowQueueForm(true);
                    }}
                    className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => deleteQueue(q.id)}
                    className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div>
                  Routing:{" "}
                  {q.routing === "ring-all" ? "Ring all" : "Round-robin"}
                </div>
                {q.ivrDigits && <div>IVR digit: {q.ivrDigits}</div>}
                <div>
                  Members:{" "}
                  {q.members.length > 0 ? q.members.join(", ") : "none yet"}
                </div>
                {q.greeting && (
                  <div className="truncate">Greeting: "{q.greeting}"</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeView === "followups" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Clock size={16} className="text-amber-500" /> Missed-call
            Follow-ups
          </h3>
          {followUps.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
              No follow-ups scheduled.
            </p>
          ) : (
            <div className="space-y-2">
              {followUps.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {f.contactName || f.phone}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {f.note} · due {f.dueAt || "—"}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleFollowUp(f.id)}
                      className={`text-[10px] px-2 py-1 rounded-full font-medium ${f.done ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}
                    >
                      {f.done ? "Done" : "Pending"}
                    </button>
                    <button
                      onClick={() => deleteFollowUp(f.id)}
                      className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeView === "recordings" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Mic size={16} className="text-amber-500" /> Searchable Recordings
          </h3>
          {recordings.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
              No recordings yet — completed calls with a recording will appear
              here.
            </p>
          ) : (
            <div className="space-y-2">
              {recordings.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {r.contactName || r.phone}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {durLabel(r.durationSec)} · {r.createdAt.slice(0, 10)}
                    </div>
                  </div>
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-gray-900 text-xs font-medium"
                    >
                      Play
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCallForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowCallForm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? "Edit" : "Log"} Call
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Contact Name
                  </label>
                  <input
                    value={callForm.contactName}
                    onChange={(e) =>
                      setCallForm({ ...callForm, contactName: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Phone *
                  </label>
                  <input
                    value={callForm.phone}
                    onChange={(e) =>
                      setCallForm({ ...callForm, phone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="+254712345678"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Direction
                  </label>
                  <select
                    value={callForm.direction}
                    onChange={(e) =>
                      setCallForm({
                        ...callForm,
                        direction: e.target.value as CallDirection,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="inbound">Inbound (received)</option>
                    <option value="outbound">Outbound (made)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Status
                  </label>
                  <select
                    value={callForm.status}
                    onChange={(e) =>
                      setCallForm({
                        ...callForm,
                        status: e.target.value as CallStatus,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {VALID_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Outcome
                  </label>
                  <select
                    value={callForm.outcome}
                    onChange={(e) =>
                      setCallForm({
                        ...callForm,
                        outcome: e.target.value as CallOutcome,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {VALID_OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {OUTCOME_META[o].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Duration (seconds)
                  </label>
                  <input
                    type="number"
                    value={callForm.durationSec || ""}
                    onChange={(e) =>
                      setCallForm({
                        ...callForm,
                        durationSec: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Notes
                </label>
                <textarea
                  value={callForm.notes}
                  onChange={(e) =>
                    setCallForm({ ...callForm, notes: e.target.value })
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <button
                onClick={handleSaveCall}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
              >
                <Phone size={16} /> Save Call
              </button>
            </div>
          </div>
        </div>
      )}

      {showQueueForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowQueueForm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editingId ? "Edit" : "New"} Call Queue
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Queue Name *
                </label>
                <input
                  value={queueForm.name}
                  onChange={(e) =>
                    setQueueForm({ ...queueForm, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Sales"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    Routing
                  </label>
                  <select
                    value={queueForm.routing}
                    onChange={(e) =>
                      setQueueForm({
                        ...queueForm,
                        routing: e.target.value as "ring-all" | "round-robin",
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="ring-all">Ring all</option>
                    <option value="round-robin">Round-robin</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                    IVR digit (1-9)
                  </label>
                  <input
                    value={queueForm.ivrDigits}
                    onChange={(e) =>
                      setQueueForm({ ...queueForm, ivrDigits: e.target.value })
                    }
                    maxLength={1}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="1"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Greeting message
                </label>
                <input
                  value={queueForm.greeting}
                  onChange={(e) =>
                    setQueueForm({ ...queueForm, greeting: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Thank you for calling..."
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Members (comma-separated names)
                </label>
                <input
                  value={(queueForm.members || []).join(", ")}
                  onChange={(e) =>
                    setQueueForm({
                      ...queueForm,
                      members: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Alice, Bob"
                />
              </div>
              <button
                onClick={handleSaveQueue}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all"
              >
                Save Queue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
