import type { LocaleKey } from "../../i18n/keys";

/**
 * Refresh cadences offered by both Settings → General and the tray panel's
 * Settings tab. `adaptive` is a distinct mode rather than an interval, so the
 * two consumers share this list to stay in lockstep.
 */
export const REFRESH_CADENCE_OPTIONS: { value: string; labelKey: LocaleKey }[] = [
  { value: "0", labelKey: "RefreshIntervalManual" },
  { value: "adaptive", labelKey: "RefreshIntervalAdaptive" },
  { value: "60", labelKey: "RefreshInterval1Min" },
  { value: "300", labelKey: "RefreshInterval5Min" },
  { value: "900", labelKey: "RefreshInterval15Min" },
  { value: "1800", labelKey: "RefreshInterval30Min" },
  { value: "3600", labelKey: "RefreshInterval1Hour" },
];

/** The option value matching the current settings pair. */
export function refreshCadenceValue(settings: {
  adaptiveRefresh: boolean;
  refreshIntervalSecs: number;
}): string {
  return settings.adaptiveRefresh
    ? "adaptive"
    : String(settings.refreshIntervalSecs);
}

/** The settings patch a chosen option maps to. */
export function refreshCadencePatch(value: string): {
  adaptiveRefresh: boolean;
  refreshIntervalSecs?: number;
} {
  if (value === "adaptive") return { adaptiveRefresh: true };
  return { adaptiveRefresh: false, refreshIntervalSecs: Number(value) };
}
