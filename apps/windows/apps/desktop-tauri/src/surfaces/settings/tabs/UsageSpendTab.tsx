import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../../hooks/useLocale";
import { getUsageSpendSummary } from "../../../lib/tauri";
import type { UsageSpendRow, UsageSpendSummary } from "../../../types/bridge";
import type { TabProps } from "../settingsTabs";
import { languageTag } from "../../../i18n/languageTag";
import { ProviderIcon } from "../../../components/providers/ProviderIcon";
import { getProviderIcon } from "../../../components/providers/providerIcons";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatMoney(
  value: number | null | undefined,
  currency: string,
  locale?: string,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const code = currency || "USD";
  const cacheKey = `${locale ?? ""}|${code}`;
  try {
    let formatter = currencyFormatters.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      });
      currencyFormatters.set(cacheKey, formatter);
    }
    return formatter.format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/** The local JSONL cost scanners price everything in USD. */
const LOCAL_SCANNER_CURRENCY = "USD";

/**
 * Total a spend column without converting between currencies — the caption
 * promises native currencies with no implicit FX, so a mixed set renders as
 * separate per-currency amounts rather than one meaningless sum.
 */
function sumByCurrency(
  rows: UsageSpendRow[],
  field: "sevenDay" | "thirtyDay",
  locale: string,
): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (value == null || !Number.isFinite(value)) continue;
    const code = row.currency || LOCAL_SCANNER_CURRENCY;
    totals.set(code, (totals.get(code) ?? 0) + value);
  }
  if (totals.size === 0) return "—";
  return [...totals]
    .map(([code, value]) => formatMoney(value, code, locale))
    .join(" · ");
}

/** Sanitized share-card PNG (no account emails) — upstream #2112. */
function renderSharePng(
  summary: UsageSpendSummary,
  title: string,
  locale: string,
): string {
  const rows = summary.rows ?? [];
  const pad = 24;
  const rowH = 28;
  const headerH = 48;
  const colW = [160, 100, 100, 80, 160];
  const width = pad * 2 + colW.reduce((a, b) => a + b, 0);
  const height = pad * 2 + headerH + Math.max(1, rows.length) * rowH + 36;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(2, 2);

  // Warm TokenCue share card background
  ctx.fillStyle = "#faf4e6";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(43,39,33,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  ctx.fillStyle = "#2b2721";
  ctx.font = "600 16px Newsreader, Georgia, serif";
  ctx.fillText(title, pad, pad + 18);

  ctx.fillStyle = "#a2988a";
  ctx.font = "12px \"DM Sans\", system-ui, Segoe UI, sans-serif";
  ctx.fillText("TokenCue · local estimates · no account emails", pad, pad + 36);

  const headers = ["Provider", "7 days", "30 days", "Currency", "Source"];
  let x = pad;
  const y0 = pad + headerH;
  ctx.fillStyle = "#a2988a";
  ctx.font = "600 12px \"DM Sans\", system-ui, Segoe UI, sans-serif";
  headers.forEach((h, i) => {
    ctx.fillText(h, x, y0);
    x += colW[i];
  });

  ctx.strokeStyle = "rgba(43,39,33,0.12)";
  ctx.beginPath();
  ctx.moveTo(pad, y0 + 8);
  ctx.lineTo(width - pad, y0 + 8);
  ctx.stroke();

  ctx.font = "13px \"DM Sans\", system-ui, Segoe UI, sans-serif";
  if (rows.length === 0) {
    ctx.fillStyle = "#a2988a";
    ctx.fillText("No spend data yet.", pad, y0 + rowH);
  } else {
    rows.forEach((row, idx) => {
      const y = y0 + (idx + 1) * rowH;
      const cells = [
        row.displayName,
        formatMoney(row.sevenDay, row.currency, locale),
        formatMoney(row.thirtyDay, row.currency, locale),
        row.currency || "USD",
        row.source,
      ];
      let cx = pad;
      cells.forEach((cell, i) => {
        ctx.fillStyle = i === 0 ? "#2b2721" : "#7d7367";
        const text = String(cell);
        const max = colW[i] - 8;
        let draw = text;
        if (ctx.measureText(draw).width > max) {
          while (draw.length > 1 && ctx.measureText(`${draw}…`).width > max) {
            draw = draw.slice(0, -1);
          }
          draw = `${draw}…`;
        }
        ctx.fillText(draw, cx, y);
        cx += colW[i];
      });
    });
  }

  return canvas.toDataURL("image/png");
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function UsageSpendTab(_props: TabProps) {
  const { t, language } = useLocale();
  const locale = languageTag(language);
  const [summary, setSummary] = useState<UsageSpendSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void getUsageSpendSummary()
      .then((data) => {
        setSummary(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onShare = useCallback(() => {
    setShareError(null);
    if (!summary) {
      setShareError(t("UsageSpendShareEmpty"));
      return;
    }
    try {
      const dataUrl = renderSharePng(summary, t("UsageSpendTitle"), locale);
      if (!dataUrl) {
        setShareError(t("UsageSpendShareFailed"));
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadDataUrl(dataUrl, `tokencue-usage-spend-${stamp}.png`);
    } catch {
      setShareError(t("UsageSpendShareFailed"));
    }
  }, [locale, summary, t]);

  const rows = summary?.rows ?? [];
  const sevenTotal = sumByCurrency(rows, "sevenDay", locale);
  const thirtyTotal = sumByCurrency(rows, "thirtyDay", locale);
  // Today comes straight from the day-level local scanners rather than an
  // average of the 7-day window. Those scanners price in USD.
  const todayTotal =
    summary?.today == null ? "—" : formatMoney(summary.today, LOCAL_SCANNER_CURRENCY, locale);

  return (
    <section className="settings-section">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="settings-section__title settings-section__title--bold">
            {t("UsageSpendTitle")}
          </h3>
          <p className="settings-section__caption" style={{ marginBottom: 0 }}>
            {t("UsageSpendCaption")}
          </p>
        </div>
        <div className="usage-spend-actions" style={{ marginBottom: 0, flex: "none" }}>
          <button
            type="button"
            className="credential-btn credential-btn--secondary"
            disabled={loading}
            onClick={load}
          >
            {loading ? t("UsageSpendLoading") : t("UsageSpendRefresh")}
          </button>
          <button
            type="button"
            className="credential-btn credential-btn--primary"
            disabled={loading || !summary}
            onClick={onShare}
          >
            {t("UsageSpendShare")}
          </button>
        </div>
      </div>

      <div className="usage-spend-hero">
        <div className="usage-spend-hero__card">
          <div className="usage-spend-hero__label">{t("TrayTodayLabel")}</div>
          <div className="usage-spend-hero__value">
            {todayTotal}
          </div>
        </div>
        <div className="usage-spend-hero__card">
          <div className="usage-spend-hero__label">{t("UsageSpendCol7d")}</div>
          <div className="usage-spend-hero__value">
            {sevenTotal}
          </div>
        </div>
        <div className="usage-spend-hero__card">
          <div className="usage-spend-hero__label">{t("UsageSpendCol30d")}</div>
          <div className="usage-spend-hero__value">
            {thirtyTotal}
          </div>
        </div>
      </div>

      {error && <p className="settings-section__error">{error}</p>}
      {shareError && <p className="settings-section__error">{shareError}</p>}

      {!error && (
        <table className="usage-spend-table" ref={tableRef}>
          <thead>
            <tr>
              <th>{t("UsageSpendColProvider")}</th>
              <th>{t("UsageSpendCol7d")}</th>
              <th>{t("UsageSpendCol30d")}</th>
              <th>{t("UsageSpendColCurrency")}</th>
              <th>{t("UsageSpendColSource")}</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.rows ?? []).map((row) => (
              <tr key={row.providerId}>
                <td>
                  <span className="usage-spend-table__provider">
                    <span
                      className="usage-spend-table__brand"
                      style={{ background: getProviderIcon(row.providerId).brandColor }}
                    >
                      <ProviderIcon providerId={row.providerId} size={14} />
                    </span>
                    <span>{row.displayName}</span>
                  </span>
                </td>
                <td>{formatMoney(row.sevenDay, row.currency, locale)}</td>
                <td>{formatMoney(row.thirtyDay, row.currency, locale)}</td>
                <td>{row.currency || "USD"}</td>
                <td className="usage-spend-table__source">{row.source}</td>
              </tr>
            ))}
            {!loading && (summary?.rows?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5}>{t("UsageSpendEmpty")}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
