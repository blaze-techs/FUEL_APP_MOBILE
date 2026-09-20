import type { PriceSchedule } from "@/react-app/lib/forecourt-features";

export function getDuePriceSchedules(
  schedules: PriceSchedule[],
  now: Date = new Date(),
): PriceSchedule[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  return schedules.filter((s) => {
    if (s.status !== "pending") return false;
    if (!(s.verificationConfirmedAt || s.mfaVerifiedAt)) return false;
    const effectiveMs = Date.parse(s.effectiveOn);
    return Number.isFinite(effectiveMs) && effectiveMs <= nowMs;
  });
}

export function isValidFutureSchedule(
  effectiveOn: string,
  now: Date = new Date(),
): boolean {
  const effectiveMs = Date.parse(effectiveOn);
  const nowMs = now.getTime();
  return (
    Number.isFinite(effectiveMs) &&
    Number.isFinite(nowMs) &&
    effectiveMs > nowMs
  );
}
