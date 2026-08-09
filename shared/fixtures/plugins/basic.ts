defineProvider({
  schemaVersion: 1,
  id: "fixture-provider",
  name: "Fixture Provider",
  icon: { monogram: "FP", tint: "#4F46E5" },
  endpoints: ["https://api.example.com"],
  settings: [],
  limits: { timeoutMs: 10000, maxResponseBytes: 1048576 },

  async fetchUsage(ctx: unknown): Promise<object> {
    await Promise.resolve();
    const helpers = ctx as { pct: (used: number, limit: number) => number };
    return {
      primary: { usedPercent: helpers.pct(23, 50), windowMinutes: 300 },
      secondary: { usedPercent: 72, windowMinutes: 10080 },
      identity: { loginMethod: "Fixture Pro" },
      cost: { used: 12.5, limit: 25, currency: "USD", period: "Monthly", balance: 7.5 },
    };
  },
});
