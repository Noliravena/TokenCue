import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderUsageSnapshot } from "../types/bridge";
import {
  TRAY_HISTORY_STORAGE_KEY,
  readTrayHistory,
  updateTrayHistory,
} from "./trayHistory";

function snapshot(
  id: string,
  usedPercent: number,
  updatedAt: string,
  error: string | null = null,
): ProviderUsageSnapshot {
  return {
    providerId: id,
    displayName: id === "codex" ? "Codex" : "Claude",
    primary: {
      usedPercent,
      remainingPercent: 100 - usedPercent,
      windowMinutes: null,
      resetsAt: null,
      resetDescription: null,
      isExhausted: false,
      reservePercent: null,
      reserveDescription: null,
    },
    primaryLabel: "Session",
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    planName: null,
    accountEmail: null,
    sourceLabel: "local",
    updatedAt,
    error,
    pace: null,
    accountOrganization: null,
    trayStatusLabel: null,
  };
}

describe("tray history cache", () => {
  beforeEach(() => {
    localStorage.removeItem(TRAY_HISTORY_STORAGE_KEY);
  });

  it("establishes the first provider set as a baseline without fake events", () => {
    const events = updateTrayHistory(
      [
        snapshot("codex", 20, "2026-08-10T00:00:00Z"),
        snapshot("claude", 30, "2026-08-10T00:00:00Z"),
      ],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T00:00:00Z"),
    );

    expect(events).toEqual([]);
    expect(readTrayHistory()).toEqual([]);
  });

  it("records threshold crossings, resets, and provider recovery once", () => {
    updateTrayHistory(
      [snapshot("codex", 60, "2026-08-10T00:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T00:00:00Z"),
    );
    updateTrayHistory(
      [snapshot("codex", 75, "2026-08-10T01:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T01:00:00Z"),
    );
    updateTrayHistory(
      [snapshot("codex", 98, "2026-08-10T02:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T02:00:00Z"),
    );
    updateTrayHistory(
      [snapshot("codex", 3, "2026-08-10T03:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T03:00:00Z"),
    );
    updateTrayHistory(
      [snapshot("codex", 3, "2026-08-10T04:00:00Z", "expired")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T04:00:00Z"),
    );
    const events = updateTrayHistory(
      [snapshot("codex", 4, "2026-08-10T05:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T05:00:00Z"),
    );

    expect(events.map((event) => event.kind)).toEqual([
      "recovered",
      "error",
      "reset",
      "critical",
      "warning",
    ]);

    const repeated = updateTrayHistory(
      [snapshot("codex", 4, "2026-08-10T05:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T05:00:00Z"),
    );
    expect(repeated).toHaveLength(5);
  });

  it("records a provider connected after the initial baseline", () => {
    updateTrayHistory(
      [snapshot("codex", 20, "2026-08-10T00:00:00Z")],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T00:00:00Z"),
    );
    const events = updateTrayHistory(
      [
        snapshot("codex", 20, "2026-08-10T00:00:00Z"),
        snapshot("claude", 10, "2026-08-10T01:00:00Z"),
      ],
      70,
      95,
      localStorage,
      Date.parse("2026-08-10T01:00:00Z"),
    );

    expect(events).toMatchObject([
      { providerId: "claude", kind: "connected" },
    ]);
  });
});
