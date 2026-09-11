/**
 * BlocklistSection — cloud-backed, real-time IP blocklist management.
 * Add/unban IPs, set reason + expiry, bulk import (one IP per line),
 * search, toggle active, clear all.
 */

import { useMemo, useState } from "react";
import {
  ShieldBan,
  Plus,
  X,
  Trash2,
  Search,
  Upload,
  Ban,
  Clock,
} from "lucide-react";
import type {
  BlocklistEntry,
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

export default function BlocklistSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [search, setSearch] = useState("");
  const [bulkText, setBulkText] = useState("");

  const filtered = useMemo(
    () =>
      store.blocklist.filter(
        (b) =>
          b.ip.includes(search) ||
          b.reason.toLowerCase().includes(search.toLowerCase()),
      ),
    [store.blocklist, search],
  );

  const add = () => {
    if (!ip.trim()) return;
    const entry: BlocklistEntry = {
      id: store.uid(),
      ip: ip.trim(),
      reason: reason.trim() || "No reason provided",
      addedBy: "FOUNDER",
      expiresAt: expiresAt || undefined,
      active: true,
      createdAt: new Date().toISOString(),
    };
    store.addBlocklist(entry);
    logAudit("IP Blocked", `${ip.trim()} — ${entry.reason}`, "danger");
    setIp("");
    setReason("");
    setExpiresAt("");
    setShowAdd(false);
  };

  const handleDelete = (b: BlocklistEntry) => {
    store.deleteBlocklist(b.id);
    logAudit("IP Unblocked", b.ip, "info");
  };

  const importBulk = () => {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const entries: BlocklistEntry[] = lines.map((line) => ({
      id: store.uid(),
      ip: line.split(",")[0].trim(),
      reason: line.split(",")[1]?.trim() || "Bulk import",
      addedBy: "FOUNDER",
      active: true,
      createdAt: new Date().toISOString(),
    }));
    store.bulkAddBlocklist(entries);
    logAudit("Bulk IP Block Import", `${entries.length} IPs added`, "danger");
    setBulkText("");
    setShowImport(false);
  };

  const clearAll = () => {
    if (!confirm("Clear the entire blocklist?")) return;
    store.clearBlocklist();
    logAudit("Blocklist Cleared", "All entries removed", "warning");
  };

  const isExpired = (b: BlocklistEntry) =>
    b.expiresAt ? new Date(b.expiresAt) < new Date() : false;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={ShieldBan}
        title="IP Blocklist"
        subtitle="Block malicious IPs — real-time synced"
        count={store.blocklist.length}
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by IP or reason..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
        >
          <Upload size={16} /> Import
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Block IP
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Block IP Address</h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <Field label="IP address (or CIDR)">
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.1 or 10.0.0.0/24"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <Field label="Reason">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Abuse / scraping"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <Field label="Expires (leave blank for permanent)">
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={add}
              className="px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium"
            >
              Block
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Bulk Import IPs</h3>
            <button
              onClick={() => setShowImport(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <p className="text-xs text-gray-400">
            One IP per line. Optionally add a reason with a comma:{" "}
            <code className="font-mono">192.168.1.1, abuse</code>
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={"192.168.1.1, abuse\n10.0.0.5, scraping\n172.16.0.1"}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowImport(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={importBulk}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Import
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={Ban} text="No blocked IPs" />
        )}
        {filtered.map((b) => (
          <div
            key={b.id}
            className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <code className="text-sm text-white font-mono">{b.ip}</code>
                {b.active && !isExpired(b) ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                    Blocked
                  </span>
                ) : isExpired(b) ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 flex items-center gap-1">
                    <Clock size={10} /> Expired
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">
                    Inactive
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{b.reason}</p>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Added {new Date(b.createdAt).toLocaleDateString()} by{" "}
                {b.addedBy}
                {b.expiresAt &&
                  ` · expires ${new Date(b.expiresAt).toLocaleString()}`}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <IconBtn
                title={b.active ? "Unban" : "Re-ban"}
                onClick={() => store.toggleBlocklist(b.id)}
              >
                <Ban
                  size={15}
                  className={b.active ? "text-red-400" : "text-gray-500"}
                />
              </IconBtn>
              <IconBtn title="Remove" onClick={() => handleDelete(b)}>
                <Trash2 size={15} className="text-red-400" />
              </IconBtn>
            </div>
          </div>
        ))}
      </div>

      {store.blocklist.length > 0 && (
        <button
          onClick={clearAll}
          className="w-full py-2 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10"
        >
          Clear All
        </button>
      )}
    </div>
  );
}
