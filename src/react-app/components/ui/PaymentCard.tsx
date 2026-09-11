import { useState, useRef, type ReactNode } from "react";

/**
 * Interactive 3D Payment Card (from design spec file 5).
 *
 * Features:
 * - 3D perspective tilt following mouse movement
 * - Live data sync: typing in fields updates the card face in real time
 * - CVC focus flips the card 180deg to reveal the back
 * - Used in POS Checkout (card payment) + Live Transaction STK Push.
 *
 * The card is a pure PRESENTATION component — all values are controlled by
 * the parent. It does NOT handle payment processing itself.
 */
export interface PaymentCardProps {
  name?: string;
  number?: string;
  expiry?: string;
  cvc?: string;
  paidAmount?: string;
  showSuccess?: boolean;
  brand?: string;
  accent?: "cobalt" | "amber" | "sage";
  children?: ReactNode;
}

export default function PaymentCard({
  name = "",
  number = "",
  expiry = "",
  cvc = "",
  paidAmount,
  showSuccess = false,
  brand = "FuelPro Pay",
  accent = "cobalt",
  children,
}: PaymentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const accentColor =
    accent === "amber"
      ? "rgba(246,137,31,0.25)"
      : accent === "sage"
        ? "rgba(141,207,116,0.25)"
        : "rgba(3,91,254,0.25)";

  const handleMouseMove = (e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ rx: -y * 12, ry: x * 12 });
  };

  const handleMouseLeave = () => {
    setTilt({ rx: 0, ry: 0 });
  };

  const spacedNumber = (number || "")
    .replace(/\D/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim()
    .padEnd(19, "\u2022");

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={cardRef}
        className={`fp-pay-card ${flipped ? "flipped" : ""}`}
        style={{
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry + (flipped ? 180 : 0)}deg)`,
          boxShadow: `0 20px 40px -12px ${accentColor}`,
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Front face */}
        <div className="fp-pay-card-face">
          <div className="flex items-start justify-between relative z-10">
            <div>
              <div className="w-10 h-7 rounded bg-gradient-to-br from-yellow-300 to-yellow-600 mb-3" />
              <p className="text-[10px] uppercase tracking-wider text-white/60">
                {brand}
              </p>
            </div>
            <span className="text-xs font-bold text-white/80">FuelPro</span>
          </div>

          <div className="relative z-10">
            <p className="text-lg font-mono tracking-widest mb-3 text-white/95">
              {spacedNumber}
            </p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[8px] uppercase text-white/50 mb-0.5">
                  Card Holder
                </p>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  {name || "YOUR NAME"}
                </p>
              </div>
              <div>
                <p className="text-[8px] uppercase text-white/50 mb-0.5">
                  Expires
                </p>
                <p className="text-xs font-semibold">{expiry || "MM/YY"}</p>
              </div>
            </div>
          </div>

          {showSuccess && paidAmount && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm rounded-2xl">
              <svg
                className="w-12 h-12 text-green-400 mb-2"
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
              <p className="text-sm font-bold text-green-400">
                Paid {paidAmount}
              </p>
            </div>
          )}
        </div>

        {/* Back face */}
        <div className="fp-pay-card-face fp-pay-card-back">
          <div className="w-full h-9 bg-black mt-2" />
          <div className="px-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-8 bg-white/80" />
              <div className="w-16 h-8 bg-white flex items-center justify-center text-xs font-bold text-gray-800">
                {cvc || "\u2022\u2022\u2022"}
              </div>
            </div>
            <p className="text-[8px] text-white/40 mt-2">
              Authorized signature — not transferable
            </p>
          </div>
          <div className="text-[8px] text-white/30 text-right">
            {brand} • Secured by FuelPro
          </div>
        </div>
      </div>

      {/* Input form (children) — CVC focus flips the card */}
      <div
        className="w-full max-w-sm"
        onFocus={(e) => {
          if ((e.target as HTMLElement).dataset.field === "cvc") {
            setFlipped(true);
          }
        }}
        onBlur={(e) => {
          if ((e.target as HTMLElement).dataset.field === "cvc") {
            setFlipped(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
