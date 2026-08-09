import type { Language } from "../types/bridge";

/**
 * BCP-47 tag for each UI language, so `Intl` formatting (dates, times,
 * numbers) follows the language the user picked in Settings rather than
 * whatever locale the host webview happens to report.
 */
const LANGUAGE_TAGS: Record<Language, string> = {
  arabic: "ar",
  catalan: "ca",
  german: "de",
  english: "en-US",
  spanish: "es",
  persian: "fa",
  french: "fr",
  galician: "gl",
  indonesian: "id",
  italian: "it",
  japanese: "ja-JP",
  korean: "ko-KR",
  dutch: "nl",
  polish: "pl",
  portuguesebrazil: "pt-BR",
  russian: "ru-RU",
  swedish: "sv",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  vietnamese: "vi",
  chinese: "zh-CN",
  chinesetraditional: "zh-TW",
};

export function languageTag(language: Language): string {
  return LANGUAGE_TAGS[language] ?? "en-US";
}
