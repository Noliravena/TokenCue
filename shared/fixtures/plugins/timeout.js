defineProvider({
  schemaVersion: 1,
  id: "timeout-fixture",
  name: "Timeout Fixture",
  endpoints: ["https://api.example.com"],
  settings: [],
  limits: { timeoutMs: 100, maxResponseBytes: 1048576 },
  fetchUsage() {
    while (true) {}
  },
});
