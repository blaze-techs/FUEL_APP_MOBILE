/**
 * station-teams-service — FuelPro Team Groups.
 *
 * Reverse-engineered from Reatech360's team/grouping model (`/admin/team`
 * + central teams): organizational groups of team members (e.g. "Day
 * Shift", "Pumps", "Office", "Drivers"). Each team has a name, a color,
 * an optional description, and a list of member ids. The Owner creates
 * teams and assigns members; membership is independent of role so a
 * member can belong to multiple teams.
 *
 * Persisted station-scoped to app_kv via cloudStorageService (the app-wide
 * cloud-first pattern) with the same 3-ref guard used across components.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export const STATION_TEAMS_KEY = "station_teams";

export interface StationTeam {
  id: string;
  name: string;
  color: string; // tailwind-ish accent key (gold/emerald/sky/violet/rose)
  description?: string;
  memberIds: string[]; // team member ids (TeamMember.id)
  createdAt: string;
  updatedAt: string;
}

export const TEAM_COLORS: { key: string; label: string; classes: string }[] = [
  { key: "gold", label: "Gold", classes: "bg-amber-400" },
  { key: "emerald", label: "Emerald", classes: "bg-emerald-500" },
  { key: "sky", label: "Sky", classes: "bg-sky-500" },
  { key: "violet", label: "Violet", classes: "bg-violet-500" },
  { key: "rose", label: "Rose", classes: "bg-rose-500" },
];

export function teamColorClasses(key: string): string {
  return TEAM_COLORS.find((c) => c.key === key)?.classes ?? "bg-amber-400";
}

export function normalizeTeams(v: unknown): StationTeam[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t) => t && typeof t === "object")
    .map((t) => {
      const o = t as Partial<StationTeam>;
      return {
        id:
          typeof o.id === "string"
            ? o.id
            : `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: typeof o.name === "string" ? o.name : "Untitled team",
        color: typeof o.color === "string" ? o.color : "gold",
        description: typeof o.description === "string" ? o.description : "",
        memberIds: Array.isArray(o.memberIds) ? o.memberIds.map(String) : [],
        createdAt:
          typeof o.createdAt === "string"
            ? o.createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof o.updatedAt === "string"
            ? o.updatedAt
            : new Date().toISOString(),
      };
    });
}

export function useStationTeams(stationId?: string): {
  teams: StationTeam[];
  loading: boolean;
  createTeam: (
    name: string,
    color: string,
    description?: string,
  ) => Promise<void>;
  updateTeam: (id: string, patch: Partial<StationTeam>) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  assignMember: (teamId: string, memberId: string) => Promise<void>;
  unassignMember: (teamId: string, memberId: string) => Promise<void>;
} {
  const [teams, setTeams] = useState<StationTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const teamsRef = useRef<StationTeam[]>([]);
  teamsRef.current = teams;

  const persist = useCallback(
    async (next: StationTeam[]) => {
      if (!stationId) {
        throw new Error("Select a station before managing teams.");
      }
      setTeams(next);
      localModifiedRef.current = true;
      try {
        await cloudStorageService.set(STATION_TEAMS_KEY, next, stationId);
      } finally {
        localModifiedRef.current = false;
      }
    },
    [stationId],
  );

  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;

    // Never load or write a station-team record without a resolved station.
    // The previous implementation could query the unscoped key during the
    // first render, leaving the Teams sub-tab with stale/empty data while the
    // station context was still resolving.
    if (!stationId) {
      setTeams([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    const cached = cloudStorageService.getCached<unknown>(
      STATION_TEAMS_KEY,
      stationId,
    );
    if (cached !== undefined && !cancelled) {
      setTeams(normalizeTeams(cached));
    }

    (async () => {
      try {
        const cloud = await cloudStorageService.get<unknown>(
          STATION_TEAMS_KEY,
          stationId,
        );
        if (!cancelled && !localModifiedRef.current && cloud !== undefined) {
          setTeams(normalizeTeams(cloud));
        }
      } catch (error) {
        console.warn("[station-teams] failed to load station teams", error);
      } finally {
        if (!cancelled) {
          cloudLoadCompleteRef.current = true;
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stationId]);

  return {
    teams,
    loading,
    createTeam: useCallback(
      async (name: string, color: string, description?: string) => {
        const now = new Date().toISOString();
        const t: StationTeam = {
          id: `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim(),
          color,
          description: description?.trim() || "",
          memberIds: [],
          createdAt: now,
          updatedAt: now,
        };
        await persist([...teamsRef.current, t]);
      },
      [persist],
    ),
    updateTeam: useCallback(
      async (id: string, patch: Partial<StationTeam>) => {
        await persist(
          teamsRef.current.map((t) =>
            t.id === id
              ? { ...t, ...patch, updatedAt: new Date().toISOString() }
              : t,
          ),
        );
      },
      [persist],
    ),
    deleteTeam: useCallback(
      async (id: string) => {
        await persist(teamsRef.current.filter((t) => t.id !== id));
      },
      [persist],
    ),
    assignMember: useCallback(
      async (teamId: string, memberId: string) => {
        await persist(
          teamsRef.current.map((t) => {
            if (t.id !== teamId) return t;
            if (t.memberIds.includes(memberId)) return t;
            return {
              ...t,
              memberIds: [...t.memberIds, memberId],
              updatedAt: new Date().toISOString(),
            };
          }),
        );
      },
      [persist],
    ),
    unassignMember: useCallback(
      async (teamId: string, memberId: string) => {
        await persist(
          teamsRef.current.map((t) =>
            t.id === teamId
              ? {
                  ...t,
                  memberIds: t.memberIds.filter((m) => m !== memberId),
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        );
      },
      [persist],
    ),
  };
}
