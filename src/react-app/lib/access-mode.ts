/**
 * access-mode.ts — THE single source of truth for a member's access mode.
 *
 * WHY THIS EXISTS
 * ---------------
 * An access mode was represented in several places at once (the canonical
 * `company_grants.access_mode` / `station_access_codes.access_mode` column,
 * the legacy `read_only` boolean, the redeemed session's `accessMode` +
 * `readOnly`, and each UI's own `accessMode || (readOnly ? ...)` fallback).
 * When those copies disagreed the app contradicted itself: the Company QR
 * card said "Normal" while the member view said "Read only".
 *
 * The rule is now hard-pinned and one-directional:
 *
 *     access_mode (canonical)
 *         -> effective mode
 *             -> read_only  (DERIVED, never the input)
 *                 -> UI labels + permission ceilings
 *
 * `read_only` is a compatibility mirror. It may be READ when a row predates
 * the `access_mode` column, but it must never independently decide the mode —
 * otherwise a stale `read_only = true` silently demotes a `full` grant.
 *
 * This module is dependency-free on purpose: the same resolver runs in the
 * browser AND inside the Vercel serverless bundle, so a grant can never be
 * interpreted two different ways by the two halves of the app.
 */

/** The three permission levels. Owner-decided per (grant, station). */
export type AccessMode = "read" | "edit" | "full";

export const ACCESS_MODES: AccessMode[] = ["read", "edit", "full"];

/** UI labels — the ONLY place these strings are defined. */
export const ACCESS_MODE_LABELS: Record<AccessMode, string> = {
  read: "Read only",
  edit: "Edit only",
  full: "Normal",
};

/**
 * Normalize an EXPLICIT mode value. Never trusts the input: anything that is
 * not exactly read/edit/full resolves to the SAFEST mode ("read"), so a
 * malformed value can never silently grant more than intended.
 */
export function normalizeAccessMode(raw: unknown): AccessMode {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "edit") return "edit";
  if (v === "full") return "full";
  return "read";
}

/**
 * The read-only flag for a mode. This is the ONLY direction the derivation is
 * allowed to run — `read_only` is an output, never an input to the level.
 */
export function modeToReadOnly(mode: AccessMode): boolean {
  return mode === "read";
}

/**
 * Resolve the effective mode from any grant / access-code / session shape.
 *
 * 1. The canonical `access_mode` / `accessMode` field ALWAYS wins when present.
 * 2. Only if it is absent (a row that predates the column) do we fall back to
 *    the legacy boolean: `read_only === false` means the historic "full".
 *
 * Because step 1 wins unconditionally, a stale `read_only` can no longer
 * contradict a canonical `access_mode`.
 */
export function resolveAccessMode(
  source:
    | {
        access_mode?: unknown;
        accessMode?: unknown;
        read_only?: unknown;
        readOnly?: unknown;
      }
    | null
    | undefined,
): AccessMode {
  if (!source) return "read";

  const explicit = source.access_mode ?? source.accessMode;
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return normalizeAccessMode(explicit);
  }

  const legacy = source.read_only ?? source.readOnly;
  if (legacy === false) return "full";
  return "read";
}

/** Display label for any mode value. Unknown/absent reads as "Read only". */
export function accessModeLabel(mode: AccessMode | undefined | null): string {
  return ACCESS_MODE_LABELS[normalizeAccessMode(mode)];
}

/**
 * Resolve the effective mode for a MEMBER SESSION / verified credential.
 *
 * Identical precedence to {@link resolveAccessMode} — the canonical field still
 * always wins — but the legacy fallback is deliberately dropped: when the
 * canonical `access_mode` is absent the credential predates migration 028 and
 * the live RPC could not report the true level, so we resolve to the SAFEST
 * mode ("read") instead of inferring "full" from `read_only = false`.
 *
 * That inference would be a privilege ESCALATION: a stale/missing column would
 * silently promote a read-only member to full write access. Grants (owner
 * authored, with a known legacy meaning) use {@link resolveAccessMode}; the
 * member-facing session path uses this.
 */
export function resolveSessionAccessMode(
  source:
    | {
        access_mode?: unknown;
        accessMode?: unknown;
        read_only?: unknown;
        readOnly?: unknown;
      }
    | null
    | undefined,
): AccessMode {
  if (!source) return "read";
  const explicit = source.access_mode ?? source.accessMode;
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return normalizeAccessMode(explicit);
  }
  return "read";
}

/* ────────────────────────────────────────────────────────────────────────
 * CAPABILITY MATRIX — what a level may actually DO.
 *
 * A level alone was not enough. The portal tested only `mode === "read"`, so
 * "Normal" and "Edit only" behaved IDENTICALLY. Every level now maps to an
 * explicit, ORDERED capability set, and that ordering is load-bearing:
 *
 *     read  ⊂  edit  ⊂  full
 *
 * A level can therefore only ADD capability, and a scope can only SUBTRACT.
 * Neither direction can escalate. Both are asserted in the test suite.
 * ──────────────────────────────────────────────────────────────────────── */

/** One thing a member may do, ordered least → most privileged. */
export type AccessCapability =
  "view" | "export" | "suggest" | "edit" | "settings" | "manage";

export const ACCESS_CAPABILITIES: AccessCapability[] = [
  "view",
  "export",
  "suggest",
  "edit",
  "settings",
  "manage",
];

/** UI labels — the ONLY place these strings are defined. */
export const ACCESS_CAPABILITY_LABELS: Record<AccessCapability, string> = {
  view: "View",
  export: "Export / print",
  suggest: "Suggest changes",
  edit: "Create & edit records",
  settings: "Station settings",
  manage: "Administration",
};

/**
 * The capability ceiling of each level.
 *   read — view/export only; cannot change anything.
 *   edit — adds record creation/editing and change suggestions.
 *   full — adds settings + administration (the full station experience).
 */
export const ACCESS_MODE_CAPABILITIES: Record<AccessMode, AccessCapability[]> =
  {
    read: ["view", "export"],
    edit: ["view", "export", "suggest", "edit"],
    full: ["view", "export", "suggest", "edit", "settings", "manage"],
  };

/** An owner-authored restriction layered ON TOP of the level. */
export interface AccessScope {
  /** Tab ids the member may open. EMPTY means "every tab the level allows". */
  tabs: string[];
  /** Capability allow-list. EMPTY means "whatever the level allows". */
  capabilities: AccessCapability[];
}

export function normalizeAccessCapability(
  raw: unknown,
): AccessCapability | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (ACCESS_CAPABILITIES as string[]).includes(v)
    ? (v as AccessCapability)
    : null;
}

/** Keep only recognised capabilities; junk is dropped, never guessed. */
export function normalizeAccessCapabilities(raw: unknown): AccessCapability[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<AccessCapability>();
  for (const item of raw) {
    const c = normalizeAccessCapability(item);
    if (c) seen.add(c);
  }
  return ACCESS_CAPABILITIES.filter((c) => seen.has(c));
}

/**
 * The EFFECTIVE capabilities for a level + scope.
 *
 * Two independent ceilings, both one-directional:
 *   - the level caps the set (read ⊂ edit ⊂ full);
 *   - the scope may only REMOVE from that set.
 * Neither can add a capability the level does not grant, so a malformed or
 * hostile scope cannot escalate a member.
 */
export function resolveCapabilities(
  mode: AccessMode | null | undefined,
  scope?: AccessScope | null,
): AccessCapability[] {
  const ceiling = ACCESS_MODE_CAPABILITIES[normalizeAccessMode(mode)];
  const allowed = normalizeAccessCapabilities(scope?.capabilities);
  if (allowed.length === 0) return [...ceiling];
  return ceiling.filter((c) => allowed.includes(c));
}

/** True when the level + scope permits the capability. */
export function canAccess(
  mode: AccessMode | null | undefined,
  scope: AccessScope | null | undefined,
  capability: AccessCapability,
): boolean {
  return resolveCapabilities(mode, scope).includes(capability);
}

/** Human summary of a level, for the QR card and the portal footer. */
export function accessModeSummary(mode: AccessMode | null | undefined): string {
  return ACCESS_MODE_CAPABILITIES[normalizeAccessMode(mode)]
    .map((c) => ACCESS_CAPABILITY_LABELS[c])
    .join(" · ");
}
