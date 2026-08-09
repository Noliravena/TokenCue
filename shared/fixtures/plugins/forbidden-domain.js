defineProvider({
  schemaVersion: 1,
  id: "forbidden-domain-fixture",
  name: "Forbidden Domain Fixture",
  endpoints: ["https://api.example.com"],
  settings: [],
  async fetchUsage(ctx) {
    await ctx.http.getJSON("https://unapproved.example/v1/usage");
    return { primary: { usedPercent: 1 } };
  },
});
