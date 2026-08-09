import { useEffect, useState } from "react";
import { useLocale } from "../../../hooks/useLocale";
import { getAppInfo, openExternalUrl } from "../../../lib/tauri";
import type { AppInfoBridge } from "../../../types/bridge";
import type { LocaleKey } from "../../../i18n/keys";
import type { TabProps } from "../settingsTabs";
import { BrandMark } from "../../../components/BrandMark";

const TOKENCUE_GITHUB = "https://github.com/Noliravena/TokenCue";
const TOKENCUE_NOTICES =
  "https://github.com/Noliravena/TokenCue/blob/main/THIRD_PARTY_NOTICES.md";

const ABOUT_LINKS: ReadonlyArray<{ labelKey: LocaleKey; url: string }> = [
  {
    labelKey: "AboutLinkGitHub",
    url: TOKENCUE_GITHUB,
  },
  {
    labelKey: "AboutLinkOriginalProject",
    url: TOKENCUE_NOTICES,
  },
];

export default function AboutTab(_props: TabProps) {
  const { t } = useLocale();
  const [appInfo, setAppInfo] = useState<AppInfoBridge | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
  }, []);

  const openAboutLink = (url: string) => {
    setLinkError(null);
    openExternalUrl(url).catch((error) => {
      setLinkError(String(error));
    });
  };

  if (!appInfo) {
    return (
      <section className="settings-section">
        <p className="settings-section__hint">{t("AboutLoading")}</p>
      </section>
    );
  }

  // Copyright is split into two keys so the brand link can render inline
  // between them, avoiding any Fluent placeholder syntax.
  const copyrightBefore = t("AboutCopyrightBefore");
  const copyrightAfter = t("AboutCopyrightAfter");

  return (
    <section className="settings-section about-section">
      <div className="about-header">
        <BrandMark className="about-icon" size={82} />
        <div className="about-title-block">
          <h2 className="about-title">{appInfo.name}</h2>
          <p className="about-version">
            {t("Version")} {appInfo.version}
            {appInfo.buildNumber !== "dev" && ` (${appInfo.buildNumber})`}
          </p>
          <p className="about-tagline">{appInfo.tagline}</p>
        </div>
      </div>

      <div className="about-links">
        {ABOUT_LINKS.map((link) => (
          <button
            key={link.url}
            type="button"
            className="about-link"
            onClick={() => openAboutLink(link.url)}
          >
            {t(link.labelKey)}
          </button>
        ))}
      </div>
      {linkError && (
        <p className="about-update-msg">
          {t("ErrorPrefix")} {linkError}
        </p>
      )}

      <div className="about-divider" />

      <p className="about-copyright">
        {copyrightBefore}{" "}
        <button
          type="button"
          className="about-link about-link--inline"
          onClick={() => openAboutLink(TOKENCUE_GITHUB)}
        >
          {t("AppName")}
        </button>
        {" "}
        {copyrightAfter}
      </p>
    </section>
  );
}
