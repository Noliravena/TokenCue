import type { CSSProperties } from "react";
import { useLocale } from "../hooks/useLocale";
import { BrandMark } from "./BrandMark";

export function EmptyProviderPanel({
  onConnect,
  scale = 1,
}: {
  onConnect: () => void;
  scale?: number;
}) {
  const { t } = useLocale();

  return (
    <section
      className="tokencue-empty-panel"
      style={{ "--tray-scale": scale } as CSSProperties}
      aria-labelledby="tokencue-empty-title"
    >
      <header className="tokencue-empty-panel__header">
        <span className="tokencue-empty-panel__brand">
          <BrandMark size={22} />
          <strong>TokenCue</strong>
        </span>
      </header>

      <div className="tokencue-empty-panel__body">
        <BrandMark className="tokencue-empty-panel__mark" size={60} />
        <h1 id="tokencue-empty-title">{t("TrayEmptyTitle")}</h1>
        <p>{t("TrayEmptyDescription")}</p>
      </div>

      <div className="tokencue-empty-panel__action">
        <button type="button" onClick={onConnect}>
          {t("TrayEmptyConnect")}
        </button>
      </div>

      <footer className="tokencue-empty-panel__footer">
        <span>{t("TrayLocalPrivacy")}</span>
        <kbd>Ctrl ,</kbd>
      </footer>
    </section>
  );
}

export default EmptyProviderPanel;
