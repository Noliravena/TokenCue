import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  BootstrapState,
  ProviderChartData,
  ProviderUsageSnapshot,
  RateWindowSnapshot,
  UsageSpendSummary,
} from "../types/bridge";
import {
  beginFlyoutGesture,
  getAppInfo,
  getProviderChartData,
  getUsageSpendSummary,
  updateSettings,
} from "../lib/tauri";
import {
  REFRESH_CADENCE_OPTIONS,
  refreshCadencePatch,
  refreshCadenceValue,
} from "./settings/refreshCadence";
import { useTrayPanelController } from "../hooks/useTrayPanelController";
import { useFormattedResetTime } from "../hooks/useFormattedResetTime";
import { formatRelativeUpdated } from "../lib/relativeTime";
import { formatChartDay, formatEventTime } from "../lib/eventTime";
import { providerSupportsChartData } from "../lib/providerCharts";
import { languageTag } from "../i18n/languageTag";
import { ProviderIcon } from "../components/providers/ProviderIcon";
import { getProviderIcon } from "../components/providers/providerIcons";
import { Toggle } from "../components/FormControls";
import type { LocaleKey } from "../i18n/keys";
import { BrandMark } from "../components/BrandMark";

type Translate = (key: LocaleKey) => string;
type TrayTabId = "quota" | "spend" | "history" | "settings";

const HISTORY_RANGES = [7, 14, 30] as const;
type HistoryRange = (typeof HISTORY_RANGES)[number];

/** The local JSONL cost scanners price everything in USD. */
const LOCAL_SCANNER_CURRENCY = "USD";

/** Brand tiles that fit the 380px footer without wrapping. */
const SWITCHER_LIMIT = 8;

/** DOM id linking a footer switcher tile to its quota card. */
function quotaCardId(providerId: string) {
  return `tokencue-quota-${providerId}`;
}

/** Chart viewBox the History sparkline is drawn into. */
const SPARK_WIDTH = 300;
const SPARK_HEIGHT = 78;

/**
 * Turn a value series into the stroked line plus its closed fill, scaled so
 * the largest point sits just under the top edge and a flat series still
 * reads as a baseline rather than collapsing to nothing.
 */
function buildAreaPath(values: number[]): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const top = 6;
  const bottom = SPARK_HEIGHT - 8;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * SPARK_WIDTH;
    const ratio = span > 0 ? (value - min) / span : 0.5;
    const y = bottom - ratio * (bottom - top);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${points.join(" L")}`;
  return {
    line,
    area: `${line} L${SPARK_WIDTH} ${SPARK_HEIGHT} L0 ${SPARK_HEIGHT} Z`,
  };
}

function levelFor(
  snapshot: RateWindowSnapshot,
  highThreshold: number,
  criticalThreshold: number,
) {
  if (snapshot.isExhausted || snapshot.usedPercent >= criticalThreshold) {
    return "critical";
  }
  if (snapshot.usedPercent >= highThreshold) return "warning";
  return "normal";
}

function isStale(provider: ProviderUsageSnapshot, refreshIntervalSecs: number) {
  const updatedAt = Date.parse(provider.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  const staleAfter = Math.max(refreshIntervalSecs * 2_000, 15 * 60_000);
  return Date.now() - updatedAt > staleAfter;
}

function compactEta(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatMoney(
  value: number | null | undefined,
  currency = "USD",
  locale?: string,
) {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function displayPercent(
  usedPercent: number,
  showAsUsed: boolean,
): { value: number; labelKey: LocaleKey } {
  const clamped = Math.max(0, Math.min(100, usedPercent));
  if (showAsUsed) {
    return { value: clamped, labelKey: "PanelUsedSuffix" };
  }
  return { value: Math.max(0, 100 - clamped), labelKey: "PanelLeftSuffix" };
}

function TabIcon({ id }: { id: TrayTabId }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "quota") {
    return (
      <svg {...common}>
        <rect x="2" y="4.5" width="12" height="8" rx="2" />
        <path d="M5.5 4.5V3M10.5 4.5V3" />
      </svg>
    );
  }
  if (id === "spend") {
    return (
      <svg {...common}>
        <path d="M2.5 12.5V6M6.5 12.5V3.5M10.5 12.5V8M14 12.5V5" />
      </svg>
    );
  }
  if (id === "history") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5v3.2l2 1.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

type LinkTone = "providers" | "menuBar" | "floatBar" | "spend" | "about";

/**
 * Tinted tile glyphs for the tray Settings shortcut rows. The tile background
 * and stroke come from `[data-tone]` in CSS so both themes get their own
 * values instead of one hard-coded light-mode pastel.
 */
function LinkIcon({ tone }: { tone: LinkTone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "providers") {
    return (
      <svg {...common}>
        <circle cx="4" cy="4" r="1.5" />
        <circle cx="12" cy="4" r="1.5" />
        <circle cx="8" cy="12" r="1.5" />
        <path d="M5.3 4.8 7.2 10M10.7 4.8 8.8 10M5.5 4h5" />
      </svg>
    );
  }
  if (tone === "menuBar") {
    return (
      <svg {...common}>
        <path d="M1.5 8c1.6-3 4-4.5 6.5-4.5S13 5 14.5 8c-1.5 3-4 4.5-6.5 4.5S3.1 11 1.5 8Z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    );
  }
  if (tone === "floatBar") {
    return (
      <svg {...common}>
        <rect x="2" y="6" width="12" height="4" rx="2" />
        <path d="M5 6V4M11 10v2" />
      </svg>
    );
  }
  if (tone === "spend") {
    return (
      <svg {...common}>
        <path d="M2 12.5V4.5h12v8" />
        <path d="M4.5 10V8M7.5 10V6.5M10.5 10V7.2M13 10V5.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7v4" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function QuotaCard({
  provider,
  settings,
  t,
  onFix,
}: {
  provider: ProviderUsageSnapshot;
  settings: BootstrapState["settings"];
  t: Translate;
  onFix: () => void;
}) {
  const reset = useFormattedResetTime(
    provider.primary.resetsAt,
    provider.primary.resetDescription,
    settings.resetTimeRelative,
  );
  const level = levelFor(
    provider.primary,
    settings.highUsageThreshold,
    settings.criticalUsageThreshold,
  );
  const used = Math.max(0, Math.min(100, provider.primary.usedPercent));
  const shown = displayPercent(used, settings.showAsUsed);
  const stale = isStale(provider, settings.refreshIntervalSecs);
  const brand = getProviderIcon(provider.providerId).brandColor;
  const className = [
    "tokencue-tray__card",
    stale ? "tokencue-tray__card--stale" : "",
    provider.error ? "tokencue-tray__card--error" : "",
    level === "critical" ? "tokencue-tray__card--critical" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (provider.error) {
    return (
      <article className={className} id={quotaCardId(provider.providerId)}>
        <div className="tokencue-tray__card-head">
          <span
            className="tokencue-tray__brand-icon"
            style={{ background: brand }}
          >
            <ProviderIcon providerId={provider.providerId} size={19} />
          </span>
          <span className="tokencue-tray__card-meta">
            <span className="tokencue-tray__card-name">{provider.displayName}</span>
            <span className="tokencue-tray__card-sub tokencue-tray__card-sub--error">
              {provider.error}
            </span>
          </span>
          <button type="button" className="tokencue-tray__pill-btn" onClick={onFix}>
            {t("TrayFixProvider")}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className={className} id={quotaCardId(provider.providerId)}>
      <div className="tokencue-tray__card-head">
        <span className="tokencue-tray__brand-icon" style={{ background: brand }}>
          <ProviderIcon providerId={provider.providerId} size={19} />
        </span>
        <span className="tokencue-tray__card-meta">
          <span className="tokencue-tray__card-name">{provider.displayName}</span>
          <span className="tokencue-tray__card-sub tokencue-tray__mono">
            {reset ? `${reset}` : "—"}
          </span>
        </span>
        <span className="tokencue-tray__card-pct" data-level={level}>
          <span className="tokencue-tray__card-pct-num">
            {Math.round(shown.value)}
            <span className="tokencue-tray__card-pct-unit">%</span>
          </span>
          <span className="tokencue-tray__card-pct-label">{t(shown.labelKey)}</span>
        </span>
      </div>
      <div className="tokencue-tray__track" aria-hidden>
        <span
          className="tokencue-tray__fill"
          data-level={level}
          style={{ width: `${settings.showAsUsed ? used : shown.value}%` }}
        />
      </div>
      {(provider.planName || provider.pace || provider.secondary) && (
        <div className="tokencue-tray__chips">
          {provider.planName ? (
            <span className="tokencue-tray__chip">{provider.planName}</span>
          ) : null}
          {provider.secondary ? (
            <span className="tokencue-tray__chip tokencue-tray__mono">
              {Math.round(provider.secondary.usedPercent)}%
            </span>
          ) : null}
          {provider.pace && !provider.pace.willLastToReset ? (
            <span className="tokencue-tray__chip tokencue-tray__chip--warn">
              {t("PredictivePaceWarningBody").replace(
                "{}",
                provider.pace.etaSeconds == null
                  ? "—"
                  : compactEta(provider.pace.etaSeconds),
              )}
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

function SpendTab({
  t,
  locale,
  openSettings,
}: {
  t: Translate;
  locale: string;
  openSettings: () => void;
}) {
  const [summary, setSummary] = useState<UsageSpendSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getUsageSpendSummary()
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        if (!cancelled) setSummary({ rows: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = summary?.rows ?? [];
  const daily = summary?.daily ?? [];
  // Providers bill in their own currencies and TokenCue never applies an
  // exchange rate, so the 30-day figure lists each currency separately.
  const thirtyTotal = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      if (row.thirtyDay == null || !Number.isFinite(row.thirtyDay)) continue;
      const code = row.currency || LOCAL_SCANNER_CURRENCY;
      totals.set(code, (totals.get(code) ?? 0) + row.thirtyDay);
    }
    return {
      text:
        totals.size === 0
          ? "—"
          : [...totals]
              .map(([code, value]) => formatMoney(value, code, locale))
              .join(" · "),
      // Two currencies is two amounts; the display size has to give.
      multi: totals.size > 1,
    };
  }, [locale, rows]);

  // `today` comes from the day-level local scanners (USD); providers that
  // only report a billing-period total reach the table but not this figure.
  const today = summary?.today ?? null;

  const bars = useMemo(() => {
    const max = Math.max(0, ...daily.map((point) => point.value));
    return daily.map((point) => {
      const ratio = max > 0 ? point.value / max : 0;
      return {
        date: point.date,
        value: point.value,
        h: `${Math.max(6, Math.round(ratio * 100))}%`,
        hot: ratio > 0.6,
        mid: ratio > 0.4,
      };
    });
  }, [daily]);

  if (loading) {
    return (
      <div className="tokencue-tray__body">
        <p className="tokencue-tray__hint">{t("UsageSpendLoading")}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="tokencue-tray__body">
        <p className="tokencue-tray__hint">{t("UsageSpendEmpty")}</p>
        <button type="button" className="tokencue-tray__cta" onClick={openSettings}>
          {t("TrayOpenFullSettings")}
        </button>
      </div>
    );
  }

  return (
    <div className="tokencue-tray__body">
      <article className="tokencue-tray__card tokencue-tray__card--stack">
        <div className="tokencue-tray__spend-hero">
          <span>
            <span className="tokencue-tray__eyebrow">{t("TrayTodayLabel")}</span>
            <span className="tokencue-tray__display-num">
              {formatMoney(today, LOCAL_SCANNER_CURRENCY, locale)}
            </span>
          </span>
          <span className="tokencue-tray__spend-hero-side">
            <span className="tokencue-tray__eyebrow">{t("TrayLast30DaysLabel")}</span>
            <span
              className={`tokencue-tray__display-num tokencue-tray__display-num--sm${
                thirtyTotal.multi ? " tokencue-tray__display-num--multi" : ""
              }`}
            >
              {thirtyTotal.text}
            </span>
          </span>
        </div>
        {bars.length > 0 ? (
          <>
            <div className="tokencue-tray__bars">
              {bars.map((bar) => (
                <span
                  key={bar.date}
                  className={[
                    "tokencue-tray__bar",
                    bar.hot ? "is-hot" : bar.mid ? "is-mid" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: bar.h }}
                  title={`${formatChartDay(bar.date, locale)} · ${formatMoney(bar.value, LOCAL_SCANNER_CURRENCY, locale)}`}
                />
              ))}
            </div>
            <div className="tokencue-tray__axis tokencue-tray__mono">
              <span>{t("TraySpendAxisStart").replace("{}", String(bars.length))}</span>
              <span>{t("TrayTodayLabel")}</span>
            </div>
          </>
        ) : null}
      </article>

      <article className="tokencue-tray__card tokencue-tray__card--list">
        {rows.map((row) => {
          const brand = getProviderIcon(row.providerId).brandColor;
          return (
            <div key={row.providerId} className="tokencue-tray__list-row">
              <span className="tokencue-tray__brand-icon tokencue-tray__brand-icon--sm" style={{ background: brand }}>
                <ProviderIcon providerId={row.providerId} size={15} />
              </span>
              <span className="tokencue-tray__list-name">{row.displayName}</span>
              <span className="tokencue-tray__list-meta tokencue-tray__mono">
                7d {formatMoney(row.sevenDay, row.currency, locale)}
              </span>
              <span className="tokencue-tray__list-value">
                {formatMoney(row.thirtyDay, row.currency, locale)}
              </span>
            </div>
          );
        })}
      </article>
      <p className="tokencue-tray__hint">{t("TraySpendDisclaimer")}</p>
    </div>
  );
}

function HistoryTab({
  providers,
  settings,
  t,
  locale,
}: {
  providers: ProviderUsageSnapshot[];
  settings: BootstrapState["settings"];
  t: Translate;
  locale: string;
}) {
  // Only a few providers ship a real per-day series; the rest would need an
  // invented curve, so the chart card simply does not appear for them.
  const chartable = useMemo(
    () => providers.filter((provider) => providerSupportsChartData(provider.providerId)),
    [providers],
  );
  const [chartProviderId, setChartProviderId] = useState<string | null>(null);
  const [range, setRange] = useState<HistoryRange>(7);
  const [chart, setChart] = useState<ProviderChartData | null>(null);

  const activeProvider =
    chartable.find((provider) => provider.providerId === chartProviderId) ??
    chartable[0] ??
    null;
  const activeId = activeProvider?.providerId ?? null;

  useEffect(() => {
    if (!activeId) {
      setChart(null);
      return;
    }
    let cancelled = false;
    void getProviderChartData(activeId)
      .then((next) => {
        if (!cancelled) setChart(next);
      })
      .catch(() => {
        if (!cancelled) setChart(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // These are current alerts derived from the latest snapshots, not a
  // persisted event ledger. Keep the UI language honest about that scope.
  const alerts = useMemo(() => {
    const rows: Array<{
      title: string;
      detail: string;
      tone: string;
      at: number;
      time: string;
    }> = [];
    for (const provider of providers) {
      const at = Date.parse(provider.updatedAt);
      // The backend keeps no event log, so an observation is timestamped with
      // the refresh that saw it.
      const time = formatEventTime(provider.updatedAt, Date.now(), locale);
      if (provider.error) {
        rows.push({
          title: provider.displayName,
          detail: provider.error,
          tone: "critical",
          at: Number.isFinite(at) ? at : 0,
          time,
        });
        continue;
      }
      const level = levelFor(
        provider.primary,
        settings.highUsageThreshold,
        settings.criticalUsageThreshold,
      );
      if (level === "critical" || level === "warning") {
        rows.push({
          title: provider.displayName,
          detail: `${Math.round(provider.primary.usedPercent)}%`,
          tone: level,
          at: Number.isFinite(at) ? at : 0,
          time,
        });
      }
      if (provider.pace && !provider.pace.willLastToReset) {
        rows.push({
          title: provider.displayName,
          detail: t("PredictivePaceWarningBody").replace(
            "{}",
            provider.pace.etaSeconds == null
              ? "—"
              : compactEta(provider.pace.etaSeconds),
          ),
          tone: "warning",
          at: Number.isFinite(at) ? at : 0,
          time,
        });
      }
    }
    return rows.sort((left, right) => right.at - left.at).slice(0, 6);
  }, [locale, providers, settings, t]);

  const series = useMemo(() => {
    const source =
      chart && chart.costHistory.length > 0
        ? chart.costHistory
        : (chart?.creditsHistory ?? []);
    return source.slice(-range);
  }, [chart, range]);

  const paths = useMemo(() => buildAreaPath(series.map((point) => point.value)), [series]);

  return (
    <div className="tokencue-tray__body">
      {activeProvider && series.length > 1 ? (
        <article className="tokencue-tray__card tokencue-tray__card--stack">
          <div className="tokencue-tray__history-head">
            <span
              className="tokencue-tray__brand-icon tokencue-tray__brand-icon--sm"
              style={{ background: getProviderIcon(activeProvider.providerId).brandColor }}
            >
              <ProviderIcon providerId={activeProvider.providerId} size={13} />
            </span>
            {chartable.length > 1 ? (
              <select
                className="tokencue-tray__chip tokencue-tray__chip--select"
                aria-label={t("TrayHistoryProviderLabel")}
                value={activeProvider.providerId}
                onChange={(event) => setChartProviderId(event.currentTarget.value)}
              >
                {chartable.map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{activeProvider.displayName}</strong>
            )}
            <select
              className="tokencue-tray__chip tokencue-tray__chip--select"
              aria-label={t("TrayHistoryRangeLabel")}
              value={range}
              onChange={(event) =>
                setRange(Number(event.currentTarget.value) as HistoryRange)
              }
            >
              {HISTORY_RANGES.map((days) => (
                <option key={days} value={days}>
                  {t("TrayHistoryRangeDays").replace("{}", String(days))}
                </option>
              ))}
            </select>
          </div>
          <div className="tokencue-tray__spark">
            <svg viewBox="0 0 300 78" preserveAspectRatio="none" aria-hidden>
              <path d={paths.area} className="tokencue-tray__spark-fill" />
              <path d={paths.line} className="tokencue-tray__spark-line" />
            </svg>
          </div>
          <div className="tokencue-tray__spark-legend tokencue-tray__mono">
            <span>{formatChartDay(series[0].date, locale)}</span>
            <span>
              {t("TrayHistoryCumulative").replace(
                "{}",
                String(Math.round(activeProvider.primary.usedPercent)),
              )}
            </span>
            <span>{t("TrayTodayLabel")}</span>
          </div>
        </article>
      ) : null}

      <p className="tokencue-tray__eyebrow">{t("TrayCurrentAlerts")}</p>
      <article className="tokencue-tray__card tokencue-tray__card--list">
        {alerts.length === 0 ? (
          <p className="tokencue-tray__hint tokencue-tray__hint--inset">
            {t("TrayNoCurrentAlerts")}
          </p>
        ) : (
          alerts.map((event, index) => (
            <div key={`${event.title}-${index}`} className="tokencue-tray__event">
              <span className="tokencue-tray__event-dot" data-tone={event.tone} />
              <span className="tokencue-tray__event-copy">
                <span className="tokencue-tray__event-title">{event.title}</span>
                <span className="tokencue-tray__event-detail">{event.detail}</span>
              </span>
              <span className="tokencue-tray__event-time tokencue-tray__mono">
                {event.time}
              </span>
            </div>
          ))
        )}
      </article>
    </div>
  );
}

function SettingsTab({
  settings,
  t,
  openSettings,
  openUsageSpend,
  openMenuBarSettings,
  openFloatBarSettings,
  openAbout,
}: {
  settings: BootstrapState["settings"];
  t: Translate;
  openSettings: () => void;
  openUsageSpend: () => void;
  openMenuBarSettings: () => void;
  openFloatBarSettings: () => void;
  openAbout: () => void;
}) {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getAppInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(info.version);
      })
      .catch(() => {
        if (!cancelled) setAppVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayModeLabel = t(
    settings.menuBarDisplayMode === "compact"
      ? "DisplayModeCompact"
      : settings.menuBarDisplayMode === "minimal"
        ? "DisplayModeMinimal"
        : "DisplayModeDetailed",
  );

  const links: Array<{
    tone: LinkTone;
    label: string;
    value: string;
    onClick: () => void;
  }> = [
    {
      tone: "providers",
      label: t("TabProviders"),
      value: t("TrayProvidersEnabled").replace(
        "{}",
        String(settings.enabledProviders.length),
      ),
      onClick: openSettings,
    },
    {
      tone: "menuBar",
      label: t("TabMenuBar"),
      value: displayModeLabel,
      onClick: openMenuBarSettings,
    },
    {
      tone: "floatBar",
      label: t("FloatBarSectionTitle"),
      value: settings.floatBarEnabled ? t("ProviderEnabled") : t("ProviderDisabled"),
      onClick: openFloatBarSettings,
    },
    {
      tone: "spend",
      label: t("UsageSpendTitle"),
      value: "",
      onClick: openUsageSpend,
    },
    {
      tone: "about",
      label: t("TabAbout"),
      value: appVersion ?? "",
      onClick: openAbout,
    },
  ];

  return (
    <div className="tokencue-tray__body">
      <article className="tokencue-tray__card tokencue-tray__card--list">
        <label className="tokencue-tray__setting-row">
          <span>
            <span className="tokencue-tray__setting-title">{t("ShowNotifications")}</span>
            <span className="tokencue-tray__setting-help">{t("ShowNotificationsHelper")}</span>
          </span>
          <Toggle
            checked={settings.showNotifications}
            onChange={(v) => void updateSettings({ showNotifications: v })}
            ariaLabel={t("ShowNotifications")}
          />
        </label>
        <label className="tokencue-tray__setting-row">
          <span>
            <span className="tokencue-tray__setting-title">{t("ShowUsageAsUsed")}</span>
            <span className="tokencue-tray__setting-help">{t("ShowUsageAsUsedHelper")}</span>
          </span>
          <Toggle
            checked={settings.showAsUsed}
            onChange={(v) => void updateSettings({ showAsUsed: v })}
            ariaLabel={t("ShowUsageAsUsed")}
          />
        </label>
        <div className="tokencue-tray__setting-row">
          <span>
            <span className="tokencue-tray__setting-title">{t("RefreshIntervalLabel")}</span>
            <span className="tokencue-tray__setting-help">{t("RefreshIntervalHelper")}</span>
          </span>
          <select
            className="tokencue-tray__chip tokencue-tray__chip--select"
            aria-label={t("RefreshIntervalLabel")}
            value={refreshCadenceValue(settings)}
            onChange={(event) =>
              void updateSettings(refreshCadencePatch(event.currentTarget.value))
            }
          >
            {REFRESH_CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </article>

      <article className="tokencue-tray__card tokencue-tray__card--list">
        {links.map((link) => (
          <button
            key={link.tone}
            type="button"
            className="tokencue-tray__link-row"
            onClick={link.onClick}
          >
            <span className="tokencue-tray__link-icon" data-tone={link.tone}>
              <LinkIcon tone={link.tone} />
            </span>
            <span className="tokencue-tray__list-name">{link.label}</span>
            {link.value ? (
              <span className="tokencue-tray__link-value">{link.value}</span>
            ) : null}
            <span className="tokencue-tray__chevron" aria-hidden>
              ›
            </span>
          </button>
        ))}
      </article>

      <button type="button" className="tokencue-tray__cta" onClick={openSettings}>
        {t("TrayOpenFullSettings")}
      </button>
    </div>
  );
}

export default function TrayPanel({ state }: { state: BootstrapState }) {
  const {
    t,
    language,
    settings,
    isRefreshing,
    refresh,
    sorted,
    trayScale,
    layoutReady,
    openSettings,
    openUsageSpend,
    openMenuBarSettings,
    openFloatBarSettings,
    openAbout,
    openPopOut,
    quitApp,
    revealClassName,
  } = useTrayPanelController(state);

  const locale = languageTag(language);
  const [tab, setTab] = useState<TrayTabId>("quota");
  // Footer switcher: jump back to the quota list and bring that provider's
  // card into view once the tab has rendered.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const focusProvider = useCallback((providerId: string) => {
    setTab("quota");
    setPendingFocus(providerId);
  }, []);
  useEffect(() => {
    if (!pendingFocus) return;
    const card = document.getElementById(quotaCardId(pendingFocus));
    // Guarded: the tab switch is the point, scrolling is the nicety, and
    // `scrollIntoView` is absent in some embedded webviews.
    card?.scrollIntoView?.({ block: "nearest" });
    setPendingFocus(null);
  }, [pendingFocus]);

  const latestTimestamp = sorted.reduce((latest, provider) => {
    const parsed = Date.parse(provider.updatedAt);
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  const updated = latestTimestamp
    ? formatRelativeUpdated(latestTimestamp, t)
    : "—";

  const tabs: Array<{ id: TrayTabId; labelKey: LocaleKey }> = [
    { id: "quota", labelKey: "TrayTabQuota" },
    { id: "spend", labelKey: "TrayTabSpend" },
    { id: "history", labelKey: "TrayTabHistory" },
    { id: "settings", labelKey: "TrayTabSettings" },
  ];

  let body: ReactNode;
  if (sorted.length === 0 && tab === "quota") {
    body = (
      <div className="tokencue-tray__empty">
        <BrandMark className="tokencue-tray__empty-icon" size={60} />
        <h2>{t("TrayEmptyTitle")}</h2>
        <p>{t("NoProvidersConfigured")}</p>
        <button type="button" className="tokencue-tray__cta" onClick={openSettings}>
          {t("TrayEmptyConnect")}
        </button>
      </div>
    );
  } else if (tab === "quota") {
    body = (
      <div className="tokencue-tray__body">
        {sorted.map((provider) => (
          <QuotaCard
            key={provider.providerId}
            provider={provider}
            settings={settings}
            t={t}
            onFix={openSettings}
          />
        ))}
      </div>
    );
  } else if (tab === "spend") {
    body = <SpendTab t={t} locale={locale} openSettings={openSettings} />;
  } else if (tab === "history") {
    body = (
      <HistoryTab providers={sorted} settings={settings} t={t} locale={locale} />
    );
  } else {
    body = (
      <SettingsTab
        settings={settings}
        t={t}
        openSettings={openSettings}
        openUsageSpend={openUsageSpend}
        openMenuBarSettings={openMenuBarSettings}
        openFloatBarSettings={openFloatBarSettings}
        openAbout={openAbout}
      />
    );
  }

  return (
    <div className={`${revealClassName}${layoutReady ? "" : " tokencue-tray--measuring"}`}>
      <section
        className="tokencue-tray"
        style={{ "--tray-scale": trayScale } as CSSProperties}
      >
        <header className="tokencue-tray__header">
          <div className="tokencue-tray__traffic" aria-hidden>
            <span />
            <span />
          </div>
          <div className="tokencue-tray__brand">
            <BrandMark className="tokencue-tray__logo" size={22} />
            <strong>TokenCue</strong>
          </div>
        </header>

        <nav className="tokencue-tray__tabs" role="tablist" aria-label="Tray">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`tokencue-tray__tab${tab === item.id ? " is-active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              <TabIcon id={item.id} />
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="tokencue-tray__scroll">{body}</div>

        <footer className="tokencue-tray__footer">
          <button
            type="button"
            className="tokencue-tray__footer-btn"
            aria-label={t("TrayPopOutDashboard")}
            title={t("TrayPopOutDashboard")}
            onClick={openPopOut}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M13 8H5.5M8.5 4.5 5 8l3.5 3.5M13 3v10" />
            </svg>
          </button>

          {settings.switcherShowsIcons && sorted.length > 0 ? (
            <div className="tokencue-tray__switcher">
              {sorted.slice(0, SWITCHER_LIMIT).map((provider) => (
                <button
                  key={provider.providerId}
                  type="button"
                  className="tokencue-tray__switcher-btn"
                  style={{ background: getProviderIcon(provider.providerId).brandColor }}
                  aria-label={provider.displayName}
                  title={provider.displayName}
                  onClick={() => focusProvider(provider.providerId)}
                >
                  <ProviderIcon providerId={provider.providerId} size={14} />
                </button>
              ))}
            </div>
          ) : (
            <span className="tokencue-tray__updated">{updated}</span>
          )}

          <button
            type="button"
            className={`tokencue-tray__kbd${isRefreshing ? " is-refreshing" : ""}`}
            aria-label={t("ActionRefresh")}
            title={t("ActionRefresh")}
            onClick={refresh}
          >
            Ctrl R
          </button>
          <button
            type="button"
            className="tokencue-tray__footer-btn"
            aria-label={t("MenuQuit")}
            title={t("MenuQuit")}
            onClick={quitApp}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M8 2.5v5.5" />
              <path d="M11.9 4.4a5 5 0 1 1-7.8 0" />
            </svg>
          </button>
        </footer>
      </section>
      <TrayResizeHandles />
    </div>
  );
}

function TrayResizeHandles() {
  return (
    <>
      <div
        className="tray-resize tray-resize--top"
        aria-hidden
        onMouseDown={(event) => {
          event.preventDefault();
          void (async () => {
            await beginFlyoutGesture().catch(() => {});
            await getCurrentWindow().startResizeDragging("North");
          })().catch(() => {});
        }}
      />
      <div
        className="tray-resize tray-resize--left"
        aria-hidden
        onMouseDown={(event) => {
          event.preventDefault();
          void (async () => {
            await beginFlyoutGesture().catch(() => {});
            await getCurrentWindow().startResizeDragging("West");
          })().catch(() => {});
        }}
      />
      <div
        className="tray-resize tray-resize--topleft"
        aria-hidden
        onMouseDown={(event) => {
          event.preventDefault();
          void (async () => {
            await beginFlyoutGesture().catch(() => {});
            await getCurrentWindow().startResizeDragging("NorthWest");
          })().catch(() => {});
        }}
      />
    </>
  );
}
