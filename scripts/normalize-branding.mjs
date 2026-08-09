import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = resolve(root, "apps/macos/Sources/TokenCue/Resources");
const catalogs = (await readdir(resources, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".lproj"))
  .map((entry) => resolve(resources, entry.name, "Localizable.strings"));

const entryPattern = /^(\s*"(?:\\.|[^"\\])*"\s*=\s*")((?:\\.|[^"\\])*)("\s*;\s*)$/gm;

for (const catalog of catalogs) {
  const before = await readFile(catalog, "utf8");
  const after = before.replace(entryPattern, (_match, prefix, value, suffix) => {
    const branded = value
      .replaceAll("TokenCueCLI", "TokenCue CLI")
      .replaceAll("TokenCue", "TokenCue")
      .replaceAll("tokencue", "tokencue");
    return `${prefix}${branded}${suffix}`;
  });
  if (after !== before) await writeFile(catalog, after, "utf8");
}

console.log(`TokenCue branding normalized in ${catalogs.length} macOS locale catalogs.`);
