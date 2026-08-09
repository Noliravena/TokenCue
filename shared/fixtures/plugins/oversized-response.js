defineProvider({
  schemaVersion: 1,
  id: "oversized-response-fixture",
  name: "Oversized Response Fixture",
  endpoints: ["https://api.example.com"],
  settings: [],
  limits: { timeoutMs: 10000, maxResponseBytes: 1024 },
  async fetchUsage(ctx) {
    await ctx.http.getJSON("https://api.example.com/oversized");
    return { primary: { usedPercent: 1 } };
  },
});
