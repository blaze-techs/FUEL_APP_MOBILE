/**
 * RoleMatrixSection — cloud-backed, real-time RBAC role-permission matrix.
 * Renders a grid: rows = resources, columns = roles, cells = toggle chips
 * for each PermissionAction. Reset to defaults, filter by role, export CSV.
 */

import { useMemo, useState } from "react";
import { Shield, RotateCcw, Download, Filter } from "lucide-react";
import type {
  RolePermission,
  PermissionAction,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import { SectionHeader, EmptyState } from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

const ACTIONS: PermissionAction[] = [
  "read",
  "write",
  "delete",
  "admin",
  "export",
  "import",
];

const ACTION_STYLES: Record<PermissionAction, string> = {
  read: "bg-blue-500/20 text-blue-400",
  write: "bg-green-500/20 text-green-400",
  delete: "bg-red-500/20 text-red-400",
  admin: "bg-purple-500/20 text-purple-400",
  export: "bg-amber-500/20 text-amber-400",
  import: "bg-cyan-500/20 text-cyan-400",
};

export default function RoleMatrixSection({ store, logAudit }: Props) {
  const [filterRole, setFilterRole] = useState<string>("all");

  const roles = store.DEFAULT_ROLES;
  const resources = store.DEFAULT_RESOURCES;

  const filteredRoles = useMemo(
    () =>
      filterRole === "all" ? roles : roles.filter((r) => r === filterRole),
    [filterRole, roles],
  );

  const getCell = (
    role: string,
    resource: string,
  ): RolePermission | undefined =>
    store.roleMatrix.find((rp) => rp.role === role && rp.resource === resource);

  const handleToggleAction = (
    role: string,
    resource: string,
    action: PermissionAction,
  ) => {
    const cell = getCell(role, resource);
    if (!cell) return;
    store.toggleRoleAction(cell.id, action);
    const willAdd = !cell.actions.includes(action);
    logAudit(
      "Role Action Toggled",
      `${role} / ${resource} / ${action} -> ${willAdd ? "granted" : "revoked"}`,
      willAdd ? "success" : "warning",
    );
  };

  const handleToggleGranted = (role: string, resource: string) => {
    const cell = getCell(role, resource);
    if (!cell) return;
    store.updateRolePermission(cell.id, { granted: !cell.granted });
    logAudit(
      "Role Grant Toggled",
      `${role} / ${resource} -> ${!cell.granted ? "granted" : "revoked"}`,
      !cell.granted ? "success" : "warning",
    );
  };

  const handleReset = () => {
    if (
      !confirm(
        "Reset all role permissions to defaults? This overwrites current grants.",
      )
    )
      return;
    store.resetRoleMatrix();
    logAudit("Role Matrix Reset", "Defaults restored", "warning");
  };

  const exportCsv = () => {
    const headers = ["role", "resource", ...ACTIONS, "granted", "updatedAt"];
    const rows = store.roleMatrix.map((rp) => [
      rp.role,
      rp.resource,
      ...ACTIONS.map((a) => (rp.actions.includes(a) ? "1" : "0")),
      rp.granted ? "1" : "0",
      rp.updatedAt,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `role-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit(
      "Role Matrix Exported",
      `${store.roleMatrix.length} rows as CSV`,
      "info",
    );
  };

  const stats = useMemo(() => {
    const total = store.roleMatrix.length;
    const granted = store.roleMatrix.filter((rp) => rp.granted).length;
    const totalActions = store.roleMatrix.reduce(
      (sum, rp) => sum + rp.actions.length,
      0,
    );
    return { total, granted, totalActions };
  }, [store.roleMatrix]);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Shield}
        title="Role Matrix"
        subtitle="RBAC permissions grid — real-time synced across devices"
        count={stats.granted}
      />

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-3">
          <span className="text-[10px] text-gray-500">Total Cells</span>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {stats.total}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-3">
          <span className="text-[10px] text-gray-500">Granted</span>
          <p className="text-lg font-semibold text-green-400">
            {stats.granted}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-3">
          <span className="text-[10px] text-gray-500">Actions</span>
          <p className="text-lg font-semibold text-amber-400">
            {stats.totalActions}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Filter size={15} /> Filter by role:
        </div>
        <button
          onClick={() => setFilterRole("all")}
          className={`px-3 py-1.5 rounded-lg text-xs ${filterRole === "all" ? "bg-amber-500 text-black" : "bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:bg-white/10"}`}
        >
          All
        </button>
        {roles.map((r) => (
          <button
            key={r}
            onClick={() => setFilterRole(r)}
            className={`px-3 py-1.5 rounded-lg text-xs capitalize ${filterRole === r ? "bg-amber-500 text-black" : "bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:bg-white/10"}`}
          >
            {r}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:bg-white/10 text-gray-300 text-sm border border-gray-200 dark:border-white/10"
        >
          <RotateCcw size={16} /> Reset to Defaults
        </button>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:bg-white/10 text-gray-300 text-sm border border-gray-200 dark:border-white/10"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      {store.roleMatrix.length === 0 ? (
        <EmptyState icon={Shield} text="No role permissions configured" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/10">
                <th className="text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium sticky left-0 bg-white dark:bg-gray-900">
                  Resource
                </th>
                {filteredRoles.map((role) => (
                  <th
                    key={role}
                    className="px-3 py-2 text-xs text-gray-300 font-medium capitalize min-w-[140px]"
                  >
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource} className="border-b border-white/5">
                  <td className="px-3 py-2 text-xs text-gray-200 font-mono sticky left-0 bg-white dark:bg-gray-900">
                    {resource}
                  </td>
                  {filteredRoles.map((role) => {
                    const cell = getCell(role, resource);
                    if (!cell) {
                      return (
                        <td
                          key={role}
                          className="px-3 py-2 text-xs text-gray-600"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={role} className="px-3 py-2 align-top">
                        <button
                          onClick={() => handleToggleGranted(role, resource)}
                          className={`block w-full text-[10px] px-2 py-0.5 rounded mb-1.5 ${cell.granted ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-500"}`}
                          title="Toggle grant"
                        >
                          {cell.granted ? "granted" : "denied"}
                        </button>
                        <div className="flex flex-wrap gap-1">
                          {ACTIONS.map((action) => {
                            const active = cell.actions.includes(action);
                            return (
                              <button
                                key={action}
                                onClick={() =>
                                  handleToggleAction(role, resource, action)
                                }
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${active ? ACTION_STYLES[action] : "bg-gray-50 dark:bg-white/5 text-gray-600 hover:bg-gray-100 dark:bg-white/10"}`}
                                title={`${action} — click to ${active ? "revoke" : "grant"}`}
                              >
                                {action}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
