/**
 * Timestamp formatting for the tray History event list.
 *
 * Events that landed today read as a wall clock ("09:42"); anything older
 * collapses to a short calendar date ("Aug 3"), which is what the warm
 * handoff shows in the right-hand column.
 */
export function formatEventTime(
  timestamp: string | number | null | undefined,
  nowMs: number = Date.now(),
  locale?: string,
): string {
  if (timestamp == null) return "—";
  const parsed =
    typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "—";

  const date = new Date(parsed);
  const now = new Date(nowMs);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  try {
    return sameDay
      ? new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(date)
      : new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
        }).format(date);
  } catch {
    return date.toISOString().slice(sameDay ? 11 : 0, sameDay ? 16 : 10);
  }
}

/**
 * Short axis label for a `YYYY-MM-DD` chart point ("Aug 2").
 * Parsed as a local date so the label never slips a day across time zones.
 */
export function formatChartDay(date: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(parsed);
  } catch {
    return date;
  }
}
