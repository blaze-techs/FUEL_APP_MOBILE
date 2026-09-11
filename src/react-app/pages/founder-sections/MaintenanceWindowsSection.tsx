/**
 * MaintenanceWindowsSection — cloud-backed, real-time maintenance window
 * scheduling. CRUD windows with schedule, message, affected services, banner
 * toggle, active toggle, and live banner preview.
 */

import { useState } from "react";
import {
  Wrench,
  Plus,
  X,
  Trash2,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import type {
  MaintenanceWindow,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import {
  SectionHeader,
  Field,
  IconBtn,
  EmptyState,
} from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function MaintenanceWindowsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [showBanner, setShowBanner] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState("");

  const reset = () => {
    setTitle("");
    setMessage("");
    setStartsAt("");
    setEndsAt("");
    setShowBanner(true);
    setServices([]);
    setNewService("");
    setEditingId(null);
  };

  const save = () => {
    if (!title.trim() || !startsAt || !endsAt) return;
    const existing = store.maintenanceWindows.find((m) => m.id === editingId);
    const m: MaintenanceWindow = {
      id: editingId ?? store.uid(),
      title: title.trim(),
      message: message.trim(),
      startsAt,
      endsAt,
      active: existing?.active ?? true,
      showBanner,
      affectedServices: services,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    store.upsertMaintenance(m);
    logAudit(
      editingId ? "Maintenance Window Updated" : "Maintenance Window Created",
      `"${m.title}"`,
      "warning",
    );
    reset();
    setShowAdd(false);
  };

  const handleDelete = (m: MaintenanceWindow) => {
    if (!confirm(`Delete maintenance window "${m.title}"?`)) return;
    store.deleteMaintenance(m.id);
    logAudit("Maintenance Window Deleted", `"${m.title}"`, "warning");
  };

  const isActive = (m: MaintenanceWindow) => {
    if (!m.active) return false;
    const now = new Date();
    return new Date(m.startsAt) <= now && new Date(m.endsAt) >= now;
  };

  const isUpcoming = (m: MaintenanceWindow) =>
    m.active && new Date(m.startsAt) > new Date();

  const addService = () => {
    if (newService.trim()) {
      setServices([...services, newService.trim()]);
      setNewService("");
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Wrench}
        title="Maintenance Windows"
        subtitle="Schedule downtime and show banners — real-time synced"
        count={store.maintenanceWindows.length}
      />

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Window
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Window" : "New Maintenance Window"}
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Database upgrade"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <Field label="Message">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="The app will be briefly unavailable..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white resize-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Ends">
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
          </div>
          <Field label="Affected services">
            <div className="flex gap-2">
              <input
                value={newService}
                onChange={(e) => setNewService(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.preventDefault(), addService())
                }
                placeholder="e.g. Payments, API"
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
              <button
                onClick={addService}
                className="px-3 py-2 rounded-lg bg-white/10 text-white text-sm"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {services.map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-300 flex items-center gap-1"
                >
                  {s}
                  <button
                    onClick={() => setServices(services.filter((x) => x !== s))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={showBanner}
              onChange={(e) => setShowBanner(e.target.checked)}
              className="accent-amber-500"
            />
            Show banner to users
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              {editingId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {store.maintenanceWindows.length === 0 && (
          <EmptyState icon={Wrench} text="No maintenance windows scheduled" />
        )}
        {store.maintenanceWindows.map((m) => (
          <div
            key={m.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {m.title}
                  </span>
                  {isActive(m) ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                      <AlertTriangle size={10} /> Active Now
                    </span>
                  ) : isUpcoming(m) ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex items-center gap-1">
                      <CalendarClock size={10} /> Upcoming
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                      {m.active ? "Scheduled" : "Inactive"}
                    </span>
                  )}
                </div>
                {m.message && (
                  <p className="text-xs text-gray-400 mt-1">{m.message}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                  <span>From: {new Date(m.startsAt).toLocaleString()}</span>
                  <span>To: {new Date(m.endsAt).toLocaleString()}</span>
                  {m.showBanner && <span>Banner: ON</span>}
                </div>
                {m.affectedServices.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {m.affectedServices.map((s) => (
                      <span
                        key={s}
                        className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-gray-400"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn
                  title={m.active ? "Deactivate" : "Activate"}
                  onClick={() => store.toggleMaintenance(m.id)}
                >
                  <Wrench
                    size={15}
                    className={m.active ? "text-amber-400" : "text-gray-500"}
                  />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(m)}>
                  <Trash2 size={15} className="text-red-400" />
                </IconBtn>
              </div>
            </div>
            {m.showBanner && m.active && (
              <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                🚧 {m.title}: {m.message || "Maintenance in progress."}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
