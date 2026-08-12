import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  BootstrapState,
  ProviderChartData,
  ProviderUsageSnapshot,
  RateWindowSnapshot,
  SettingsUpdate,
  ThemePreference,
  UsageSpendRow,
  UsageSpendSummary,
} from "../types/bridge";
import {
  getAppInfo,
  getProviderChartData,
  getUsageSpendSummary,
} from "../lib/tauri";
import {
  REFRESH_CADENCE_OPTIONS,
  refreshCadencePatch,
  refreshCadenceValue,
} from "./settings/refreshCadence";
import { THEME_OPTIONS } from "./settings/themeOptions";
import { useTrayPanelController } from "../hooks/useTrayPanelController";
import { useFormattedResetTime } from "../hooks/useFormattedResetTime";
import { formatRelativeUpdated } from "../lib/relativeTime";
import { formatChartDay, formatEventTime } from "../lib/eventTime";
import { providerSupportsChartData } from "../lib/providerCharts";
import {
  readTrayBillingHistory,
  readTrayHistory,
  updateTrayHistory,
  type TrayBillingHistoryPoint,
  type TrayHistoryEvent,
} from "../lib/trayHistory";
import { languageTag } from "../i18n/languageTag";
import { ProviderIcon } from "../components/providers/ProviderIcon";
import { providerTileStyle } from "../components/providers/providerIcons";
import { Toggle } from "../components/FormControls";
import type { LocaleKey } from "../i18n/keys";
import { BrandMark } from "../components/BrandMark";
import { WinGlyph } from "../components/WindowControls";
import { EmptyProviderPanel } from "../components/EmptyProviderPanel";
import CodexAccountsMenu from "../components/CodexAccountsMenu";

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

function formatSpendRowValue(
  row: UsageSpendRow,
  field: "sevenDay" | "thirtyDay",
  locale: string,
  t: Translate,
) {
  if (
    field === "thirtyDay" &&
    row.usagePercent != null &&
    Number.isFinite(row.usagePercent)
  ) {
    return `${Math.round(row.usagePercent)}% ${t("PanelUsedSuffix")}`;
  }
  if (
    field === "thirtyDay" &&
    row.balance != null &&
    Number.isFinite(row.balance) &&
    row.thirtyDay == null
  ) {
    return `${formatMoney(row.balance, row.currency, locale)} ${t("PanelLeftSuffix")}`;
  }
  return formatMoney(row[field], row.currency, locale);
}

function readBillingHistoryMap(
  providers: ProviderUsageSnapshot[],
): Record<string, TrayBillingHistoryPoint[]> {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.providerId,
      readTrayBillingHistory(provider.providerId),
    ]),
  );
}

function compactCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function maskedAccount(value: string, hidden: boolean) {
  if (!hidden) return value;
  const at = value.indexOf("@");
  if (at <= 1) return "••••";
  return `${value.slice(0, 1)}•••${value.slice(at)}`;
}

function paceLabelKey(
  stage: NonNullable<ProviderUsageSnapshot["pace"]>["stage"],
): LocaleKey {
  switch (stage) {
    case "slightly_ahead":
      return "DetailPaceSlightlyAhead";
    case "ahead":
      return "DetailPaceAhead";
    case "far_ahead":
      return "DetailPaceFarAhead";
    case "slightly_behind":
      return "DetailPaceSlightlyBehind";
    case "behind":
      return "DetailPaceBehind";
    case "far_behind":
      return "DetailPaceFarBehind";
    default:
      return "DetailPaceOnTrack";
  }
}

interface CachedSpendState {
  value: UsageSpendSummary | null;
  loaded: boolean;
  refreshing: boolean;
}

/**
 * Fetch the expensive secondary tab data once while Quota is visible, then
 * retain the last successful result. A provider refresh updates the cache in
 * the background without clearing the rendered data.
 */
function useTrayDataCache(
  providers: ProviderUsageSnapshot[],
  refreshRevision: unknown,
) {
  const [spend, setSpend] = useState<CachedSpendState>({
    value: null,
    loaded: false,
    refreshing: false,
  });
  const [charts, setCharts] = useState<
    Map<string, ProviderChartData | null>
  >(new Map());
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const chartProviderKey = useMemo(
    () =>
      providers
        .filter((provider) => providerSupportsChartData(provider.providerId))
        .map((provider) => provider.providerId)
        .sort()
        .join("\u0000"),
    [providers],
  );

  useEffect(() => {
    let cancelled = false;
    setSpend((current) => ({
      ...current,
      refreshing: current.loaded,
    }));
    void getUsageSpendSummary()
      .then((next) => {
        if (!cancelled) {
          setSpend({ value: next, loaded: true, refreshing: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpend((current) =>
            current.loaded
              ? { ...current, refreshing: false }
              : {
                  value: { rows: [], today: null, daily: [] },
                  loaded: true,
                  refreshing: false,
                },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshRevision]);

  useEffect(() => {
    let cancelled = false;
    const providerIds = chartProviderKey ? chartProviderKey.split("\u0000") : [];
    for (const providerId of providerIds) {
      void getProviderChartData(providerId)
        .then((next) => {
          if (cancelled) return;
          setCharts((current) => {
            const updated = new Map(current);
            updated.set(providerId, next);
            return updated;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setCharts((current) => {
            if (current.has(providerId)) return current;
            const updated = new Map(current);
            updated.set(providerId, null);
            return updated;
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [chartProviderKey, refreshRevision]);

  useEffect(() => {
    let cancelled = false;
    void getAppInfo()
      .then((info) => {
        if (!cancelled) setAppVersion(info.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return { spend, charts, appVersion };
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

function QuotaWindowRow({
  label,
  snapshot,
  settings,
  t,
}: {
  label: string;
  snapshot: RateWindowSnapshot;
  settings: BootstrapState["settings"];
  t: Translate;
}) {
  const reset = useFormattedResetTime(
    snapshot.resetsAt,
    snapshot.resetDescription,
    settings.resetTimeRelative,
  );
  const shown = displayPercent(snapshot.usedPercent, settings.showAsUsed);
  const level = levelFor(
    snapshot,
    settings.highUsageThreshold,
    settings.criticalUsageThreshold,
  );
  const informational = snapshot.isInformational === true;
  const replacesPercent =
    settings.showResetWhenExhausted && shouldReplaceExhaustedPercent(snapshot, reset);

  return (
    <div className="tokencue-tray__metric">
      <div className="tokencue-tray__metric-head">
        <span>{label}</span>
        <strong data-level={level}>
          {informational
            ? snapshot.resetDescription || reset || "—"
            : replacesPercent
              ? reset
            : `${Math.round(shown.value)}% ${t(shown.labelKey)}`}
        </strong>
      </div>
      {!informational ? (
        <div className="tokencue-tray__track tokencue-tray__track--detail" aria-hidden>
          <span
            className="tokencue-tray__fill"
            data-level={level}
            style={{ width: `${Math.max(0, Math.min(100, shown.value))}%` }}
          />
        </div>
      ) : null}
      {!replacesPercent && reset && reset !== snapshot.resetDescription ? (
        <span className="tokencue-tray__metric-reset tokencue-tray__mono">{reset}</span>
      ) : null}
    </div>
  );
}

export function shouldReplaceExhaustedPercent(
  snapshot: RateWindowSnapshot,
  resetText: string | null,
  nowMs = Date.now(),
): boolean {
  const resetTarget = snapshot.resetsAt ? Date.parse(snapshot.resetsAt) : Number.NaN;
  return (
    snapshot.isExhausted === true &&
    Boolean(resetText) &&
    Number.isFinite(resetTarget) &&
    resetTarget > nowMs
  );
}

function QuotaDetails({
  provider,
  settings,
  chartData,
  t,
  onOpenSettings,
}: {
  provider: ProviderUsageSnapshot;
  settings: BootstrapState["settings"];
  chartData: ProviderChartData | null | undefined;
  t: Translate;
  onOpenSettings: () => void;
}) {
  const costReset = useFormattedResetTime(
    provider.cost?.resetsAt ?? null,
    null,
    settings.resetTimeRelative,
  );
  const metrics: Array<{ id: string; label: string; snapshot: RateWindowSnapshot }> = [
    {
      id: "primary",
      label: provider.primaryLabel || t("DetailWindowPrimary"),
      snapshot: provider.primary,
    },
  ];
  if (provider.secondary) {
    metrics.push({
      id: "secondary",
      label: provider.secondaryLabel || t("DetailWindowSecondary"),
      snapshot: provider.secondary,
    });
  }
  if (provider.modelSpecific) {
    metrics.push({
      id: "model",
      label: t("DetailWindowModelSpecific"),
      snapshot: provider.modelSpecific,
    });
  }
  if (provider.tertiary) {
    metrics.push({
      id: "tertiary",
      label: t("DetailWindowTertiary"),
      snapshot: provider.tertiary,
    });
  }
  for (const extra of provider.extraRateWindows) {
    metrics.push({ id: extra.id, label: extra.title, snapshot: extra.window });
  }

  const localUsage = chartData?.localUsage ?? null;
  const wayfinder = provider.wayfinderUsage ?? null;

  return (
    <div className="tokencue-tray__details">
      <section className="tokencue-tray__detail-section">
        {metrics.map((metric) => (
          <QuotaWindowRow
            key={metric.id}
            label={metric.label}
            snapshot={metric.snapshot}
            settings={settings}
            t={t}
          />
        ))}
      </section>

      {provider.cost ? (
        <section className="tokencue-tray__detail-section tokencue-tray__detail-grid">
          <span>
            <small>{t("DetailCostUsed")}</small>
            <strong>
              {provider.cost.formattedUsed ||
                formatMoney(provider.cost.used, provider.cost.currencyCode)}
            </strong>
          </span>
          <span>
            <small>
              {provider.cost.balance != null
                ? t("DetailCostBalance")
                : t("DetailCostRemaining")}
            </small>
            <strong>
              {provider.cost.balance != null
                ? provider.cost.formattedBalance ||
                  formatMoney(provider.cost.balance, provider.cost.currencyCode)
                : formatMoney(provider.cost.remaining, provider.cost.currencyCode)}
            </strong>
          </span>
          {costReset ? (
            <span className="tokencue-tray__detail-grid-wide">
              <small>{t("DetailCostResets")}</small>
              <strong>{costReset}</strong>
            </span>
          ) : null}
        </section>
      ) : null}

      {localUsage ? (
        <section className="tokencue-tray__detail-section tokencue-tray__detail-grid">
          <span>
            <small>{t("PanelToday")}</small>
            <strong>{formatMoney(localUsage.todayCost, "USD")}</strong>
          </span>
          <span>
            <small>{t("PanelThirtyDayCost")}</small>
            <strong>{formatMoney(localUsage.thirtyDayCost, "USD")}</strong>
          </span>
          <span>
            <small>{t("PanelThirtyDayTokens")}</small>
            <strong>{compactCount(localUsage.thirtyDayTokens)}</strong>
          </span>
          <span>
            <small>{t("PanelLatestTokens")}</small>
            <strong>{compactCount(localUsage.latestTokens)}</strong>
          </span>
          {localUsage.topModel ? (
            <span className="tokencue-tray__detail-grid-wide">
              <small>{t("PanelTopModelPrefix")}</small>
              <strong>{localUsage.topModel}</strong>
            </span>
          ) : null}
        </section>
      ) : null}

      {wayfinder ? (
        <section className="tokencue-tray__detail-section tokencue-tray__detail-grid">
          <span>
            <small>{t("WayfinderGatewayStatus")}</small>
            <strong>{wayfinder.gatewayStatus}</strong>
          </span>
          <span>
            <small>{t("WayfinderModels")}</small>
            <strong>{wayfinder.modelCount}</strong>
          </span>
          <span>
            <small>{t("WayfinderRequests")}</small>
            <strong>{compactCount(wayfinder.requests)}</strong>
          </span>
          <span>
            <small>{t("WayfinderTokens")}</small>
            <strong>{compactCount(wayfinder.tokens)}</strong>
          </span>
        </section>
      ) : null}

      {provider.pace ? (
        <section className="tokencue-tray__detail-section">
          <div className="tokencue-tray__pace-head">
            <span>{t("DetailPaceTitle")}</span>
            <strong>
              {t(paceLabelKey(provider.pace.stage))} ({provider.pace.deltaPercent >= 0 ? "+" : ""}
              {provider.pace.deltaPercent.toFixed(1)}%)
            </strong>
          </div>
          <div className="tokencue-tray__pace-bars" aria-hidden>
            <span style={{ width: `${provider.pace.expectedUsedPercent}%` }} />
            <span style={{ width: `${provider.pace.actualUsedPercent}%` }} />
          </div>
          <p className="tokencue-tray__hint">
            {provider.pace.willLastToReset
              ? t("DetailPaceWillLastToReset")
              : `${t("DetailPaceRunsOutIn")} ${provider.pace.etaSeconds == null ? "—" : compactEta(provider.pace.etaSeconds)}`}
          </p>
        </section>
      ) : null}

      <section className="tokencue-tray__detail-section tokencue-tray__account-line">
        <span>
          {[provider.accountEmail, provider.accountOrganization]
            .filter(Boolean)
            .map((value) => maskedAccount(String(value), settings.hidePersonalInfo))
            .join(" · ") || provider.sourceLabel}
        </span>
        <span className="tokencue-tray__mono">
          {t("Source")}: {provider.sourceLabel}
        </span>
      </section>

      {provider.providerId === "codex" && settings.showAllTokenAccountsInMenu ? (
        <CodexAccountsMenu hidePersonalInfo={settings.hidePersonalInfo} />
      ) : null}

      <button
        type="button"
        className="tokencue-tray__pill-btn tokencue-tray__details-action"
        aria-label={`${provider.displayName} ${t("ProviderSettingsTitle")}`}
        onClick={onOpenSettings}
      >
        {t("ProviderSettingsTitle")}
      </button>
    </div>
  );
}

function QuotaCard({
  provider,
  settings,
  chartData,
  expanded,
  onToggle,
  t,
  onFix,
}: {
  provider: ProviderUsageSnapshot;
  settings: BootstrapState["settings"];
  chartData: ProviderChartData | null | undefined;
  expanded: boolean;
  onToggle: () => void;
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
  const replacesPercent =
    settings.showResetWhenExhausted && shouldReplaceExhaustedPercent(provider.primary, reset);
  const stale = isStale(provider, settings.refreshIntervalSecs);
  const className = [
    "tokencue-tray__card",
    stale ? "tokencue-tray__card--stale" : "",
    provider.error ? "tokencue-tray__card--error" : "",
    level === "critical" ? "tokencue-tray__card--critical" : "",
    expanded ? "tokencue-tray__card--expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (provider.error) {
    return (
      <article className={className} id={quotaCardId(provider.providerId)}>
        <div className="tokencue-tray__card-head">
          <span
            className="provider-tile tokencue-tray__brand-icon"
            style={providerTileStyle(provider.providerId)}
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
        <span
          className="provider-tile tokencue-tray__brand-icon"
          style={providerTileStyle(provider.providerId)}
        >
          <ProviderIcon providerId={provider.providerId} size={19} />
        </span>
          <span className="tokencue-tray__card-meta">
            <span className="tokencue-tray__card-name">{provider.displayName}</span>
            <span className="tokencue-tray__card-sub tokencue-tray__mono">
            {replacesPercent ? provider.primaryLabel || provider.sourceLabel : reset || "—"}
            </span>
          </span>
        <span className="tokencue-tray__card-pct" data-level={level}>
          {replacesPercent ? (
            <span className="tokencue-tray__card-pct-reset tokencue-tray__mono">{reset}</span>
          ) : (
            <>
              <span className="tokencue-tray__card-pct-num">
                {Math.round(shown.value)}
                <span className="tokencue-tray__card-pct-unit">%</span>
              </span>
              <span className="tokencue-tray__card-pct-label">{t(shown.labelKey)}</span>
            </>
          )}
        </span>
        <button
          type="button"
          className="tokencue-tray__disclosure"
          aria-label={`${provider.displayName} ${t("ProviderInfo")}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <svg
            className="tokencue-tray__disclosure-icon"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            focusable="false"
          >
            <path d="M4 6.25 8 10l4-3.75" />
          </svg>
        </button>
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
      {expanded ? (
        <QuotaDetails
          provider={provider}
          settings={settings}
          chartData={chartData}
          t={t}
          onOpenSettings={onFix}
        />
      ) : null}
    </article>
  );
}

function SpendTab({
  t,
  locale,
  summary,
  loading,
  refreshing,
  openUsageSpend,
}: {
  t: Translate;
  locale: string;
  summary: UsageSpendSummary | null;
  loading: boolean;
  refreshing: boolean;
  openUsageSpend: () => void;
}) {
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
        <button type="button" className="tokencue-tray__cta" onClick={openUsageSpend}>
          {t("TrayOpenFullSettings")}
        </button>
      </div>
    );
  }

  return (
    <div className="tokencue-tray__body" aria-busy={refreshing}>
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
          return (
            <div key={row.providerId} className="tokencue-tray__list-row">
              <span
                className="provider-tile tokencue-tray__brand-icon tokencue-tray__brand-icon--sm"
                style={providerTileStyle(row.providerId)}
              >
                <ProviderIcon providerId={row.providerId} size={15} />
              </span>
              <span className="tokencue-tray__list-name">{row.displayName}</span>
              <span className="tokencue-tray__list-meta tokencue-tray__mono">
                {row.usagePercent == null
                  ? row.balance != null
                    ? row.thirtyDay == null
                      ? row.source
                      : `${formatMoney(row.balance, row.currency, locale)} ${t("PanelLeftSuffix")}`
                    : `7d ${formatMoney(row.sevenDay, row.currency, locale)}`
                  : row.source}
              </span>
              <span className="tokencue-tray__list-value">
                {formatSpendRowValue(row, "thirtyDay", locale, t)}
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
  charts,
  chartProviderId,
  onChartProviderChange,
  range,
  onRangeChange,
  historyEvents,
  billingHistory,
}: {
  providers: ProviderUsageSnapshot[];
  settings: BootstrapState["settings"];
  t: Translate;
  locale: string;
  charts: ReadonlyMap<string, ProviderChartData | null>;
  chartProviderId: string | null;
  onChartProviderChange: (providerId: string) => void;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  historyEvents: TrayHistoryEvent[];
  billingHistory: Readonly<Record<string, TrayBillingHistoryPoint[]>>;
}) {
  // Codex/Claude/OpenAI ship native history. Other providers use locally
  // observed daily billing snapshots, so no curve is invented.
  const chartable = useMemo(
    () =>
      providers.filter(
        (provider) =>
          providerSupportsChartData(provider.providerId) ||
          (billingHistory[provider.providerId]?.length ?? 0) > 0,
      ),
    [billingHistory, providers],
  );
  const activeProvider =
    chartable.find((provider) => provider.providerId === chartProviderId) ??
    chartable[0] ??
    null;
  const activeId = activeProvider?.providerId ?? null;
  const chart = activeId ? charts.get(activeId) ?? null : null;

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

  const eventRows = useMemo(
    () =>
      historyEvents.slice(0, 12).map((event) => {
        let detail: string;
        let tone = "normal";
        switch (event.kind) {
          case "warning":
            detail = `${Math.round(event.usedPercent ?? 0)}% ${t("PanelUsedSuffix")}`;
            tone = "warning";
            break;
          case "critical":
            detail = `${Math.round(event.usedPercent ?? 0)}% ${t("PanelUsedSuffix")}`;
            tone = "critical";
            break;
          case "reset":
            detail = `${Math.round(event.usedPercent ?? 0)}% ${t("PanelUsedSuffix")}`;
            break;
          case "error":
            detail = t("ProviderStatusNeedsAttention");
            tone = "critical";
            break;
          case "recovered":
          case "connected":
            detail = t("ProviderStatusConnected");
            break;
        }
        return {
          title: event.displayName,
          detail,
          tone,
          time: formatEventTime(new Date(event.at).toISOString(), Date.now(), locale),
        };
      }),
    [historyEvents, locale, t],
  );
  const visibleEvents = eventRows.length > 0 ? eventRows : alerts;

  const historySeries = useMemo(() => {
    if (chart && chart.costHistory.length > 0) {
      return {
        points: chart.costHistory.slice(-range),
        metric: "spend" as const,
        currency: LOCAL_SCANNER_CURRENCY,
      };
    }
    if (chart && chart.creditsHistory.length > 0) {
      return {
        points: chart.creditsHistory.slice(-range),
        metric: "spend" as const,
        currency: LOCAL_SCANNER_CURRENCY,
      };
    }
    const local = activeId ? (billingHistory[activeId] ?? []).slice(-range) : [];
    const latest = local[local.length - 1];
    return {
      points: local,
      metric: latest?.metric ?? "quota",
      currency: latest?.currency ?? "",
    };
  }, [activeId, billingHistory, chart, range]);
  const series = historySeries.points;

  const paths = useMemo(() => buildAreaPath(series.map((point) => point.value)), [series]);
  const latestSeriesValue = series[series.length - 1]?.value;
  const historyValueLabel =
    latestSeriesValue == null
      ? "—"
      : historySeries.metric === "quota"
        ? t("TrayHistoryCumulative").replace("{}", String(Math.round(latestSeriesValue)))
        : historySeries.metric === "balance"
          ? `${formatMoney(latestSeriesValue, historySeries.currency, locale)} ${t("PanelLeftSuffix")}`
          : formatMoney(latestSeriesValue, historySeries.currency, locale);

  return (
    <div className="tokencue-tray__body">
      {activeProvider && series.length > 0 ? (
        <article className="tokencue-tray__card tokencue-tray__card--stack">
          <div className="tokencue-tray__history-head">
            <span
              className="provider-tile tokencue-tray__brand-icon tokencue-tray__brand-icon--sm"
              style={providerTileStyle(activeProvider.providerId)}
            >
              <ProviderIcon providerId={activeProvider.providerId} size={15} />
            </span>
            {chartable.length > 1 ? (
              <select
                className="tokencue-tray__chip tokencue-tray__chip--select"
                aria-label={t("TrayHistoryProviderLabel")}
                value={activeProvider.providerId}
                onChange={(event) =>
                  onChartProviderChange(event.currentTarget.value)
                }
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
                onRangeChange(Number(event.currentTarget.value) as HistoryRange)
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
              {series.length === 1 ? (
                <circle cx="150" cy="39" r="3.5" className="tokencue-tray__spark-dot" />
              ) : null}
            </svg>
          </div>
          <div className="tokencue-tray__spark-legend tokencue-tray__mono">
            <span>{formatChartDay(series[0].date, locale)}</span>
            <span>
              {historyValueLabel}
            </span>
            <span>{t("TrayTodayLabel")}</span>
          </div>
        </article>
      ) : null}

      <p className="tokencue-tray__eyebrow">
        {eventRows.length > 0 ? t("TrayTabHistory") : t("TrayCurrentAlerts")}
      </p>
      <article className="tokencue-tray__card tokencue-tray__card--list">
        {visibleEvents.length === 0 ? (
          <p className="tokencue-tray__hint tokencue-tray__hint--inset">
            {t("TrayNoCurrentAlerts")}
          </p>
        ) : (
          visibleEvents.map((event, index) => (
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
  appVersion,
  t,
  updatePanelSettings,
  openSettings,
  openProviderSettings,
  openUsageSpend,
  openMenuBarSettings,
  openFloatBarSettings,
  openAbout,
}: {
  settings: BootstrapState["settings"];
  appVersion: string | null;
  t: Translate;
  updatePanelSettings: (patch: SettingsUpdate) => Promise<void>;
  openSettings: () => void;
  openProviderSettings: () => void;
  openUsageSpend: () => void;
  openMenuBarSettings: () => void;
  openFloatBarSettings: () => void;
  openAbout: () => void;
}) {
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
      onClick: openProviderSettings,
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
            onChange={(v) => void updatePanelSettings({ showNotifications: v })}
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
            onChange={(v) => void updatePanelSettings({ showAsUsed: v })}
            ariaLabel={t("ShowUsageAsUsed")}
          />
        </label>
        <div className="tokencue-tray__setting-row">
          <span>
            <span className="tokencue-tray__setting-title">{t("ThemeSelection")}</span>
            <span className="tokencue-tray__setting-help">{t("ThemeHelper")}</span>
          </span>
          <select
            className="tokencue-tray__chip tokencue-tray__chip--select"
            aria-label={t("ThemeSelection")}
            value={settings.theme}
            onChange={(event) =>
              void updatePanelSettings({
                theme: event.currentTarget.value as ThemePreference,
              })
            }
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
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
              void updatePanelSettings(
                refreshCadencePatch(event.currentTarget.value),
              )
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
    updatePanelSettings,
    isRefreshing,
    refresh,
    lastRefresh,
    sorted,
    trayScale,
    layoutReady,
    openSettings,
    openProviderSettings,
    openUsageSpend,
    openMenuBarSettings,
    openFloatBarSettings,
    openAbout,
    closeFlyout,
    revealClassName,
  } = useTrayPanelController(state);

  const locale = languageTag(language);
  const [tab, setTab] = useState<TrayTabId>("quota");
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [historyProviderId, setHistoryProviderId] = useState<string | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>(7);
  const [historyEvents, setHistoryEvents] = useState<TrayHistoryEvent[]>(() =>
    readTrayHistory(),
  );
  const [billingHistory, setBillingHistory] = useState<
    Record<string, TrayBillingHistoryPoint[]>
  >(() => readBillingHistoryMap(sorted));
  const { spend, charts, appVersion } = useTrayDataCache(sorted, lastRefresh);
  useEffect(() => {
    if (sorted.length === 0) return;
    setHistoryEvents(
      updateTrayHistory(
        sorted,
        settings.highUsageThreshold,
        settings.criticalUsageThreshold,
      ),
    );
    setBillingHistory(readBillingHistoryMap(sorted));
  }, [settings.criticalUsageThreshold, settings.highUsageThreshold, sorted]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const syncOverlayScrollbar = useCallback(() => {
    const scroller = scrollRef.current;
    const scrollbar = scrollbarRef.current;
    const thumb = scrollbarThumbRef.current;
    if (!scroller || !scrollbar || !thumb) return;

    const overflow = scroller.scrollHeight - scroller.clientHeight;
    const trackHeight = Math.max(0, scroller.clientHeight - 8);
    const visible = overflow > 1 && trackHeight > 0;
    scrollbar.dataset.visible = String(visible);
    if (!visible) return;

    const thumbHeight = Math.max(
      28,
      (trackHeight * scroller.clientHeight) / scroller.scrollHeight,
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const scrollProgress = Math.min(1, Math.max(0, scroller.scrollTop / overflow));
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${maxThumbTop * scrollProgress}px)`;
  }, []);
  const scrollPositionsRef = useRef<Record<TrayTabId, number>>({
    quota: 0,
    spend: 0,
    history: 0,
    settings: 0,
  });
  const selectTab = useCallback(
    (next: TrayTabId) => {
      if (next === tab) return;
      if (scrollRef.current) {
        scrollPositionsRef.current[tab] = scrollRef.current.scrollTop;
      }
      setTab(next);
    },
    [tab],
  );
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollPositionsRef.current[tab];
    }
    syncOverlayScrollbar();
  }, [syncOverlayScrollbar, tab]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    let animationFrame = 0;
    const scheduleSync = () => {
      if (typeof window.requestAnimationFrame !== "function") {
        syncOverlayScrollbar();
        return;
      }
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(syncOverlayScrollbar);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleSync);

    resizeObserver?.observe(scroller);
    for (const child of scroller.children) {
      resizeObserver?.observe(child);
    }
    scroller.addEventListener("scroll", syncOverlayScrollbar, { passive: true });
    window.addEventListener("resize", scheduleSync);
    scheduleSync();

    return () => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      scroller.removeEventListener("scroll", syncOverlayScrollbar);
      window.removeEventListener("resize", scheduleSync);
    };
  }, [expandedProviderId, sorted, syncOverlayScrollbar, tab]);
  // Footer switcher: jump back to the quota list and bring that provider's
  // expanded card into view once the tab has rendered.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const focusProvider = useCallback((providerId: string) => {
    selectTab("quota");
    setExpandedProviderId(providerId);
    setPendingFocus(providerId);
  }, [selectTab]);
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

  if (sorted.length === 0) {
    return (
      <div className={`${revealClassName}${layoutReady ? "" : " tokencue-tray--measuring"}`}>
        <EmptyProviderPanel onConnect={openProviderSettings} scale={trayScale} />
      </div>
    );
  }

  let body: ReactNode;
  if (tab === "quota") {
    body = (
      <div className="tokencue-tray__body">
        {sorted.map((provider) => (
          <QuotaCard
            key={provider.providerId}
            provider={provider}
            settings={settings}
            chartData={charts.get(provider.providerId)}
            expanded={expandedProviderId === provider.providerId}
            onToggle={() =>
              setExpandedProviderId((current) =>
                current === provider.providerId ? null : provider.providerId,
              )
            }
            t={t}
            onFix={openProviderSettings}
          />
        ))}
      </div>
    );
  } else if (tab === "spend") {
    body = (
      <SpendTab
        t={t}
        locale={locale}
        summary={spend.value}
        loading={!spend.loaded}
        refreshing={spend.refreshing}
        openUsageSpend={openUsageSpend}
      />
    );
  } else if (tab === "history") {
    body = (
      <HistoryTab
        providers={sorted}
        settings={settings}
        t={t}
        locale={locale}
        charts={charts}
        chartProviderId={historyProviderId}
        onChartProviderChange={setHistoryProviderId}
        range={historyRange}
        onRangeChange={setHistoryRange}
        historyEvents={historyEvents}
        billingHistory={billingHistory}
      />
    );
  } else {
    body = (
      <SettingsTab
        settings={settings}
        appVersion={appVersion}
        t={t}
        updatePanelSettings={updatePanelSettings}
        openSettings={openSettings}
        openProviderSettings={openProviderSettings}
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
          <div className="tokencue-tray__brand">
            <BrandMark className="tokencue-tray__logo" size={18} />
            <strong>TokenCue</strong>
          </div>
          <span className="tokencue-tray__updated tokencue-tray__mono">{updated}</span>
          <button
            type="button"
            className="win-caption-btn win-caption-btn--close tokencue-tray__close"
            aria-label={t("WindowClose")}
            title={t("WindowClose")}
            onClick={closeFlyout}
          >
            <WinGlyph kind="close" />
          </button>
        </header>

        <nav className="tokencue-tray__tabs" role="tablist" aria-label="Tray">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tokencue-tab-${item.id}`}
              aria-controls={`tokencue-panel-${item.id}`}
              aria-selected={tab === item.id}
              className={`tokencue-tray__tab${tab === item.id ? " is-active" : ""}`}
              onClick={() => selectTab(item.id)}
            >
              <TabIcon id={item.id} />
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="tokencue-tray__scroll-shell">
          <div
            ref={scrollRef}
            className="tokencue-tray__scroll"
            role="tabpanel"
            id={`tokencue-panel-${tab}`}
            aria-labelledby={`tokencue-tab-${tab}`}
          >
            {body}
          </div>
          <div
            ref={scrollbarRef}
            className="tokencue-tray__scrollbar"
            data-visible="false"
            aria-hidden="true"
          >
            <div
              ref={scrollbarThumbRef}
              className="tokencue-tray__scrollbar-thumb"
            />
          </div>
        </div>

        <footer className="tokencue-tray__footer">
          {settings.switcherShowsIcons && sorted.length > 0 ? (
            <div className="tokencue-tray__switcher">
              {sorted.slice(0, SWITCHER_LIMIT).map((provider) => (
                <button
                  key={provider.providerId}
                  type="button"
                  className={`provider-tile tokencue-tray__switcher-btn${
                    expandedProviderId === provider.providerId ? " is-active" : ""
                  }`}
                  style={providerTileStyle(provider.providerId)}
                  aria-label={provider.displayName}
                  title={provider.displayName}
                  onClick={() => focusProvider(provider.providerId)}
                >
                  <ProviderIcon providerId={provider.providerId} size={15} />
                </button>
              ))}
            </div>
          ) : (
            <span className="tokencue-tray__footer-spacer" aria-hidden />
          )}

          <button
            type="button"
            className={`tokencue-tray__footer-btn${isRefreshing ? " is-refreshing" : ""}`}
            aria-label={t("ActionRefresh")}
            title={`${t("ActionRefresh")} · Ctrl+R`}
            onClick={refresh}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M13.2 6.6A5.4 5.4 0 1 0 13.5 10" />
              <path d="M13.5 2.8v3.9h-3.9" />
            </svg>
          </button>
          <button
            type="button"
            className="tokencue-tray__footer-btn"
            aria-label={t("TrayOpenFullSettings")}
            title={t("TrayOpenFullSettings")}
            onClick={openSettings}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M2.5 5h11M2.5 11h11" />
              <circle cx="10" cy="5" r="1.7" fill="var(--tb-footer-bg)" />
              <circle cx="5.5" cy="11" r="1.7" fill="var(--tb-footer-bg)" />
            </svg>
          </button>
        </footer>
      </section>
    </div>
  );
}
