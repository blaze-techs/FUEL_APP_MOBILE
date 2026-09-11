/**
 * TutorialContext — owns the one-time onboarding tutorial lifecycle.
 *
 * Persistence model (per-user, so the tutorial is a one-time experience):
 *   - SETUP_KEYS.ONBOARDING_COMPLETE: "true" once the user finishes OR skips.
 *     When set, the tutorial does NOT auto-launch on next login.
 *   - SETUP_KEYS.WELCOME_SHOWN: "true" once the welcome/intro has appeared.
 *   - SETUP_KEYS.FIRST_LOGIN: timestamp of first login (informational).
 *   - A per-user suffix is appended so multi-account devices keep separate
 *     tutorial state.
 *
 * The user can always replay the tutorial via the Header "Help" menu, which
 * calls `startTutorial()` regardless of the persisted flag.
 *
 * "Remind me later" snoozes the tutorial for 3 days (SNOOZE_MS) by storing a
 * snooze-until timestamp; the tutorial won't auto-launch before that time.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { SETUP_KEYS } from "@/react-app/lib/constants/storage-keys";
import { useAuth } from "@/react-app/context/AuthContext";

export type TutorialAudience = "basic" | "advanced";

interface TutorialState {
  /** Whether the tutorial modal/overlay is currently visible. */
  active: boolean;
  /** Which track is running. */
  audience: TutorialAudience;
  /** Whether the user has already completed/skipped it (persisted). */
  hasCompleted: boolean;
  /** Whether the tutorial should auto-launch now (not completed + not snoozed). */
  shouldAutoStart: boolean;
}

interface TutorialContextValue extends TutorialState {
  /** Launch the tutorial (optionally forcing a specific audience). */
  startTutorial: (audience?: TutorialAudience) => void;
  /** Hide the tutorial without marking it complete (used by Skip/Remind-later). */
  stopTutorial: () => void;
  /** Mark the tutorial complete and persist it (one-time lock). */
  completeTutorial: () => void;
  /** Snooze the tutorial for SNOOZE_MS (Remind me later). */
  snoozeTutorial: () => void;
  /** Switch the running track between basic and advanced. */
  setAudience: (a: TutorialAudience) => void;
}

const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const TutorialContext = createContext<TutorialContextValue | null>(null);

function userSuffix(): string {
  try {
    const raw = localStorage.getItem("fuelpro_user");
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.id) return `_${u.id}`;
      if (u?.email) return `_${u.email}`;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function key(base: string): string {
  return `${base}${userSuffix()}`;
}

function readFlag(base: string): boolean {
  try {
    return localStorage.getItem(key(base)) === "true";
  } catch {
    return false;
  }
}

function writeFlag(base: string, value: boolean) {
  try {
    localStorage.setItem(key(base), value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

function snoozeUntil(): number | null {
  try {
    const v = localStorage.getItem(key("fuelpro_tutorial_snooze_until"));
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [active, setActive] = useState(false);
  const [audience, setAudienceState] = useState<TutorialAudience>("basic");
  const [hasCompleted, setHasCompleted] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);

  // Re-evaluate persisted state whenever the logged-in user changes.
  useEffect(() => {
    setHasCompleted(readFlag(SETUP_KEYS.ONBOARDING_COMPLETE));
    setSnoozedUntil(snoozeUntil());
  }, [user?.id]);

  const startTutorial = useCallback((a?: TutorialAudience) => {
    setActive(true);
    if (a) setAudienceState(a);
  }, []);

  const stopTutorial = useCallback(() => setActive(false), []);

  const completeTutorial = useCallback(() => {
    writeFlag(SETUP_KEYS.ONBOARDING_COMPLETE, true);
    try {
      localStorage.setItem(key(SETUP_KEYS.FIRST_LOGIN), Date.now().toString());
      localStorage.setItem(key(SETUP_KEYS.WELCOME_SHOWN), "true");
    } catch {
      /* ignore */
    }
    setHasCompleted(true);
    setActive(false);
  }, []);

  const snoozeTutorial = useCallback(() => {
    const until = Date.now() + SNOOZE_MS;
    try {
      localStorage.setItem(
        key("fuelpro_tutorial_snooze_until"),
        until.toString(),
      );
    } catch {
      /* ignore */
    }
    setSnoozedUntil(until);
    setActive(false);
  }, []);

  const setAudience = useCallback((a: TutorialAudience) => {
    setAudienceState(a);
  }, []);

  const snoozed = snoozedUntil != null && Date.now() < snoozedUntil;
  const shouldAutoStart = !hasCompleted && !snoozed && !!user;

  const value: TutorialContextValue = {
    active,
    audience,
    hasCompleted,
    shouldAutoStart,
    startTutorial,
    stopTutorial,
    completeTutorial,
    snoozeTutorial,
    setAudience,
  };

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return ctx;
}
