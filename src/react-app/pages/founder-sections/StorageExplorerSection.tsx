/**
 * StorageExplorerSection — cloud-backed, real-time storage bucket explorer.
 * Browse files/folders across buckets, new folder, upload file (metadata),
 * delete items, filter by bucket, sort by size/date, public URL links.
 * Stats: total files, total size, by bucket.
 */

import { useMemo, useState } from "react";
import {
  HardDrive,
  Plus,
  X,
  Search,
  Trash2,
  Folder,
  File,
  ExternalLink,
  ArrowUpDown,
} from "lucide-react";
import type {
  StorageBucketItem,
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

type SortKey = "name" | "size" | "date";

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function StorageExplorerSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [addFolder, setAddFolder] = useState(false);
  const [search, setSearch] = useState("");
  const [filterBucket, setFilterBucket] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [bucketName, setBucketName] = useState("");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [size, setSize] = useState(0);
  const [mimeType, setMimeType] = useState("application/octet-stream");
  const [publicUrl, setPublicUrl] = useState("");

  const buckets = useMemo(() => {
    const set = new Set<string>();
    store.storageItems.forEach((i) => set.add(i.bucketName));
    return Array.from(set).sort();
  }, [store.storageItems]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = store.storageItems.filter((i) => {
      const matchesQ =
        !q ||
        i.name.toLowerCase().includes(q) ||
        i.path.toLowerCase().includes(q);
      const matchesBucket =
        filterBucket === "all" || i.bucketName === filterBucket;
      return matchesQ && matchesBucket;
    });
    return [...list].sort((a, b) => {
      if (sortKey === "size") return b.size - a.size;
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return (
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
    });
  }, [store.storageItems, search, filterBucket, sortKey]);

  const stats = useMemo(() => {
    const files = store.storageItems.filter((i) => !i.isFolder);
    const totalSize = files.reduce((sum, i) => sum + i.size, 0);
    const byBucket = buckets.reduce(
      (acc, b) => {
        acc[b] = store.storageItems.filter((i) => i.bucketName === b).length;
        return acc;
      },
      {} as Record<string, number>,
    );
    return { totalFiles: files.length, totalSize, byBucket };
  }, [store.storageItems, buckets]);

  const reset = () => {
    setBucketName("");
    setPath("");
    setName("");
    setSize(0);
    setMimeType("application/octet-stream");
    setPublicUrl("");
  };

  const save = () => {
    if (!name.trim() || !bucketName.trim()) return;
    const item: StorageBucketItem = {
      id: store.uid(),
      bucketName: bucketName.trim(),
      path: path.trim() || "/",
      name: name.trim(),
      size: addFolder ? 0 : size,
      mimeType: addFolder ? "inode/directory" : mimeType,
      isFolder: addFolder,
      publicUrl: publicUrl.trim() || undefined,
      uploadedAt: new Date().toISOString(),
      uploadedBy: "founder",
    };
    store.upsertStorageItem(item);
    logAudit(
      addFolder ? "Folder Created" : "File Uploaded",
      `${item.bucketName}${item.path}${item.name}`,
      "success",
    );
    reset();
    setShowAdd(false);
  };

  const handleDelete = (i: StorageBucketItem) => {
    if (!confirm(`Delete "${i.name}" from ${i.bucketName}?`)) return;
    store.deleteStorageItem(i.id);
    logAudit("Storage Item Deleted", `"${i.name}"`, "warning");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={HardDrive}
        title="Storage Explorer"
        subtitle="Bucket file browser — real-time synced across devices"
        count={store.storageItems.length}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <StatCard
          label="Total Files"
          value={stats.totalFiles}
          color="text-gray-100"
        />
        <StatCard
          label="Total Size"
          valueStr={formatSize(stats.totalSize)}
          color="text-amber-400"
        />
        <StatCard
          label="Buckets"
          value={buckets.length}
          color="text-blue-400"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name/path..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={filterBucket}
          onChange={(e) => setFilterBucket(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All buckets</option>
          {buckets.map((b) => (
            <option key={b} value={b}>
              {b} ({stats.byBucket[b] ?? 0})
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            setSortKey((k) =>
              k === "date" ? "size" : k === "size" ? "name" : "date",
            )
          }
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10"
          title={`Sort by ${sortKey}`}
        >
          <ArrowUpDown size={16} /> {sortKey}
        </button>
        <button
          onClick={() => {
            reset();
            setAddFolder(true);
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10"
        >
          <Folder size={16} /> New Folder
        </button>
        <button
          onClick={() => {
            reset();
            setAddFolder(false);
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Upload File
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {addFolder ? "New Folder" : "Upload File"}
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bucket name">
              <input
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
                placeholder="uploads"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
            <Field label="Path">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/reports/2026/"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
          </div>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={addFolder ? "new-folder" : "report.pdf"}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          {!addFolder && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Size (bytes)">
                <input
                  type="number"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
                />
              </Field>
              <Field label="MIME type">
                <input
                  value={mimeType}
                  onChange={(e) => setMimeType(e.target.value)}
                  placeholder="application/pdf"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
                />
              </Field>
            </div>
          )}
          {!addFolder && (
            <Field label="Public URL (optional)">
              <input
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://cdn.example.com/..."
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
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
              {addFolder ? "Create" : "Upload"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={HardDrive} text="No storage items found" />
        )}
        {filtered.map((i) => (
          <div
            key={i.id}
            className="rounded-xl bg-white/5 border border-white/10 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {i.isFolder ? (
                    <Folder size={16} className="text-amber-400" />
                  ) : (
                    <File size={16} className="text-gray-400" />
                  )}
                  <span className="text-sm font-medium text-white">
                    {i.name}
                  </span>
                  {i.isFolder && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      folder
                    </span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">
                    {i.bucketName}
                  </span>
                </div>
                <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                  {i.path}
                  {i.name}
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                  {!i.isFolder && <span>{formatSize(i.size)}</span>}
                  <span className="font-mono">{i.mimeType}</span>
                  <span>
                    Uploaded: {new Date(i.uploadedAt).toLocaleString()}
                  </span>
                  {i.uploadedBy && <span>by {i.uploadedBy}</span>}
                </div>
                {i.publicUrl && (
                  <a
                    href={i.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[11px] text-amber-400 hover:text-amber-300"
                  >
                    <ExternalLink size={11} /> {i.publicUrl}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Delete" onClick={() => handleDelete(i)}>
                  <Trash2 size={15} className="text-red-400" />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueStr,
  color,
}: {
  label: string;
  value?: number;
  valueStr?: string;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className={`text-lg font-semibold ${color}`}>{valueStr ?? value}</p>
    </div>
  );
}
