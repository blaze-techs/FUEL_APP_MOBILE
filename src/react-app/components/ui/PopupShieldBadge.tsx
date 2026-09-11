import { useEffect, useState } from "react";
import { Shield, ShieldCheck } from "lucide-react";
import {
  engagePopupShield,
  releasePopupShield,
  onPopupShieldChange,
  resetPopupShieldCount,
} from "@/react-app/lib/ad-blocker";

/**
 * usePopupShield — Popup Blocker Pro-style auto lifecycle for a media
 * player. While `active` is true the strict popup shield is ENGAGED for this
 * scope (popups blocked even on user click, unless whitelisted). When the
 * component unmounts OR `active` flips false, the scope releases. Multiple
 * nested players are ref-counted so the shield only fully disengages when
 * the last player closes.
 */
export function usePopupShield(scope: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    engagePopupShield(scope);
    return () => releasePopupShield(scope);
  }, [scope, active]);
}

/**
 * PopupShieldBadge — the small 🛡 indicator shown inside player chrome.
 * Mirrors Popup Blocker Pro's toolbar badge: shield icon + blocked count.
 * Clicking resets the counter (the shield stays engaged while the player
 * is open — that is the whole point).
 */
export function PopupShieldBadge({ dark = true }: { dark?: boolean }) {
  const [state, setState] = useState({ active: false, blocked: 0 });
  useEffect(
    () =>
      onPopupShieldChange((s) => {
        setState(s);
      }),
    [],
  );
  if (!state.active) return null;
  return (
    <button
      type="button"
      onClick={() => resetPopupShieldCount()}
      title={
        state.blocked > 0
          ? `Ad & popup shield active — ${state.blocked} blocked. Click to reset the counter.`
          : "Ad & popup shield active — ads, popups and redirects are blocked while the player is open."
      }
      aria-label={`Ad and popup shield active, ${state.blocked} blocked`}
      className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${
        state.blocked > 0
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
          : dark
            ? "bg-gray-800 text-emerald-300 hover:bg-gray-700"
            : "bg-emerald-50 text-emerald-600 border border-emerald-200"
      }`}
    >
      {state.blocked > 0 ? (
        <ShieldCheck size={12} className="text-emerald-400" />
      ) : (
        <Shield size={12} className="text-emerald-400" />
      )}
      {state.blocked > 0 && <span>{state.blocked}</span>}
    </button>
  );
}
