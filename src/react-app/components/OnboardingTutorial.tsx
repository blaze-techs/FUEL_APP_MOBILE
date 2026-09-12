/**
 * OnboardingTutorial — the visible tutorial overlay.
 *
 * Controls: Start, Skip, Previous, Next, Remind me later.
 * Two parts: Basic and Advanced (toggleable when not running, and a
 * "Continue to Advanced" CTA at the end of Basic).
 *
 * Adaptive: steps are resolved at render time from the live feature flags,
 * visible tabs and registered founder sections, so the tutorial always
 * reflects the current state of the site.
 *
 * Spotlights: when a step has a targetSelector and the element exists, the
 * overlay dims the page and highlights it. If the element is missing the
 * step still renders centered (never blocks on UI churn).
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  Clock,
  GraduationCap,
  Wrench,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { useTutorial } from "@/react-app/context/TutorialContext";
import { useTenant } from "@/react-app/context/TenantContext";
import {
  buildTutorialSteps,
  type TutorialAdaptiveContext,
} from "@/react-app/lib/tutorial/tutorial-steps";

// Founder section ids that ship with the app (mirrors founder-sections/index.ts).
// Used only to decide which founder-themed advanced steps apply; the tutorial
// stays accurate even if this list drifts because each step's applies() also
// tolerates the section being absent.
const FOUNDER_SECTION_IDS = [
  "SecuritySection",
  "BackupSection",
  "ConfigSection",
  "NotificationsSection",
  "BrandingSection",
  "ApiSection",
  "AnalyticsSection",
  "MaintenanceSection",
  "EmailTemplatesSection",
  "RateLimitSection",
  "DataManagementSection",
  "SchemaVisualizerSection",
  "PricingManagerSection",
  "SubscriptionDashboardSection",
  "CouponSection",
  "PayoutSection",
  "TrialAnalyticsSection",
  "PerformanceSection",
  "PaywallControlSection",
  "PaymentMethodsSection",
  "SecretsManagerSection",
  "FeatureFlagsManagerSection",
  "AuditLogManagerSection",
  "ConsoleSettingsSection",
  "SystemHealthManagerSection",
  "WebhooksManagerSection",
  "ApiKeysManagerSection",
  "AnnouncementsSection",
  "MaintenanceWindowsSection",
  "BlocklistSection",
  "CorsConfigSection",
  "EnvVarsSection",
  "ScheduledJobsSection",
  "ExperimentsSection",
  "HealthChecksSection",
  "LocalizationSection",
  "CacheManagementSection",
  "CommandPaletteSection",
  "DatabaseQuerySection",
  "ErrorTrackerSection",
  "SessionInspectorSection",
  "TaskQueueSection",
  "LogStreamsSection",
  "RoleMatrixSection",
  "ReleaseCoordinatorSection",
  "MigrationsSection",
  "WebhookDeliveriesSection",
  "StorageExplorerSection",
  "ApiRateLimitsSection",
  "DeveloperControlCenterSection",
];

interface Props {
  /** Called when the tutorial finishes/skips — used to clear the active flag. */
}

export default function OnboardingTutorial(_: Props) {
  const {
    active,
    audience,
    stopTutorial,
    completeTutorial,
    snoozeTutorial,
    setAudience,
  } = useTutorial();

  const { featureFlags, visibleTabs, detectedCountry } = useTenant();

  // Not-yet-started: show the launch/welcome screen with Start + part chooser.
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);

  const ctx: TutorialAdaptiveContext = useMemo(
    () => ({
      featureFlags,
      availableTabs: visibleTabs,
      founderSections: FOUNDER_SECTION_IDS,
      country: detectedCountry,
    }),
    [featureFlags, visibleTabs, detectedCountry],
  );

  const steps = useMemo(
    () => buildTutorialSteps(audience, ctx),
    [audience, ctx],
  );

  // Reset progress whenever the tutorial (re)opens or the audience changes.
  useEffect(() => {
    if (active) {
      setStarted(false);
      setIndex(0);
    }
  }, [active]);

  useEffect(() => {
    if (started) setIndex(0);
  }, [started, audience]);

  // Spotlight the target element for the current step (best-effort, debounced).
  useEffect(() => {
    if (!active || !started) {
      setSpotlightRect(null);
      return;
    }
    const step = steps[index];
    if (!step?.targetSelector) {
      setSpotlightRect(null);
      return;
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          const el = document.querySelector(step.targetSelector!);
          if (el) {
            const r = (el as HTMLElement).getBoundingClientRect();
            setSpotlightRect(r);
          } else {
            setSpotlightRect(null);
          }
        } catch {
          setSpotlightRect(null);
        }
      });
    };
    update();
    const t = setTimeout(update, 150); // allow render to settle
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, started, index, steps]);

  const close = useCallback(() => {
    setStarted(false);
    stopTutorial();
  }, [stopTutorial]);

  // Keyboard navigation: ←/→ move between steps, Esc closes/snoozes, Enter
  // advances (or finishes on the last step). Only active once the tour starts.
  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        completeTutorial();
        setStarted(false);
        stopTutorial();
        return i;
      }
      return i + 1;
    });
  }, [steps.length, completeTutorial, stopTutorial]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!active || !started) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "Enter":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, started, goNext, goPrev, close]);

  if (!active) return null;

  const step = steps[index];
  const isLast = step ? index >= steps.length - 1 : true;

  /* ---------------- Launch screen ---------------- */
  if (!started) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-none">
        <div className="pointer-events-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-200 dark:border-gray-700">
          <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-gray-900 dark:text-white relative">
            <button
              onClick={close}
              aria-label="Skip tutorial"
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            >
              <X size={18} />
            </button>
            <div className="text-4xl mb-2">⛽</div>
            <h2 className="text-2xl font-bold">Welcome to FuelPro</h2>
            <p className="text-gray-900 dark:text-white/90 text-sm mt-1">
              A quick guided tour of everything your station dashboard can do.
            </p>
          </div>

          <div className="p-6 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Choose where to start. You can switch parts anytime, skip the
              tour, or ask us to remind you later.
            </p>

            <button
              onClick={() => {
                setAudience("basic");
                setStarted(true);
              }}
              className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 hover:border-amber-400 dark:hover:border-amber-700 transition-colors text-left"
            >
              <GraduationCap
                className="text-amber-600 dark:text-amber-400 mt-0.5"
                size={22}
              />
              <div>
                <div className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                  Basic Tour
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 mt-0.5">
                  Day-to-day features: sales, fuel, invoices, payroll & reports.
                  ~2 min.
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setAudience("advanced");
                setStarted(true);
              }}
              className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/10 hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors text-left"
            >
              <Wrench
                className="text-indigo-600 dark:text-indigo-400 mt-0.5"
                size={22}
              />
              <div>
                <div className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                  Advanced Tour
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 mt-0.5">
                  Day-to-day recap + technical features for skilled operators:
                  analytics, integrations, compliance & founder console. ~5 min.
                </div>
              </div>
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={snoozeTutorial}
                className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1.5"
              >
                <Clock size={14} /> Remind me later
              </button>
              <button
                onClick={() => {
                  completeTutorial();
                  close();
                }}
                className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1.5"
              >
                <SkipForward size={14} /> Skip tour
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Step view ---------------- */
  if (!step) {
    // No applicable steps for this tenant — finish gracefully.
    completeTutorial();
    return null;
  }

  const progress = ((index + 1) / steps.length) * 100;

  return (
    <>
      {/* Dim + spotlight backdrop */}
      <div className="fixed inset-0 z-[9998] pointer-events-auto">
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        >
          <defs>
            <mask id="tutorial-spotlight">
              <rect width="100%" height="100%" fill="white" />
              {spotlightRect && (
                <rect
                  x={spotlightRect.left - 8}
                  y={spotlightRect.top - 8}
                  width={spotlightRect.width + 16}
                  height={spotlightRect.height + 16}
                  rx={12}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="black"
            opacity={spotlightRect ? 0.55 : 0.45}
            mask={spotlightRect ? "url(#tutorial-spotlight)" : undefined}
          />
          {spotlightRect && (
            <rect
              x={spotlightRect.left - 8}
              y={spotlightRect.top - 8}
              width={spotlightRect.width + 16}
              height={spotlightRect.height + 16}
              rx={12}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={3}
              opacity={0.9}
            />
          )}
        </svg>
      </div>

      {/* Step card */}
      <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center p-3 md:p-6 pointer-events-none">
        <div className="pointer-events-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200 dark:border-gray-700">
          {/* Progress bar */}
          <div className="h-1.5 bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    audience === "basic"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  }`}
                >
                  {audience === "basic" ? "BASIC" : "ADVANCED"}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  Step {index + 1} of {steps.length}
                </span>
              </div>
              <button
                onClick={close}
                aria-label="Close tutorial"
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-start gap-3">
              {step.emoji && (
                <div className="text-3xl leading-none mt-0.5">{step.emoji}</div>
              )}
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white text-lg">
                  {step.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1.5 leading-relaxed">
                  {step.body}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1">
                <button
                  onClick={goPrev}
                  disabled={index === 0}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 dark:text-gray-300 fp-icon-only"
                  aria-label="Previous"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={goNext}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white text-sm font-medium transition-colors fp-icon-only"
                  title="Next"
                  aria-label="Next"
                >
                  {isLast ? (
                    <>
                      <CheckCircle2 size={16} /> Finish
                    </>
                  ) : (
                    <>
                      Next <ChevronRight size={16} />
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={snoozeTutorial}
                  className="text-[11px] text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
                  title="Snooze for 3 days"
                >
                  <Clock size={13} /> Remind later
                </button>
                <button
                  onClick={() => {
                    completeTutorial();
                    close();
                  }}
                  className="text-[11px] text-gray-500 dark:text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
                >
                  <SkipForward size={13} /> Skip
                </button>
              </div>
            </div>

            <p className="hidden md:block text-[10px] text-gray-400 dark:text-gray-500 mt-2 text-center">
              Tip: use ← → arrow keys to navigate, Esc to close
            </p>

            {/* Continue to Advanced CTA on the basic-done step */}
            {step.id === "basic-done" && (
              <button
                onClick={() => {
                  setAudience("advanced");
                  setStarted(true);
                }}
                className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/10 text-indigo-700 dark:text-indigo-300 text-sm font-medium hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors"
              >
                <Sparkles size={15} /> Continue to Advanced Tour
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
