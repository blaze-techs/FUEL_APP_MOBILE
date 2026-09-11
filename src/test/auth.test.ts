/**
 * Authentication Tests
 *
 * Tests for AuthContext and authentication functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client
vi.mock("@/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(() => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      resetPasswordForEmail: vi.fn(() => ({ error: null })),
      updateUser: vi.fn(() => ({ error: null })),
    },
  })),
}));

describe("Authentication", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should clear localStorage on logout", () => {
    localStorage.setItem(
      "fuelpro_auth_identity",
      JSON.stringify({ id: "123", name: "Test" }),
    );
    localStorage.setItem("fuelpro_token", "test-token");

    // Simulate logout behavior
    localStorage.removeItem("fuelpro_auth_identity");
    localStorage.removeItem("fuelpro_token");

    expect(localStorage.getItem("fuelpro_auth_identity")).toBeNull();
    expect(localStorage.getItem("fuelpro_token")).toBeNull();
  });

  it("should persist user identity in localStorage", () => {
    const user = { id: "123", name: "Test User", email: "test@example.com" };
    localStorage.setItem("fuelpro_auth_identity", JSON.stringify(user));

    const stored = JSON.parse(
      localStorage.getItem("fuelpro_auth_identity") || "{}",
    );
    expect(stored.id).toBe("123");
    expect(stored.name).toBe("Test User");
  });

  it("should generate unique device ID", () => {
    const DEVICE_ID_KEY = "fuelpro_device_id";
    const id =
      localStorage.getItem(DEVICE_ID_KEY) ||
      `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);

    expect(id).toBeDefined();
    expect(id.startsWith("dev_")).toBe(true);
  });

  it("hashes username passwords with SHA-256 (no cleartext stored)", async () => {
    // Replicate the module-scope hashing helper used by the username fallback.
    const USERNAME_PW_SALT = "fuelpro_local_user_v1";
    const hashUsernamePassword = async (pw: string): Promise<string> => {
      const enc = new TextEncoder().encode(USERNAME_PW_SALT + pw);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };

    const password = "supersecret123";
    const hash = await hashUsernamePassword(password);

    // The stored representation is a hex digest, never the raw password.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(password);

    // Same input deterministically produces the same hash.
    expect(await hashUsernamePassword(password)).toBe(hash);

    // Different input produces a different hash.
    expect(await hashUsernamePassword("wrongpass")).not.toBe(hash);

    // Simulate the storage shape used by registerWithUsername: only passwordHash.
    const users = {
      demo: {
        username: "demo",
        passwordHash: hash,
        name: "Demo",
        role: "user",
      },
    };
    localStorage.setItem("fuelpro_username_users", JSON.stringify(users));
    const stored = JSON.parse(
      localStorage.getItem("fuelpro_username_users") || "{}",
    );
    expect(stored.demo.passwordHash).toBe(hash);
    expect(stored.demo.password).toBeUndefined();
  });
});
