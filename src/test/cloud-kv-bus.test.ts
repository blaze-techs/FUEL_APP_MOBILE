import { describe, it, expect, vi } from "vitest";
import {
  kvBusKey,
  kvBusPublish,
  kvBusSubscribe,
} from "@/react-app/hooks/useCloudKV";

/**
 * useCloudKV same-page bus contract. Realtime is OFF by default
 * (low-bandwidth mode), so stacked components sharing one app_kv key
 * must still see each other's writes via this in-memory pub/sub.
 */
describe("useCloudKV same-page kv bus", () => {
  it("publishes to subscribed instances of the same key", () => {
    const key = kvBusKey("tank_readings", "station-1");
    const cb = vi.fn();
    kvBusSubscribe(key, cb);
    kvBusPublish(key, { fuelType: "petrol", measuredLevel: 10 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ fuelType: "petrol", measuredLevel: 10 });
  });

  it("unsubscribe stops delivery", () => {
    const key = kvBusKey("tank_readings", "station-1");
    const cb = vi.fn();
    const unsub = kvBusSubscribe(key, cb);
    unsub();
    kvBusPublish(key, 42);
    expect(cb).not.toHaveBeenCalled();
  });

  it("isolates different keys", () => {
    const a = vi.fn();
    const b = vi.fn();
    kvBusSubscribe(kvBusKey("a", "s1"), a);
    kvBusSubscribe(kvBusKey("a", "s2"), b);
    kvBusPublish(kvBusKey("a", "s1"), 1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("isolates different stations under the same key", () => {
    const a = vi.fn();
    const b = vi.fn();
    kvBusSubscribe(kvBusKey("a", "s1"), a);
    kvBusSubscribe(kvBusKey("a", "s2"), b);
    kvBusPublish(kvBusKey("a", "s2"), 2);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(2);
  });
});
