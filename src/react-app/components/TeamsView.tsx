/**
 * TeamsView — Team Manager "Teams" sub-tab.
 *
 * Organizational groups of team members, mirroring Reatech360's team
 * grouping model. The Owner creates teams (name + color + description)
 * and assigns members to them. Members can belong to multiple teams.
 *
 * Data is cloud-backed via useStationTeams (station-scoped app_kv) and the
 * member list comes from the shared PermissionContext `team` list so the
 * same members show everywhere.
 */

import { useMemo, useState } from "react";
import {
  Briefcase,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import {
  TEAM_COLORS,
  StationTeam,
  teamColorClasses,
  useStationTeams,
} from "@/react-app/lib/station-teams-service";

interface TeamMemberLike {
  id: string;
  username?: string;
  role?: string;
}

export default function TeamsView({
  stationId,
  members,
  memberLabel,
  showToast,
}: {
  stationId?: string;
  members: TeamMemberLike[];
  memberLabel: (m: TeamMemberLike) => string;
  showToast: (msg: string) => void;
}) {
  const {
    teams,
    loading,
    createTeam,
    updateTeam,
    deleteTeam,
    assignMember,
    unassignMember,
  } = useStationTeams(stationId);

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("gold");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignTeamId, setAssignTeamId] = useState<string | null>(null);
  const [newMemberId, setNewMemberId] = useState("");

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  function openCreate() {
    setEditingId(null);
    setName("");
    setColor("gold");
    setDescription("");
    setShowCreate(true);
  }

  function openEdit(t: StationTeam) {
    setEditingId(t.id);
    setName(t.name);
    setColor(t.color);
    setDescription(t.description ?? "");
    setShowCreate(true);
  }

  async function save() {
    if (!name.trim()) {
      showToast("Please enter a team name.");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await updateTeam(editingId, {
          name: name.trim(),
          color,
          description: description.trim(),
        });
        showToast("Team updated.");
      } else {
        await createTeam(name.trim(), color, description.trim());
        showToast("Team created.");
      }
      setShowCreate(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: StationTeam) {
    if (!window.confirm(`Delete team "${t.name}"? Members keep their roles.`))
      return;
    await deleteTeam(t.id);
    showToast("Team deleted.");
  }

  async function addMember(teamId?: string, memberId?: string) {
    const targetTeamId = teamId ?? assignTeamId;
    const targetMemberId = memberId ?? newMemberId;
    if (!targetTeamId || !targetMemberId) return;
    await assignMember(targetTeamId, targetMemberId);
    setAssignTeamId(null);
    setNewMemberId("");
    showToast("Member added to team.");
  }

  async function removeMember(teamId: string, memberId: string) {
    await unassignMember(teamId, memberId);
    showToast("Member removed from team.");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-amber-500" />
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">
              Teams & Groups
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Sort your staff into teams so schedules, reports & access stay
              organized.
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          disabled={!stationId}
          title={!stationId ? "Select a station first" : "Create team"}
          className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> New Team
        </button>
      </div>

      {/* Create/Edit modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !busy && setShowCreate(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {editingId ? "Edit Team" : "New Team"}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  Team name
                </label>
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Day Shift, Pumps, Office, Drivers"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  Color
                </label>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {TEAM_COLORS.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setColor(c.key)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${c.classes} ${
                        color === c.key
                          ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800"
                          : ""
                      }`}
                      title={c.label}
                    >
                      {color === c.key && (
                        <Check size={14} className="text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  Description (optional)
                </label>
                <textarea
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this team do?"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {editingId ? "Save changes" : "Create team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!stationId ? (
        <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10 p-8 text-center">
          <Briefcase className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Select a station to manage teams
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Team groups are stored separately for each station.
          </p>
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <Briefcase className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No teams yet. Create your first team to group staff together.
          </p>
          <button
            onClick={openCreate}
            className="mt-3 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm"
          >
            <Plus size={14} /> New Team
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {teams.map((t) => {
            const assigned = t.memberIds
              .map((id) => memberById.get(id))
              .filter(Boolean) as TeamMemberLike[];
            const isOpen = expanded === t.id;
            return (
              <div
                key={t.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-3 h-3 rounded-full flex-shrink-0 ${teamColorClasses(t.color)}`}
                    />
                    <p className="font-semibold truncate text-gray-900 dark:text-white">
                      {t.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setExpanded(isOpen ? null : t.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                      title="Members"
                    >
                      <Users size={14} />
                    </button>
                    <button
                      onClick={() => openEdit(t)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                      title="Edit team"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(t)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400"
                      title="Delete team"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {t.description && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t.description}
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {assigned.length}
                  </span>{" "}
                  member{assigned.length === 1 ? "" : "s"}
                </p>

                {isOpen && (
                  <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
                    <div className="flex gap-2">
                      <select
                        className="flex-1 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-white"
                        value={newMemberId}
                        onChange={(e) => setNewMemberId(e.target.value)}
                      >
                        <option value="">
                          {members.length === 0
                            ? "No members available"
                            : "Add a member…"}
                        </option>
                        {members
                          .filter((m) => !t.memberIds.includes(m.id))
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {memberLabel(m)}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => addMember(t.id, newMemberId)}
                        disabled={!newMemberId}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs disabled:opacity-40"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    {assigned.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        No members assigned.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {assigned.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-gray-700 dark:text-gray-200 truncate">
                              {memberLabel(m)}
                            </span>
                            <button
                              onClick={() => removeMember(t.id, m.id)}
                              className="text-red-400 hover:text-red-500 px-1"
                              title="Remove from team"
                            >
                              <Trash2 size={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
