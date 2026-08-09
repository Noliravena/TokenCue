import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(resolve(root, "shared/locales/catalog.json"), "utf8"));
const windowsMap = JSON.parse(await readFile(resolve(root, "shared/locales/windows-map.json"), "utf8"));
const windowsLocaleRoot = resolve(root, "apps/windows/rust/src/locale");
const source = normalizeBranding(
  await readFile(resolve(windowsLocaleRoot, "en-US.ftl"), "utf8"),
);
const existing = new Set(["en", "es", "ja", "ko", "ru", "zh-Hans", "zh-Hant"]);

function normalizeBranding(value) {
  // Ensure Fluent message prefixes and product labels stay on TokenCue identity.
  return value.replaceAll("TokenCue", "TokenCue");
}

function decodeStringsValue(value) {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function macDictionary(text) {
  const translations = new Map();
  for (const match of text.matchAll(/"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"\s*;/g)) {
    const key = decodeStringsValue(match[1]);
    const value = decodeStringsValue(match[2]);
    if (key && value && key !== value && !/[{}]/.test(value)) translations.set(key, value);
  }
  return translations;
}

for (const locale of catalog.locales) {
  if (existing.has(locale)) continue;
  const stringsPath = resolve(root, `apps/macos/Sources/TokenCue/Resources/${locale}.lproj/Localizable.strings`);
  const translations = macDictionary(await readFile(stringsPath, "utf8"));
  const localized = normalizeBranding(source.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z0-9]+) = (.*)$/);
    if (!match) return line;
    const replacement = translations.get(match[2]);
    return replacement ? `${match[1]} = ${replacement}` : line;
  }).join("\n"));
  const target = resolve(root, `apps/windows/rust/src/locale/${windowsMap[locale]}.ftl`);
  await writeFile(target, localized, "utf8");
  console.log(`${locale}: ${translations.size} upstream translations available -> ${target}`);
}

for (const entry of await readdir(windowsLocaleRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".ftl")) continue;
  const target = resolve(windowsLocaleRoot, entry.name);
  const before = await readFile(target, "utf8");
  const after = normalizeBranding(before);
  if (after !== before) await writeFile(target, after, "utf8");
}
