import { describe, expect, it, beforeEach } from "vitest";
import {
  emitFeatureEvent,
  onFeatureEvent,
  _resetFeatureEventListeners,
} from "@/react-app/lib/feature-events";

describe("feature-events bus", () => {
  beforeEach(() => {
    _resetFeatureEventListeners();
  });

  it("delivers payloads to subscribers of the matching type", () => {
    let received: { discountId: string; amount: number } | null = null;
    onFeatureEvent("discount.approved", (payload) => {
      received = { discountId: payload.discountId, amount: payload.amount };
    });
    emitFeatureEvent({
      type: "discount.approved",
      payload: { discountId: "da_1", amount: 500, cash: "jane" },
    });
    expect(received).toEqual({ discountId: "da_1", amount: 500 });
  });

  it("does NOT deliver to listeners of a different type", () => {
    let heard = 0;
    onFeatureEvent("complaint.opened", () => {
      heard++;
    });
    emitFeatureEvent({
      type: "discount.approved",
      payload: { discountId: "x", amount: 1, cash: "" },
    });
    expect(heard).toBe(0);
  });

  it("unsubscribes on cleanup", () => {
    let heard = 0;
    const unsub = onFeatureEvent("complaint.opened", () => {
      heard++;
    });
    unsub();
    emitFeatureEvent({
      type: "complaint.opened",
      payload: { complaintId: "c_1", customer: "x", severity: "low" },
    });
    expect(heard).toBe(0);
  });

  it("survives a listener throwing; other listeners still fire", () => {
    let heard = 0;
    onFeatureEvent("voucher.redeemed", () => {
      throw new Error("boom");
    });
    onFeatureEvent("voucher.redeemed", () => {
      heard++;
    });
    emitFeatureEvent({
      type: "voucher.redeemed",
      payload: { code: "V1", amount: 1000 },
    });
    expect(heard).toBe(1);
  });

  it("multiple listeners of the same type all fire", () => {
    const calls: string[] = [];
    onFeatureEvent("power.outage", () => calls.push("a"));
    onFeatureEvent("power.outage", () => calls.push("b"));
    emitFeatureEvent({
      type: "power.outage",
      payload: { date: "2026-09-02", durationMin: 45, generatorRan: true },
    });
    expect(calls).toEqual(["a", "b"]);
  });
});
