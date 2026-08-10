import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderUsageSnapshot } from "../types/bridge";
import {
  TRAY_HISTORY_STORAGE_KEY,
  readTrayBillingHistory,
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
    displayName: id === "codex" ? "Codex" : id === "grok" ? "Grok" : "Claude",
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

  it("stores provider billing quota by local day and keeps the latest daily sample", () => {
    const firstDay = new Date(2026, 7, 9, 10, 0, 0);
    const laterFirstDay = new Date(2026, 7, 9, 18, 0, 0);
    const secondDay = new Date(2026, 7, 10, 10, 0, 0);

    updateTrayHistory(
      [snapshot("grok", 18, firstDay.toISOString())],
      70,
      95,
      localStorage,
      firstDay.getTime(),
    );
    updateTrayHistory(
      [snapshot("grok", 26, laterFirstDay.toISOString())],
      70,
      95,
      localStorage,
      laterFirstDay.getTime(),
    );
    updateTrayHistory(
      [snapshot("grok", 31, secondDay.toISOString())],
      70,
      95,
      localStorage,
      secondDay.getTime(),
    );

    expect(readTrayBillingHistory("GROK")).toMatchObject([
      { date: "2026-08-09", value: 26, metric: "quota", currency: "" },
      { date: "2026-08-10", value: 31, metric: "quota", currency: "" },
    ]);
  });

  it("records monetary spend and balance with distinct metrics", () => {
    const observedAt = new Date(2026, 7, 10, 10, 0, 0);
    const spend = snapshot("deepseek", 20, observedAt.toISOString(), null);
    spend.cost = {
      used: 4.25,
      limit: 20,
      remaining: 15.75,
      currencyCode: "USD",
      period: "Current month",
      resetsAt: null,
      formattedUsed: "$4.25",
      formattedLimit: "$20.00",
      balance: null,
      formattedBalance: null,
    };
    const balance = snapshot("moonshot", 0, observedAt.toISOString(), null);
    balance.primary.isInformational = true;
    balance.cost = {
      used: 0,
      limit: null,
      remaining: null,
      currencyCode: "USD",
      period: "Balance",
      resetsAt: null,
      formattedUsed: "$0.00",
      formattedLimit: null,
      balance: 12.5,
      formattedBalance: "$12.50",
    };

    updateTrayHistory([spend, balance], 70, 95, localStorage, observedAt.getTime());

    expect(readTrayBillingHistory("deepseek")).toMatchObject([
      { value: 4.25, metric: "spend", currency: "USD" },
    ]);
    expect(readTrayBillingHistory("moonshot")).toMatchObject([
      { value: 12.5, metric: "balance", currency: "USD" },
    ]);
  });

  it("migrates the Grok quota history written by the previous store shape", () => {
    localStorage.setItem(
      TRAY_HISTORY_STORAGE_KEY,
      JSON.stringify({
        events: [],
        baselines: {},
        quotaHistory: {
          grok: [{ date: "2026-08-10", value: 22, at: 1_786_300_000_000 }],
        },
      }),
    );

    expect(readTrayBillingHistory("grok")).toMatchObject([
      { date: "2026-08-10", value: 22, metric: "quota", currency: "" },
    ]);
  });
});
