import { describe, expect, it } from "vitest";
import { formatChartDay, formatEventTime } from "./eventTime";

const NOW = Date.parse("2026-08-09T14:30:00Z");

describe("formatEventTime", () => {
  it("renders a 24h clock for events from today", () => {
    expect(formatEventTime("2026-08-09T09:42:00Z", NOW, "en-US")).toBe("09:42");
  });

  it("renders a short date for older events", () => {
    expect(formatEventTime("2026-08-03T09:42:00Z", NOW, "en-US")).toBe("Aug 3");
  });

  it("falls back to a dash for missing or unparseable stamps", () => {
    expect(formatEventTime(null, NOW, "en-US")).toBe("—");
    expect(formatEventTime("not a date", NOW, "en-US")).toBe("—");
  });
});

describe("formatChartDay", () => {
  it("formats an ISO calendar day", () => {
    expect(formatChartDay("2026-08-02", "en-US")).toBe("Aug 2");
  });

  it("parses as a local date so the label cannot slip a day", () => {
    // A UTC parse of "2026-01-01" renders as Dec 31 west of Greenwich.
    expect(formatChartDay("2026-01-01", "en-US")).toBe("Jan 1");
  });

  it("passes through anything that is not an ISO day", () => {
    expect(formatChartDay("last week", "en-US")).toBe("last week");
  });
});
