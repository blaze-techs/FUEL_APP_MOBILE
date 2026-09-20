/**
 * User-scoped local storage for cached business data.
 *
 * Why this exists: several components cache their list in localStorage for a
 * fast first paint before the cloud read resolves, falling back to a legacy
 * GLOBAL key such as `fuelpro_pos_transactions`. Those keys were never scoped
 * to an account, so after a second account signed in on the same device the
 * fallback served the PREVIOUS user's rows. That is the reported
 * "offline mode shows another user's data" bug, and the reason offline and
 * online could disagree.
 *
 * This mirrors the owner-marker approach already used for stations
 * (`fuelpro_stations_v3_owner` in StationContext): the legacy value is only
 * adopted by the account that legitimately owns it, and once claimed it can
 * never be handed to a different account.
 *
 * Ownership rules
 *  - A scoped key (`fuelpro_scoped_<owner>__<key>`) is authoritative and is
 *    only ever read by that owner.
 *  - A legacy global key is adopted ONLY when its owner marker matches the
 *    signed-in account, or when the legacy value has never been claimed by
 *    anyone (one-time claim by the account currently using the device). This
 *    keeps existing single-account installs working while making cross-account
 *    leakage impossible from the second account onward.
 *
 * Every accessor is best-effort and returns the caller's fallback on any
 * quota/parse failure.
 */

const SCOPED_PREFIX = "fuelpro_scoped_";

/** The authenticated account id, or null when signed out. */
export function localDataOwner(): string | null {
  try {
    const raw = localStorage.getItem("fuelpro_auth_identity");
    const id = raw ? JSON.parse(raw)?.id : null;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/** Storage key holding one logical value, isolated per account. */
export function scopedLocalKey(key: string, ownerId?: string | null): string {
  const owner = ownerId ?? localDataOwner();
  return `${SCOPED_PREFIX}${owner ?? "anon"}__${key}`;
}

/** Marker naming the account that last wrote a legacy global key. */
export function legacyOwnerKey(key: string): string {
  return `${key}__owner`;
}

/**
 * Read a cached value for the CURRENT account.
 *
 * Returns `fallback` when this account has nothing cached. A legacy global
 * value belonging to a different account is never returned.
 */
export function readScopedLocal<T>(key: string, fallback: T): T {
  try {
    const owner = localDataOwner();
    const scoped = localStorage.getItem(scopedLocalKey(key, owner));
    if (scoped != null) {
      try {
        return JSON.parse(scoped) as T;
      } catch {
        return fallback;
      }
    }

    const legacy = localStorage.getItem(key);
    if (legacy == null) return fallback;

    // Decide whether this account may claim the legacy value.
    const marker = localStorage.getItem(legacyOwnerKey(key));
    const claimable = marker == null || (owner != null && marker === owner);
    if (!claimable) {
      // Belongs to a different account on this shared device — ignore it so
      // the other user's rows can never surface here.
      return fallback;
    }

    let parsed: T;
    try {
      parsed = JSON.parse(legacy) as T;
    } catch {
      return fallback;
    }

    // Adopt into this account's scoped key and mark ownership so no other
    // account can claim it later.
    localStorage.setItem(scopedLocalKey(key, owner), legacy);
    if (owner != null) localStorage.setItem(legacyOwnerKey(key), owner);
    localStorage.removeItem(key);
    return parsed;
  } catch {
    return fallback;
  }
}

/** Write a cached value scoped to the current account. Best-effort. */
export function writeScopedLocal(key: string, value: unknown): void {
  try {
    const owner = localDataOwner();
    localStorage.setItem(scopedLocalKey(key, owner), JSON.stringify(value));
    if (owner != null) localStorage.setItem(legacyOwnerKey(key), owner);
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** Remove this account's cached value plus any leftover legacy global key. */
export function removeScopedLocal(key: string): void {
  try {
    localStorage.removeItem(scopedLocalKey(key));
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Drop every cached value for an account (e.g. on sign-out). */
export function clearScopedLocalForOwner(ownerId: string): void {
  try {
    const prefix = `${SCOPED_PREFIX}${ownerId}__`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
