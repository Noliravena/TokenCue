import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [macRootArgument, windowsRootArgument, outputArgument, macRef = "unknown", windowsRef = "unknown", macCommit = "unknown", windowsCommit = "unknown"] = process.argv.slice(2);
if (!macRootArgument || !windowsRootArgument || !outputArgument) {
  throw new Error("usage: report-upstream-snapshot.mjs <mac-root> <windows-root> <output> [mac-ref] [windows-ref] [mac-commit] [windows-commit]");
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const macRoot = resolve(macRootArgument);
const windowsRoot = resolve(windowsRootArgument);
const outputPath = resolve(outputArgument);
const skippedDirectories = new Set([".git", ".build", "target", "node_modules", "dist"]);
const sourceExtension = /\.(?:swift|rs|ts|tsx|js|mjs|json|toml|ftl|strings)$/i;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readText = (path) => readFile(path, "utf8");
const readRepositoryText = (path) => readText(resolve(repositoryRoot, path));

async function collectTree(base, filter = () => true) {
  const files = new Map();
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const name = relative(base, path).replaceAll("\\", "/");
        if (!filter(name)) continue;
        files.set(name, sha256(await readFile(path)));
      }
    }
  }
  await visit(base);
  return files;
}

function treeFingerprint(tree) {
  return sha256([...tree].sort(([left], [right]) => left.localeCompare(right)).map(([path, digest]) => `${path}:${digest}`).join("\n")).slice(0, 16);
}

async function compareTrees(label, candidateRoot, implementationRoot, filter = () => true) {
  const [candidate, implementation] = await Promise.all([
    collectTree(candidateRoot, filter),
    collectTree(implementationRoot, filter),
  ]);
  const candidateOnly = [...candidate.keys()].filter((path) => !implementation.has(path)).sort();
  const implementationOnly = [...implementation.keys()].filter((path) => !candidate.has(path)).sort();
  const changed = [...candidate.keys()].filter((path) => implementation.has(path) && candidate.get(path) !== implementation.get(path)).sort();
  return {
    label,
    candidateCount: candidate.size,
    implementationCount: implementation.size,
    candidateFingerprint: treeFingerprint(candidate),
    implementationFingerprint: treeFingerprint(implementation),
    candidateOnly,
    implementationOnly,
    changed,
  };
}

function renderComparison(comparison) {
  const lines = [
    `### ${comparison.label}`,
    "",
    `- Candidate files: ${comparison.candidateCount} (fingerprint \`${comparison.candidateFingerprint}\`)`,
    `- TokenCue files: ${comparison.implementationCount} (fingerprint \`${comparison.implementationFingerprint}\`)`,
    `- Candidate-only: ${comparison.candidateOnly.length}; TokenCue-only: ${comparison.implementationOnly.length}; changed: ${comparison.changed.length}`,
    "",
  ];
  const entries = [
    ...comparison.candidateOnly.map((path) => `candidate-only  ${path}`),
    ...comparison.implementationOnly.map((path) => `tokencue-only   ${path}`),
    ...comparison.changed.map((path) => `changed         ${path}`),
  ];
  if (!entries.length) return `${lines.join("\n")}No file-level differences.\n`;
  lines.push("<details><summary>File-level review queue</summary>", "", "```text");
  lines.push(...entries.slice(0, 120));
  if (entries.length > 120) lines.push(`... ${entries.length - 120} more paths omitted; use the fingerprints for the complete tree.`);
  lines.push("```", "", "</details>", "");
  return lines.join("\n");
}

const providerManifest = JSON.parse(await readRepositoryText("shared/contracts/provider-manifest.json"));
const targetProviders = providerManifest.providers.map(({ id }) => id);
const normalizeProvider = (variant) => ({
  openaiapi: "openai",
  azureopenai: "azureopenai",
  alibabatokenplan: "alibabatokenplan",
  opencodego: "opencodego",
  qwencloud: "qwencloud",
  vertexai: "vertexai",
  llmproxy: "llmproxy",
  neuralwatt: "neuralwatt",
  sub2api: "sub2api",
  xai: "xai",
}[variant.toLowerCase()] ?? variant.toLowerCase());

async function macProviderIDs() {
  const source = await readText(resolve(macRoot, "Sources/TokenCueCore/Providers/Providers.swift"));
  const body = source.match(/public enum UsageProvider[^\{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  return [...body.matchAll(/^\s*case\s+([A-Za-z0-9]+)/gm)].map((match) => normalizeProvider(match[1]));
}

async function windowsProviderIDs() {
  const source = await readText(resolve(windowsRoot, "rust/src/core/provider.rs"));
  const body = source.match(/pub fn all\(\)[^{]*\{[\s\S]*?&\[([\s\S]*?)\]\s*\n\s*\}/)?.[1] ?? "";
  return [...body.matchAll(/ProviderId::([A-Za-z0-9]+)/g)].map((match) => normalizeProvider(match[1]));
}

async function macLocales() {
  const resources = await readdir(resolve(macRoot, "Sources/TokenCue/Resources"), { withFileTypes: true });
  return resources.filter((entry) => entry.isDirectory() && entry.name.endsWith(".lproj")).map((entry) => entry.name.replace(/\.lproj$/, "")).sort();
}

const [candidateMacProviders, candidateWindowsProviders, candidateLocales] = await Promise.all([
  macProviderIDs(),
  windowsProviderIDs(),
  macLocales(),
]);
const localeCatalog = JSON.parse(await readRepositoryText("shared/locales/catalog.json")).locales;
const cliContract = JSON.parse(await readRepositoryText("shared/contracts/cli-v1.schema.json"));
const cliCommands = cliContract.properties.command.enum;
const pluginManifestSchema = await readRepositoryText("shared/contracts/plugin-manifest.schema.json");
const pluginOutputSchema = await readRepositoryText("shared/contracts/plugin-output-v1.schema.json");

const authenticationFilter = (path) => sourceExtension.test(path) && /(?:auth|oauth|credential|cookie|keychain|token.?account|secret|redact)/i.test(path);
const localeFilter = (path) => /\.lproj\//.test(path) || /(?:^|\/)locale\//.test(path) || /\.ftl$/i.test(path);
const pluginFilter = (path) => /(?:^|\/)Plugins?\//i.test(path) || /plugin/i.test(path) && sourceExtension.test(path);

const comparisons = {
  providers: await Promise.all([
    compareTrees("macOS provider adapters", resolve(macRoot, "Sources/TokenCueCore/Providers"), resolve(repositoryRoot, "apps/macos/Sources/TokenCueCore/Providers"), (path) => sourceExtension.test(path)),
    compareTrees("Windows provider adapters", resolve(windowsRoot, "rust/src/providers"), resolve(repositoryRoot, "apps/windows/rust/src/providers"), (path) => sourceExtension.test(path)),
  ]),
  authentication: await Promise.all([
    compareTrees("macOS authentication policy", macRoot, resolve(repositoryRoot, "apps/macos"), authenticationFilter),
    compareTrees("Windows authentication policy", windowsRoot, resolve(repositoryRoot, "apps/windows"), authenticationFilter),
  ]),
  cli: await Promise.all([
    compareTrees("macOS CLI", resolve(macRoot, "Sources/TokenCueCLI"), resolve(repositoryRoot, "apps/macos/Sources/TokenCueCLI"), (path) => sourceExtension.test(path)),
    compareTrees("Windows CLI", resolve(windowsRoot, "rust/src/cli"), resolve(repositoryRoot, "apps/windows/rust/src/cli"), (path) => sourceExtension.test(path)),
  ]),
  plugins: await Promise.all([
    compareTrees("macOS plugin protocol/runtime", resolve(macRoot, "Sources/TokenCueCore"), resolve(repositoryRoot, "apps/macos/Sources/TokenCueCore"), pluginFilter),
    compareTrees("Windows plugin protocol/runtime", resolve(windowsRoot, "rust/src"), resolve(repositoryRoot, "apps/windows/rust/src"), pluginFilter),
  ]),
  languages: await Promise.all([
    compareTrees("macOS locales", resolve(macRoot, "Sources/TokenCue/Resources"), resolve(repositoryRoot, "apps/macos/Sources/TokenCue/Resources"), localeFilter),
    compareTrees("Windows locales", resolve(windowsRoot, "rust/src/locale"), resolve(repositoryRoot, "apps/windows/rust/src/locale"), (path) => /\.ftl$/i.test(path)),
  ]),
  ui: await Promise.all([
    compareTrees("macOS application UI", resolve(macRoot, "Sources/TokenCue"), resolve(repositoryRoot, "apps/macos/Sources/TokenCue"), (path) => sourceExtension.test(path) && !/Resources\//.test(path)),
    compareTrees("Windows React UI", resolve(windowsRoot, "apps/desktop-tauri/src"), resolve(repositoryRoot, "apps/windows/apps/desktop-tauri/src"), (path) => sourceExtension.test(path) || /\.css$/i.test(path)),
  ]),
};

const setDifference = (left, right) => left.filter((value) => !right.includes(value));
const providerRows = [
  ["macOS", candidateMacProviders],
  ["Windows", candidateWindowsProviders],
].map(([platform, ids]) => `| ${platform} | ${ids.length} | ${setDifference(targetProviders, ids).join(", ") || "none"} | ${setDifference(ids, targetProviders).join(", ") || "none"} |`).join("\n");
const authDigest = sha256(JSON.stringify(providerManifest.providers.map(({ id, auth }) => ({ id, auth })))).slice(0, 16);
const generatedAt = new Date().toISOString();

let markdown = `# Upstream candidate difference report

Generated ${generatedAt}. This is a review artifact only; it never updates application source or \`shared/upstream-lock.json\`.

## Candidate refs

- macOS: \`${macRef}\` / \`${macCommit}\`
- Windows: \`${windowsRef}\` / \`${windowsCommit}\`
- Current product contract: 67 providers, ${localeCatalog.length} locales, CLI v1 commands \`${cliCommands.join(" / ")}\`
- Authentication contract fingerprint: \`${authDigest}\`
- Plugin schema fingerprints: manifest \`${sha256(pluginManifestSchema).slice(0, 16)}\`, output \`${sha256(pluginOutputSchema).slice(0, 16)}\`

## Provider inventory

| Candidate | Count | Missing from TokenCue target | Extra vs TokenCue target |
|---|---:|---|---|
${providerRows}

## Language inventory

- Candidate macOS locales: ${candidateLocales.length} (${candidateLocales.join(", ")})
- Missing from TokenCue's ${localeCatalog.length}-locale contract: ${setDifference(localeCatalog, candidateLocales).join(", ") || "none"}
- Candidate-only locales: ${setDifference(candidateLocales, localeCatalog).join(", ") || "none"}
`;

for (const [key, title] of [
  ["providers", "Provider adapters and usage/status mapping"],
  ["authentication", "Authentication, credential, cookie, and redaction policy"],
  ["cli", "CLI commands and output behavior"],
  ["plugins", "Plugin protocol, permissions, redirects, and runtime"],
  ["languages", "Language resources"],
  ["ui", "Application UI"],
]) {
  markdown += `\n## ${title}\n\n${comparisons[key].map(renderComparison).join("\n")}`;
}

markdown += `
## Required human review

- Reconcile every provider/authentication change with the authoritative manifest and redacted fixtures.
- Review CLI JSON, exit codes, plugin permissions, redirect handling, network-domain approvals, timeouts, and response-size limits.
- Keep native-currency spend groups separate and preserve stale-last-success semantics.
- Run \`pnpm run check\`, the full Windows test/build/native-interaction suite, and the macOS \`swift build\`, \`make test\`, and \`make check\` suite before editing the upstream lock.
- Repeat handoff screenshot comparisons for tray, settings, onboarding, notifications, and spend surfaces. A clean report does not replace visual or runtime review.
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown, "utf8");
console.log(`Wrote ${outputPath}`);
