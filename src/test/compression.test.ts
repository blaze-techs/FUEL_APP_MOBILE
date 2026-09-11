/**
 * Compression utility tests.
 *
 * Verifies the gzip compression/decompression layer used to minimize Supabase
 * storage: JSON payloads (app_kv) round-trip exactly and are smaller, tiny
 * payloads skip compression, backward compatibility with uncompressed rows,
 * file Blob compression, and MIME-type detection.
 */

import { describe, it, expect } from "vitest";
import {
  compressJson,
  decompressJson,
  decompressAny,
  isCompressedPayload,
  isCompressibleMimeType,
  compressBlob,
  decompressBlob,
  compressedFilePath,
  isCompressedPath,
  COMPRESSED_MARKER,
} from "@/react-app/lib/compression";

describe("compression — JSON (app_kv)", () => {
  it("compresses a large JSON payload and round-trips exactly", () => {
    // A large, highly-repetitive JSON object (realistic business data shape).
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `Expense item ${i}`,
      amount: 100 + i,
      category: "fuel",
      note: "重复的文本内容用于测试压缩比 repeat repeat repeat",
      date: "2026-08-14",
    }));
    const value = { items, total: 12345, currency: "USD" };

    const compressed = compressJson(value);
    expect(isCompressedPayload(compressed)).toBe(true);

    const payload = compressed as { __compressed: true; c: string; o: number };
    expect(payload[COMPRESSED_MARKER]).toBe(true);
    expect(typeof payload.c).toBe("string");
    expect(payload.o).toBeGreaterThan(0);

    // The base64 payload should be materially smaller than the original JSON.
    const originalBytes = new TextEncoder().encode(
      JSON.stringify(value),
    ).length;
    const compressedBytes = new TextEncoder().encode(payload.c).length;
    expect(compressedBytes).toBeLessThan(originalBytes);

    // Round-trip: decompress and compare with the original.
    const restored = decompressJson(compressed);
    expect(restored).toEqual(value);
  });

  it("decompresses a compressed payload back to the original value", () => {
    const value = {
      rows: Array.from({ length: 50 }, (_, i) => ({ a: i, b: `row${i}` })),
    };
    const compressed = compressJson(value);
    expect(decompressJson(compressed)).toEqual(value);
  });

  it("skips compression for tiny payloads (returns original)", () => {
    const tiny = { a: 1 };
    const result = compressJson(tiny);
    // Tiny values are returned unchanged (not wrapped in a compressed payload).
    expect(isCompressedPayload(result)).toBe(false);
    expect(result).toEqual(tiny);
  });

  it("is backward compatible — uncompressed values pass through decompressJson", () => {
    const plain = { hello: "world", n: 42 };
    expect(decompressJson(plain)).toEqual(plain);
    expect(decompressJson(null)).toBeNull();
    expect(decompressJson("plain string")).toBe("plain string");
    // Arrays are not compressed payloads either.
    expect(decompressJson([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("decompressJson returns null for a corrupt compressed payload", () => {
    const corrupt = { [COMPRESSED_MARKER]: true, c: "!!!not-valid-base64!!!" };
    expect(decompressJson(corrupt)).toBeNull();
  });

  it("decompressAny decodes the legacy {__c:1,d} envelope", async () => {
    const pako = (await import("pako")).default;
    const value = [{ id: "fuel_1", name: "Super Petrol", price: 1.1 }];
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    const gz = pako.gzip(bytes, { level: 9 });
    let bin = "";
    for (let i = 0; i < gz.length; i++) bin += String.fromCharCode(gz[i]);
    const legacy = { __c: 1, d: btoa(bin), n: bytes.length, z: gz.length };
    expect(decompressAny(legacy)).toEqual(value);
  });

  it("decompressAny unwraps nested legacy(current(value)) double-wrapped rows", async () => {
    const pako = (await import("pako")).default;
    const value = Array.from({ length: 50 }, (_, i) => ({
      id: `fuel_${i}`,
      name: "Diesel",
      price: 1.1,
    }));
    // Inner: current-format envelope.
    const inner = compressJson(value);
    expect(isCompressedPayload(inner)).toBe(true);
    // Outer: legacy-format envelope around the inner envelope.
    const json = JSON.stringify(inner);
    const bytes = new TextEncoder().encode(json);
    const gz = pako.gzip(bytes, { level: 9 });
    let bin = "";
    for (let i = 0; i < gz.length; i++) bin += String.fromCharCode(gz[i]);
    const outer = { __c: 1, d: btoa(bin), n: bytes.length, z: gz.length };
    expect(decompressAny(outer)).toEqual(value);
  });

  it("compressJson never double-wraps — re-compressing an envelope yields one layer", () => {
    const value = { rows: Array.from({ length: 50 }, (_, i) => ({ i })) };
    const once = compressJson(value);
    expect(isCompressedPayload(once)).toBe(true);
    const twice = compressJson(once);
    // Still exactly one envelope layer, decoding straight to the value.
    expect(isCompressedPayload(twice)).toBe(true);
    expect(decompressJson(twice)).toEqual(value);
  });
});

describe("compression — file Blobs", () => {
  it("compresses and decompresses a text Blob round-trip", async () => {
    const text = "hello compression ".repeat(500);
    const file = new Blob([text], { type: "text/plain" });

    const compressed = await compressBlob(file);
    expect(compressed.type).toBe("application/gzip");
    // gzip should reduce a highly-repetitive text blob.
    expect(compressed.size).toBeLessThan(file.size);

    const restored = await decompressBlob(compressed);
    const restoredText = await restored.text();
    expect(restoredText).toBe(text);
  });

  it("decompressBlob returns the original blob when input is not gzip", async () => {
    const plain = new Blob(["not gzip data"], { type: "text/plain" });
    const result = await decompressBlob(plain);
    // pako.ungzip throws on non-gzip input; the helper returns the original.
    expect(await result.text()).toBe("not gzip data");
  });
});

describe("compression — MIME detection", () => {
  it("marks text-based types as compressible", () => {
    expect(isCompressibleMimeType("text/plain")).toBe(true);
    expect(isCompressibleMimeType("text/csv")).toBe(true);
    expect(isCompressibleMimeType("application/json")).toBe(true);
    expect(isCompressibleMimeType("application/xml")).toBe(true);
    expect(isCompressibleMimeType("image/svg+xml")).toBe(true);
  });

  it("marks binary/already-compressed types as NOT compressible", () => {
    expect(isCompressibleMimeType("image/png")).toBe(false);
    expect(isCompressibleMimeType("image/jpeg")).toBe(false);
    expect(isCompressibleMimeType("image/webp")).toBe(false);
    expect(isCompressibleMimeType("application/pdf")).toBe(false);
    expect(isCompressibleMimeType("video/mp4")).toBe(false);
    expect(isCompressibleMimeType("audio/mpeg")).toBe(false);
    expect(isCompressibleMimeType("application/zip")).toBe(false);
  });

  it("falls back to file extension when MIME is empty", () => {
    expect(isCompressibleMimeType("", "report.json")).toBe(true);
    expect(isCompressibleMimeType("", "data.csv")).toBe(true);
    expect(isCompressibleMimeType("", "photo.jpg")).toBe(false);
    expect(isCompressibleMimeType("", "archive.zip")).toBe(false);
  });
});

describe("compression — path helpers", () => {
  it("appends .gz to a file path", () => {
    expect(compressedFilePath("documents/abc/report.json")).toBe(
      "documents/abc/report.json.gz",
    );
    // idempotent — doesn't double-suffix
    expect(compressedFilePath("documents/abc/report.json.gz")).toBe(
      "documents/abc/report.json.gz",
    );
  });

  it("detects compressed paths", () => {
    expect(isCompressedPath("docs/x.json.gz")).toBe(true);
    expect(isCompressedPath("docs/x.json")).toBe(false);
  });
});
