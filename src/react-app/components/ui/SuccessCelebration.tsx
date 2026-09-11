import { useEffect, type ReactNode } from "react";

/**
 * Success Celebration Overlay (Peak-End rule from design spec file 7).
 *
 * A full-screen rewarding overlay shown when a key action completes
 * (e.g. POS sale, payment collected, delivery dispatched). Makes the
 * END moment of a flow memorable per the Peak-End rule.
 *
 * Auto-dismisses after `duration` ms (default 2200ms).
 */
export interface SuccessCelebrationProps {
  show: boolean;
  /** Main headline */
  title?: string;
  /** Sub-text (e.g. the amount or reference) */
  message?: string;
  /** Duration before auto-dismiss (ms) */
  duration?: number;
  /** Called when the overlay dismisses (auto or click) */
  onDismiss?: () => void;
  /** Optional extra action button rendered below the message */
  action?: ReactNode;
}

export default function SuccessCelebration({
  show,
  title = "Success!",
  message = "",
  duration = 2200,
  onDismiss,
  action,
}: SuccessCelebrationProps) {
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => {
      onDismiss?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [show, duration, onDismiss]);

  if (!show) return null;

  return (
    <div
      className="fp-success-overlay"
      onClick={() => onDismiss?.()}
      role="dialog"
      aria-live="assertive"
      aria-modal="true"
    >
      <div className="relative flex flex-col items-center">
        {/* Expanding ring */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <span
            className="fp-success-ring"
            style={{ width: 64, height: 64 }}
            aria-hidden="true"
          />
          <div className="fp-success-check w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
            <svg
              className="w-9 h-9 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mt-4 text-center px-6">
          {title}
        </h2>
        {message && (
          <p className="text-sm text-white/80 mt-1 text-center px-6 max-w-xs">
            {message}
          </p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
