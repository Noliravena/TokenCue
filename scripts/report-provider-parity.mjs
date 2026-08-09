import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const manifest = JSON.parse(await read("shared/contracts/provider-manifest.json"));
const target = manifest.providers.map(({ id }) => id);
const source = await read("apps/windows/rust/src/core/provider.rs");
const allBody = source.match(/pub fn all\(\)[^{]*\{[\s\S]*?&\[([\s\S]*?)\]\s*\n\s*\}/)?.[1] ?? "";
const normalize = (variant) => ({
  openaiapi: "openai",
  qwencloud: "qwencloud",
  sub2api: "sub2api",
  vertexai: "vertexai",
  azureopenai: "azureopenai",
  llmproxy: "llmproxy",
  neuralwatt: "neuralwatt",
  xai: "xai",
}[variant.toLowerCase()] ?? variant.toLowerCase());
const windows = [...allBody.matchAll(/ProviderId::([A-Za-z0-9]+)/g)].map((match) => normalize(match[1]));
const missing = target.filter((id) => !windows.includes(id));
const extra = windows.filter((id) => !target.includes(id));
const rows = manifest.providers.map((provider) => `| ${provider.id} | ${provider.name} | yes | ${windows.includes(provider.id) ? "implemented" : "missing"} | ${provider.auth.join(", ")} |`).join("\n");
const output = `# Provider parity matrix\n\nGenerated from the pinned source trees and the authoritative TokenCue manifest.\n\n- Target: ${target.length}\n- macOS baseline: ${target.length}\n- Windows implemented enum: ${windows.length}\n- Windows missing target adapters: ${missing.join(", ") || "none"}\n- Windows legacy/non-product adapters: ${extra.join(", ") || "none"}\n\n| ID | Name | macOS v0.48.0 | Windows snapshot | Authentication |\n|---|---|---|---|---|\n${rows}\n`;
// Local-only report under gitignored docs/upstream/ (see docs/upstream-policy.md).
const targetPath = resolve(root, "docs/upstream/provider-parity.md");
await mkdir(dirname(targetPath), { recursive: true });
await writeFile(targetPath, output, "utf8");
console.log(`Wrote ${targetPath}`);
