import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => ({ rpc: rpcMock })),
}));

vi.mock("@/react-app/lib/connectivity", () => ({
  getSessionId: vi.fn(() => "session-a"),
  startConnectivity: vi.fn(),
}));

import {
  clearStationWriteLease,
  ensureStationWriteLease,
  StaleStationSessionError,
} from "@/react-app/lib/active-session-guard";

describe("active station session fencing", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearStationWriteLease();
  });

  it("accepts a server-issued lease and exposes its monotonic fence token", async () => {
    rpcMock.mockResolvedValue({
      data: {
        granted: true,
        session_id: "session-a",
        fence_token: 17,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });

    const lease = await ensureStationWriteLease("station-1");

    expect(lease.granted).toBe(true);
    expect(lease.sessionId).toBe("session-a");
    expect(lease.fenceToken).toBe(17);
    expect(rpcMock).toHaveBeenCalledWith("claim_station_active_session", {
      p_station_id: "station-1",
      p_session_id: "session-a",
    });
  });

  it("blocks a session when another active session owns the station", async () => {
    rpcMock.mockResolvedValue({
      data: {
        granted: false,
        session_id: "session-a",
        active_session_id: "session-b",
        fence_token: 18,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      },
      error: null,
    });

    await expect(ensureStationWriteLease("station-1")).rejects.toBeInstanceOf(
      StaleStationSessionError,
    );
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("does not keep retrying a fenced session before the active lease expires", async () => {
    const expiry = new Date(Date.now() + 30_000).toISOString();
    rpcMock.mockResolvedValue({
      data: {
        granted: false,
        session_id: "session-a",
        active_session_id: "session-b",
        fence_token: 19,
        expires_at: expiry,
      },
      error: null,
    });

    await expect(ensureStationWriteLease("station-1")).rejects.toBeInstanceOf(
      StaleStationSessionError,
    );
    await expect(ensureStationWriteLease("station-1")).rejects.toBeInstanceOf(
      StaleStationSessionError,
    );

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("allows the session to claim again after the previous lease expires", async () => {
    const expired = new Date(Date.now() - 1_000).toISOString();
    rpcMock
      .mockResolvedValueOnce({
        data: {
          granted: false,
          session_id: "session-a",
          active_session_id: "session-b",
          fence_token: 20,
          expires_at: expired,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          granted: true,
          session_id: "session-a",
          fence_token: 21,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      });

    await expect(ensureStationWriteLease("station-1")).rejects.toBeInstanceOf(
      StaleStationSessionError,
    );
    const lease = await ensureStationWriteLease("station-1");

    expect(lease.fenceToken).toBe(21);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
