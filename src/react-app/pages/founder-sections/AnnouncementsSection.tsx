/**
 * AnnouncementsSection — cloud-backed, real-time broadcast/announcement management.
 * CRUD announcements with type, target audience, scheduling, dismissibility,
 * active toggle, dismiss tracking, and live preview.
 */

import { useState } from "react";
import {
  Bell,
  Plus,
  X,
  Trash2,
  Eye,
  CheckCircle2,
  Megaphone,
} from "lucide-react";
import type {
  AnnouncementConfig,
  AnnouncementType,
  AnnouncementTarget,
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

const TYPE_STYLES: Record<AnnouncementType, string> = {
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  success: "bg-green-500/20 text-green-400 border-green-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  danger: "bg-red-500/20 text-red-400 border-red-500/30",
};

const TARGET_LABELS: Record<AnnouncementTarget, string> = {
  all: "All Users",
  founders: "Founders Only",
  users: "All Users",
  station: "Station Users",
};

export default function AnnouncementsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<AnnouncementType>("info");
  const [target, setTarget] = useState<AnnouncementTarget>("all");
  const [dismissible, setDismissible] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setMessage("");
    setType("info");
    setTarget("all");
    setDismissible(true);
    setStartsAt("");
    setEndsAt("");
    setEditingId(null);
  };

  const save = () => {
    if (!title.trim() || !message.trim()) return;
    const existing = store.announcements.find((a) => a.id === editingId);
    const a: AnnouncementConfig = {
      id: editingId ?? store.uid(),
      title: title.trim(),
      message: message.trim(),
      type,
      target,
      active: existing?.active ?? true,
      dismissible,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      dismissCount: existing?.dismissCount ?? 0,
    };
    store.upsertAnnouncement(a);
    logAudit(
      editingId ? "Announcement Updated" : "Announcement Created",
      `"${a.title}"`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const handleEdit = (a: AnnouncementConfig) => {
    setEditingId(a.id);
    setTitle(a.title);
    setMessage(a.message);
    setType(a.type);
    setTarget(a.target);
    setDismissible(a.dismissible);
    setStartsAt(a.startsAt ?? "");
    setEndsAt(a.endsAt ?? "");
    setShowAdd(true);
  };

  const handleDelete = (a: AnnouncementConfig) => {
    if (!confirm(`Delete announcement "${a.title}"?`)) return;
    store.deleteAnnouncement(a.id);
    logAudit("Announcement Deleted", `"${a.title}"`, "warning");
  };

  const isLive = (a: AnnouncementConfig) => {
    if (!a.active) return false;
    const now = new Date();
    if (a.startsAt && new Date(a.startsAt) > now) return false;
    if (a.endsAt && new Date(a.endsAt) < now) return false;
    return true;
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Megaphone}
        title="Announcements"
        subtitle="Broadcast messages to users — real-time synced"
        count={store.announcements.length}
      />

      <div className="flex justify-end">
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> New Announcement
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {editingId ? "Edit Announcement" : "New Announcement"}
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
              placeholder="Scheduled maintenance"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <Field label="Message">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="We will be performing..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white resize-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AnnouncementType)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="danger">Danger</option>
              </select>
            </Field>
            <Field label="Target audience">
              <select
                value={target}
                onChange={(e) =>
                  setTarget(e.target.value as AnnouncementTarget)
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                <option value="all">All Users</option>
                <option value="founders">Founders Only</option>
                <option value="station">Station Users</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts (optional)">
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Ends (optional)">
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
              className="accent-amber-500"
            />
            Dismissible by users
          </label>
          <button
            onClick={() => setPreview("temp")}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"
          >
            <Eye size={14} /> Preview
          </button>
          {preview && (title || message) && (
            <div className={`rounded-lg border p-3 ${TYPE_STYLES[type]}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {title || "Title preview"}
                  </p>
                  <p className="text-xs mt-1 opacity-90">
                    {message || "Message preview"}
                  </p>
                </div>
                {dismissible && (
                  <X size={14} className="opacity-60 cursor-pointer" />
                )}
              </div>
            </div>
          )}
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
              {editingId ? "Update" : "Publish"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {store.announcements.length === 0 && (
          <EmptyState icon={Megaphone} text="No announcements published" />
        )}
        {store.announcements.map((a) => (
          <div
            key={a.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">
                    {a.title}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_STYLES[a.type]}`}
                  >
                    {a.type}
                  </span>
                  {isLive(a) ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={10} /> Live
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                      {a.active ? "Scheduled" : "Inactive"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">{a.message}</p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                  <span>Target: {TARGET_LABELS[a.target]}</span>
                  {a.dismissible && <span>Dismissible</span>}
                  <span>Dismissed: {a.dismissCount}</span>
                  {a.startsAt && (
                    <span>From: {new Date(a.startsAt).toLocaleString()}</span>
                  )}
                  {a.endsAt && (
                    <span>Until: {new Date(a.endsAt).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn
                  title={a.active ? "Deactivate" : "Activate"}
                  onClick={() => store.toggleAnnouncement(a.id)}
                >
                  <Bell
                    size={15}
                    className={a.active ? "text-amber-400" : "text-gray-500"}
                  />
                </IconBtn>
                <IconBtn title="Edit" onClick={() => handleEdit(a)}>
                  <EditIcon />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => handleDelete(a)}>
                  <Trash2 size={15} className="text-red-400" />
                </IconBtn>
              </div>
            </div>
            <div
              className={`mt-2 rounded-lg border p-2 ${TYPE_STYLES[a.type]}`}
            >
              <p className="text-xs">{a.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}
