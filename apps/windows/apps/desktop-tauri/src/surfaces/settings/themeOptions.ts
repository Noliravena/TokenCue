import type { LocaleKey } from "../../i18n/keys";
import type { ThemePreference } from "../../types/bridge";

export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  labelKey: LocaleKey;
}> = [
  { value: "auto", labelKey: "ThemeAutoOption" },
  { value: "light", labelKey: "LightMode" },
  { value: "dark", labelKey: "DarkMode" },
];
