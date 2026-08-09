defineProvider({
  schemaVersion: 1,
  id: "cookie-fixture",
  name: "Cookie Fixture",
  endpoints: ["https://api.example.com"],
  settings: [],
  capabilities: ["browser-cookies"],
  cookieDomains: ["example.com"],
  async fetchUsage(ctx) {
    await ctx.browser.cookieHeader("example.com");
    return { primary: { usedPercent: 1 } };
  },
});
