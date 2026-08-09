import { useEffect, useState } from "react";
import { useLocale } from "../../../hooks/useLocale";
import { Field, Select, Toggle } from "../../../components/FormControls";
import type { MenuBarDisplayMode, TrayIconMode, TrayVisibilityStatusDto } from "../../../types/bridge";
import type { LocaleKey } from "../../../i18n/keys";
import type { TabProps } from "../settingsTabs";
import { ProviderIcon } from "../../../components/providers/ProviderIcon";
import { getProviderIcon } from "../../../components/providers/providerIcons";
import FloatBarSettingsSection from "../../../floatbar/SettingsSection";
import { getTrayVisibilityStatus } from "../../../lib/tauri";

/**
 * Tray label layouts, shown as selectable sample renders rather than a
 * dropdown so the difference between them is visible before choosing.
 */
const DISPLAY_MODES: {
  value: MenuBarDisplayMode;
  labelKey: LocaleKey;
  descKey: LocaleKey;
}[] = [
  {
    value: "detailed",
    labelKey: "DisplayModeDetailed",
    descKey: "DisplayModeDetailedSample",
  },
  {
    value: "compact",
    labelKey: "DisplayModeCompact",
    descKey: "DisplayModeCompactSample",
  },
  {
    value: "minimal",
    labelKey: "DisplayModeMinimal",
    descKey: "DisplayModeMinimalSample",
  },
];

export default function DisplayTab({
  mode = "menu",
  settings,
  set,
  saving,
}: TabProps & { mode?: "menuBar" | "menu" }) {
  const { t } = useLocale();
  const [trayVisibility, setTrayVisibility] = useState<TrayVisibilityStatusDto | null>(null);
  // Sample the user's own first provider so the preview matches what their
  // tray actually shows; Codex stands in before anything is enabled.
  const previewProviderId = settings.enabledProviders?.[0] ?? "codex";

  useEffect(() => {
    getTrayVisibilityStatus()
      .then(setTrayVisibility)
      .catch(() => setTrayVisibility(null));
  }, []);

  return (
    <>
      {/* ── Menu bar ─────────────────────────────────────────────── */}
      {mode === "menuBar" && <section className="settings-section">
        <h3 className="settings-section__title">{t("MenuBar")}</h3>
        <div className="settings-section__group">
          <Field
            label={t("TrayIconModeLabel")}
            description={t("TrayIconModeHelper")}
          >
            <Select
              value={settings.trayIconMode}
              disabled={saving}
              options={[
                { value: "single", label: t("TrayIconModeSingle") },
                { value: "perProvider", label: t("TrayIconModePerProvider") },
              ]}
              onChange={(v) => set({ trayIconMode: v as TrayIconMode })}
            />
          </Field>
          <Field
            label={t("ShowProviderIcons")}
            description={t("ShowProviderIconsHelper")}
            leading
          >
            <Toggle
              checked={settings.switcherShowsIcons}
              disabled={saving}
              onChange={(v) => set({ switcherShowsIcons: v })}
            />
          </Field>
          <Field
            label={t("PreferHighestUsage")}
            description={t("PreferHighestUsageHelper")}
            leading
          >
            <Toggle
              checked={settings.menuBarShowsHighestUsage}
              disabled={saving}
              onChange={(v) => set({ menuBarShowsHighestUsage: v })}
            />
          </Field>
          <Field
            label={t("ShowPercentInTray")}
            description={t("ShowPercentInTrayHelper")}
            leading
          >
            <Toggle
              checked={settings.menuBarShowsPercent}
              disabled={saving}
              onChange={(v) => set({ menuBarShowsPercent: v })}
            />
          </Field>
          <Field
            label={t("PromoteTrayIconLabel")}
            description={
              trayVisibility?.support === "supported"
                ? t("PromoteTrayIconHelper")
                : t("PromoteTrayIconUnsupportedHint")
            }
            leading
          >
            <Toggle
              checked={settings.promoteTrayIcon ?? false}
              disabled={saving || trayVisibility?.support !== "supported"}
              onChange={(v) => set({ promoteTrayIcon: v })}
            />
          </Field>
        </div>
      </section>}

      {mode === "menuBar" && (
        <section className="settings-section">
          <h3 className="settings-section__title">{t("DisplayModeLabel")}</h3>
          <div className="display-mode-grid" role="radiogroup" aria-label={t("DisplayModeLabel")}>
            {DISPLAY_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={settings.menuBarDisplayMode === option.value}
                disabled={saving}
                className={`display-mode-card${
                  settings.menuBarDisplayMode === option.value
                    ? " display-mode-card--active"
                    : ""
                }`}
                onClick={() => set({ menuBarDisplayMode: option.value })}
              >
                <span className="display-mode-card__name">{t(option.labelKey)}</span>
                <span className="display-mode-card__preview">
                  <span
                    className="display-mode-card__brand"
                    style={{ background: getProviderIcon(previewProviderId).brandColor }}
                  >
                    <ProviderIcon providerId={previewProviderId} size={11} />
                  </span>
                  {option.value !== "minimal" && <span>96%</span>}
                  {option.value === "detailed" && (
                    <span className="display-mode-card__reset">6d 16h</span>
                  )}
                </span>
                <span className="display-mode-card__desc">{t(option.descKey)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Menu content ─────────────────────────────────────────── */}
      {mode === "menu" && <section className="settings-section">
        <h3 className="settings-section__title">{t("TabMenu")}</h3>
        <div className="settings-section__group">
          <Field
            label={t("ShowAsUsedLabel")}
            description={t("ShowAsUsedHelper")}
            leading
          >
            <Toggle
              checked={settings.showAsUsed}
              disabled={saving}
              onChange={(v) => set({ showAsUsed: v })}
            />
          </Field>
          <Field
            label={t("ShowAllTokenAccountsLabel")}
            description={t("ShowAllTokenAccountsHelper")}
            leading
          >
            <Toggle
              checked={settings.showAllTokenAccountsInMenu}
              disabled={saving}
              onChange={(v) => set({ showAllTokenAccountsInMenu: v })}
            />
          </Field>
          <Field
            label={t("ResetTimeRelative")}
            description={t("ResetTimeRelativeHelper")}
            leading
          >
            <Toggle
              checked={settings.resetTimeRelative}
              disabled={saving}
              onChange={(v) => set({ resetTimeRelative: v })}
            />
          </Field>
          <Field
            label={t("ShowResetWhenExhausted")}
            description={t("ShowResetWhenExhaustedHelper")}
            leading
          >
            <Toggle
              checked={settings.showResetWhenExhausted}
              ariaLabel={t("ShowResetWhenExhausted")}
              disabled={saving}
              onChange={(v) => set({ showResetWhenExhausted: v })}
            />
          </Field>
        </div>
      </section>}

      {mode === "menu" && (
        <FloatBarSettingsSection settings={settings} saving={saving} set={set} />
      )}
    </>
  );
}
