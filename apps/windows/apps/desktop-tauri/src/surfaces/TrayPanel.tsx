import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  BootstrapState,
  ProviderUsageSnapshot,
  RateWindowSnapshot,
  UsageSpendSummary,
} from "../types/bridge";
import { beginFlyoutGesture, getUsageSpendSummary, updateSettings } from "../lib/tauri";
import { useTrayPanelController } from "../hooks/useTrayPanelController";
import { useFormattedResetTime } from "../hooks/useFormattedResetTime";
import { formatRelativeUpdated } from "../lib/relativeTime";
import { ProviderIcon } from "../components/providers/ProviderIcon";
import { getProviderIcon } from "../components/providers/providerIcons";
import { Toggle } from "../components/FormControls";
import type { LocaleKey } from "../i18n/keys";
import tokencueIcon from "../assets/tokencue-icon.png";

type Translate = (key: LocaleKey) => string;
type TrayTabId = "quota" | "spend" | "history" | "settings";

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

function formatMoney(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
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
      <article className={className}>
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
    <article className={className}>
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
  openSettings,
}: {
  t: Translate;
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
  const totals = useMemo(() => {
    let today = 0;
    let thirty = 0;
    let hasToday = false;
    let hasThirty = false;
    let currency = "USD";
    for (const row of rows) {
      currency = row.currency || currency;
      // sevenDay is closest proxy for "today" aggregate across providers when
      // daily totals are not available at this surface — prefer thirtyDay sum.
      if (row.sevenDay != null) {
        today += row.sevenDay / 7;
        hasToday = true;
      }
      if (row.thirtyDay != null) {
        thirty += row.thirtyDay;
        hasThirty = true;
      }
    }
    return {
      today: hasToday ? today : null,
      thirty: hasThirty ? thirty : null,
      currency,
    };
  }, [rows]);

  const bars = useMemo(() => {
    const values = rows.slice(0, 14).map((row) => row.sevenDay ?? 0);
    const max = Math.max(1, ...values);
    return values.map((v) => ({
      h: `${Math.max(8, Math.round((v / max) * 100))}%`,
      hot: v / max > 0.6,
      mid: v / max > 0.4,
    }));
  }, [rows]);

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
              {formatMoney(totals.today, totals.currency)}
            </span>
          </span>
          <span className="tokencue-tray__spend-hero-side">
            <span className="tokencue-tray__eyebrow">{t("TrayLast30DaysLabel")}</span>
            <span className="tokencue-tray__display-num tokencue-tray__display-num--sm">
              {formatMoney(totals.thirty, totals.currency)}
            </span>
          </span>
        </div>
        {bars.length > 0 ? (
          <div className="tokencue-tray__bars" aria-hidden>
            {bars.map((bar, index) => (
              <span
                key={index}
                className={[
                  "tokencue-tray__bar",
                  bar.hot ? "is-hot" : bar.mid ? "is-mid" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height: bar.h }}
              />
            ))}
          </div>
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
                7d {formatMoney(row.sevenDay, row.currency)}
              </span>
              <span className="tokencue-tray__list-value">
                {formatMoney(row.thirtyDay, row.currency)}
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
}: {
  providers: ProviderUsageSnapshot[];
  settings: BootstrapState["settings"];
  t: Translate;
}) {
  const lead = providers[0] ?? null;
  const events = useMemo(() => {
    const rows: Array<{ title: string; detail: string; tone: string }> = [];
    for (const provider of providers) {
      if (provider.error) {
        rows.push({
          title: provider.displayName,
          detail: provider.error,
          tone: "critical",
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
        });
      }
    }
    return rows.slice(0, 6);
  }, [providers, settings, t]);

  const path = useMemo(() => {
    if (!lead) return "";
    // Simple sparkline from secondary/primary usage heuristic points.
    const base = Math.max(4, Math.min(96, lead.primary.usedPercent));
    const points = [0.2, 0.35, 0.4, 0.55, 0.62, 0.7, 0.78, 0.9, 1].map(
      (t, i) => {
        const x = (i / 8) * 300;
        const y = 70 - base * t * 0.65;
        return `${x.toFixed(1)} ${y.toFixed(1)}`;
      },
    );
    return `M${points.join(" L")}`;
  }, [lead]);

  return (
    <div className="tokencue-tray__body">
      {lead ? (
        <article className="tokencue-tray__card tokencue-tray__card--stack">
          <div className="tokencue-tray__history-head">
            <span
              className="tokencue-tray__brand-icon tokencue-tray__brand-icon--sm"
              style={{ background: getProviderIcon(lead.providerId).brandColor }}
            >
              <ProviderIcon providerId={lead.providerId} size={13} />
            </span>
            <strong>{lead.displayName}</strong>
            <span className="tokencue-tray__chip">7d</span>
          </div>
          <div className="tokencue-tray__spark">
            <svg viewBox="0 0 300 78" preserveAspectRatio="none" aria-hidden>
              <path d={`${path} L300 78 L0 78 Z`} className="tokencue-tray__spark-fill" />
              <path d={path} className="tokencue-tray__spark-line" />
            </svg>
          </div>
          <div className="tokencue-tray__spark-legend tokencue-tray__mono">
            <span>{Math.round(lead.primary.usedPercent)}%</span>
          </div>
        </article>
      ) : null}

      <p className="tokencue-tray__eyebrow">{t("TrayRecentEvents")}</p>
      <article className="tokencue-tray__card tokencue-tray__card--list">
        {events.length === 0 ? (
          <p className="tokencue-tray__hint" style={{ padding: "12px 15px" }}>
            {t("UsageSpendEmpty")}
          </p>
        ) : (
          events.map((event, index) => (
            <div key={`${event.title}-${index}`} className="tokencue-tray__event">
              <span className="tokencue-tray__event-dot" data-tone={event.tone} />
              <span className="tokencue-tray__event-copy">
                <span className="tokencue-tray__event-title">{event.title}</span>
                <span className="tokencue-tray__event-detail">{event.detail}</span>
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
}: {
  settings: BootstrapState["settings"];
  t: Translate;
  openSettings: () => void;
  openUsageSpend: () => void;
}) {
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
          <span className="tokencue-tray__chip">
            {settings.refreshIntervalSecs <= 0
              ? t("RefreshIntervalManual")
              : settings.refreshIntervalSecs < 60
                ? `${settings.refreshIntervalSecs}s`
                : `${Math.round(settings.refreshIntervalSecs / 60)}m`}
          </span>
        </div>
      </article>

      <article className="tokencue-tray__card tokencue-tray__card--list">
        <button type="button" className="tokencue-tray__link-row" onClick={openSettings}>
          <span className="tokencue-tray__link-icon" style={{ background: "#dfe7dc" }}>
            ⧉
          </span>
          <span className="tokencue-tray__list-name">{t("TabProviders")}</span>
          <span className="tokencue-tray__chevron">›</span>
        </button>
        <button type="button" className="tokencue-tray__link-row" onClick={openUsageSpend}>
          <span className="tokencue-tray__link-icon" style={{ background: "#f3e1d2" }}>
            $
          </span>
          <span className="tokencue-tray__list-name">{t("UsageSpendTitle")}</span>
          <span className="tokencue-tray__chevron">›</span>
        </button>
        <button type="button" className="tokencue-tray__link-row" onClick={openSettings}>
          <span className="tokencue-tray__link-icon" style={{ background: "#dee6f0" }}>
            i
          </span>
          <span className="tokencue-tray__list-name">{t("TabAbout")}</span>
          <span className="tokencue-tray__chevron">›</span>
        </button>
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
    settings,
    isRefreshing,
    refresh,
    sorted,
    trayScale,
    layoutReady,
    openSettings,
    openUsageSpend,
    quitApp,
    revealClassName,
  } = useTrayPanelController(state);

  const [tab, setTab] = useState<TrayTabId>("quota");

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
        <img src={tokencueIcon} alt="" className="tokencue-tray__empty-icon" />
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
    body = <SpendTab t={t} openSettings={openSettings} />;
  } else if (tab === "history") {
    body = <HistoryTab providers={sorted} settings={settings} t={t} />;
  } else {
    body = (
      <SettingsTab
        settings={settings}
        t={t}
        openSettings={openSettings}
        openUsageSpend={openUsageSpend}
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
            <img src={tokencueIcon} alt="" className="tokencue-tray__logo" />
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
            className={isRefreshing ? "is-refreshing" : ""}
            aria-label={t("ActionRefresh")}
            onClick={refresh}
          >
            ⟳
          </button>
          <span className="tokencue-tray__updated">{updated}</span>
          <span className="tokencue-tray__kbd">Ctrl R</span>
          <button type="button" aria-label={t("MenuQuit")} onClick={quitApp}>
            ⋮
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
