import {
  useEffect,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Teleport from "@/react-app/components/ui/Teleport";

interface ModalProps {
  /** Rendered with `font-medium` label semantics via `aria-label` when set. */
  label?: string;
  /** Called when the user dismisses (Escape / backdrop click / close button). */
  onClose: () => void;
  /** True to lock body scroll while open (default true). */
  lockScroll?: boolean;
  /** True to close on a backdrop (outside) click (default true). */
  closeOnBackdrop?: boolean;
  /** Extra classes for the inner card wrapper (max-width etc.). */
  className?: string;
  children: ReactNode;
}

/**
 * Modal — the ONE reference implementation for full-screen overlays in the
 * app. Correct-by-construction:
 *   - TELEPORTS to `document.body` (via Teleport) so `position: fixed`
 *     resolves against the viewport even if this is rendered inside a
 *     positioned ancestor (`<header class="relative">`, `<nav class="fixed">`,
 *     a `transform`/`filter` wrapper…). This is the fix for the
 *     "modal hidden above the header" bug class — callers never have to
 *     remember to teleport: the modal always protects itself.
 *   - Escape closes, body scroll is locked while open, backdrop click
 *     closes, and the card stops propagation so inner clicks never close.
 *   - ARIA dialog semantics (`role="dialog"`, `aria-modal`, labelled).
 */
export default function Modal({
  label,
  onClose,
  lockScroll = true,
  closeOnBackdrop = true,
  className = "bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 dark:border-gray-700",
  children,
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    if (lockScroll) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.style.overscrollBehavior = "none";
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
        document.body.style.overscrollBehavior = "";
      };
    }
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, lockScroll]);

  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  return (
    <Teleport>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label ?? "Dialog"}
        className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 overflow-y-auto"
        onClick={closeOnBackdrop ? onClose : undefined}
      >
        <div
          className={className}
          onClick={stop}
          style={{ maxHeight: "90vh", overflowY: "auto" }}
        >
          {children}
        </div>
      </div>
    </Teleport>
  );
}
