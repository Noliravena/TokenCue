import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const equalSets = (left, right) => left.length === right.length && left.every((value) => right.includes(value));
const exists = async (path) => {
  try { await read(path); return true; }
  catch { return false; }
};

async function readTextTree(relativeDirectory, extension) {
  const directory = resolve(root, relativeDirectory);
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) output.push(await readTextTree(relative, extension));
    else if (entry.name.endsWith(extension)) output.push(await read(relative));
  }
  return output.join("\n");
}

const upstreamLock = await readJson("shared/upstream-lock.json");
assert(upstreamLock.macos.tag === "v0.48.0" && upstreamLock.macos.commit === "5bd58785061136505c2ad8b5dbaa73c50e7bc191",
  "macOS upstream lock drifted from the accepted TokenCue import");
assert(upstreamLock.windows.stableTag === "v0.33.2" && upstreamLock.windows.stableCommit === "6e51128e235c490857ca35f381463c8a5427e9ab",
  "Windows stable upstream lock drifted from the accepted TokenCue import");
assert(upstreamLock.windows.auditedCommit === "02971a7952ab45f9fde50808f28004a7239db320",
  "Windows audited-backport snapshot drifted");
assert(upstreamLock.policy.followRollingBranches === false && upstreamLock.policy.requireHumanReview === true,
  "upstream updates must remain stable-ref-only and human reviewed");
assert(upstreamLock.policy.externalProductSync === false,
  "external product repository sync must remain disabled");
assert(!upstreamLock.macos.repository && !upstreamLock.windows.repository,
  "upstream lock must not store external product repository clone URLs");

const manifest = await readJson("shared/contracts/provider-manifest.json");
const target = manifest.providers.map(({ id }) => id);
assert(target.length === 67, `provider manifest must have 67 entries, found ${target.length}`);
assert(new Set(target).size === target.length, "provider manifest contains duplicate IDs");

const macProvidersSource = await read("apps/macos/Sources/TokenCueCore/Providers/Providers.swift");
const macEnum = macProvidersSource.match(/public enum UsageProvider[^\{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const macProviders = [...macEnum.matchAll(/^\s*case\s+([a-zA-Z0-9]+)/gm)].map((match) => match[1].toLowerCase());
assert(equalSets(target, macProviders), `macOS UsageProvider drift: missing=${target.filter((id) => !macProviders.includes(id)).join(",") || "none"}; extra=${macProviders.filter((id) => !target.includes(id)).join(",") || "none"}`);

const generatedWindows = await read("apps/windows/apps/desktop-tauri/src/generated/providerManifest.ts");
const generatedWindowsIds = [...generatedWindows.matchAll(/"id":\s*"([a-z0-9]+)"/g)].map((match) => match[1]);
assert(equalSets(target, generatedWindowsIds), "Windows generated provider manifest does not match the authoritative catalog");

const windowsProviderSource = await read("apps/windows/rust/src/core/provider.rs");
const windowsAllBody = windowsProviderSource.match(/pub fn all\(\)[^{]*\{[\s\S]*?&\[([\s\S]*?)\]\s*\n\s*\}/)?.[1] ?? "";
const normalizeWindowsProvider = (variant) => ({
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
const windowsProviderIds = [...windowsAllBody.matchAll(/ProviderId::([A-Za-z0-9]+)/g)]
  .map((match) => normalizeWindowsProvider(match[1]));
assert(equalSets(target, windowsProviderIds),
  `Windows ProviderId drift: missing=${target.filter((id) => !windowsProviderIds.includes(id)).join(",") || "none"}; extra=${windowsProviderIds.filter((id) => !target.includes(id)).join(",") || "none"}`);

const generatedMac = await read("apps/macos/Sources/TokenCueCore/Providers/GeneratedTokenCueProviderManifest.swift");
const generatedMacIds = [...generatedMac.matchAll(/^\s*"([a-z0-9]+)",$/gm)].map((match) => match[1]);
assert(equalSets(target, generatedMacIds), "macOS generated provider manifest does not match the authoritative catalog");

const macPackage = await read("apps/macos/Package.swift");
const macResolved = await read("apps/macos/Package.resolved");
const macSwift = await readTextTree("apps/macos/Sources", ".swift");
assert(macPackage.includes(".macOS(.v15)"), "macOS deployment target must remain macOS 15");
assert(macPackage.includes('.executable(name: "TokenCue"'), "macOS TokenCue product is missing");
assert(!/Sparkle|import\s+(?:CloudKit|WidgetKit)/.test(`${macPackage}\n${macSwift}`),
  "macOS active source contains a removed Sparkle, CloudKit, or WidgetKit capability");
assert(!/sparkle-project|\"identity\"\s*:\s*\"sparkle\"/i.test(macResolved),
  "macOS dependency lock still contains Sparkle");
assert(!/TokenCueConfigMigrator\.migrate|KeychainMigration\.migrate/.test(macSwift),
  "macOS launch path must not migrate an upstream installation");
assert(!/defaultEnabled:\s*true/.test(macSwift), "macOS first-party providers must be opt-in on a fresh TokenCue install");
assert((macSwift.match(/defaultEnabled:\s*false/g) ?? []).length >= 67,
  "macOS provider descriptors are not all opt-in");

const browserPolicy = await read("apps/macos/Sources/TokenCueCore/BrowserCookieImportOrder.swift");
const browserPolicyBody = browserPolicy.match(/supportedCookieSources:[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
const browserSources = [...browserPolicyBody.matchAll(/\.([a-zA-Z]+)/g)].map((match) => match[1]);
assert(browserSources.join(",") === "chrome,edge,brave,firefox",
  `macOS browser policy must be Chrome, Edge, Brave, Firefox; found ${browserSources.join(",") || "none"}`);
assert(!browserPolicyBody.includes(".safari"), "Safari must not be an active TokenCue cookie source");
assert(macSwift.includes('"com.tokencue.desktop"') && !macSwift.includes('"com.steipete.'),
  "macOS identity or Keychain namespace drifted from com.tokencue.desktop");

const spendModel = await read("apps/macos/Sources/TokenCue/SpendDashboardModel.swift");
const macApp = await read("apps/macos/Sources/TokenCue/TokenCueApp.swift");
assert(!spendModel.includes("CurrencyExchange.shared.convert"),
  "macOS spend dashboard must group native currencies without conversion");
assert(!macApp.includes("fetchLatestRatesIfNeeded"), "macOS launch must not fetch exchange rates");

for (const removedPath of [
  "apps/macos/appcast.xml",
  "apps/macos/Scripts/package_app.sh",
  "apps/macos/Scripts/sign-and-notarize.sh",
  "apps/macos/Scripts/profiles/TokenCue-DeveloperID.provisionprofile",
  "apps/macos/Scripts/cloudkit/deploy_schema.sh",
  "apps/macos/Scripts/cloudkit/schema.ckdb",
  "apps/windows/rust/src/updater.rs",
  "apps/windows/rust/installer/tokencue.iss",
]) {
  assert(!await exists(removedPath), `${removedPath} must stay outside the source-only scope`);
}
const windowsLib = await read("apps/windows/rust/src/lib.rs");
const windowsMain = await read("apps/windows/apps/desktop-tauri/src-tauri/src/main.rs");
const windowsTauri = await readJson("apps/windows/apps/desktop-tauri/src-tauri/tauri.conf.json");
const windowsNotifications = await read("apps/windows/rust/src/notifications.rs");
assert(windowsTauri.productName === "TokenCue" && windowsTauri.identifier === "com.tokencue.desktop",
  "Windows product name or application identifier drifted");
assert(windowsNotifications.includes('CreateToastNotifier("TokenCue.Desktop")') && windowsNotifications.includes("AppUserModelId\\TokenCue.Desktop"),
  "Windows AUMID must remain TokenCue.Desktop");
assert(!windowsLib.includes("pub mod updater") && !/commands::(?:check_for_updates|download_update|apply_update)/.test(windowsMain),
  "Windows automatic-update code must not be registered in the source-only build");

const localeCatalog = await readJson("shared/locales/catalog.json");
assert(localeCatalog.locales.length === 23, `locale catalog must have 23 entries, found ${localeCatalog.locales.length}`);
assert(new Set(localeCatalog.locales).size === 23, "locale catalog contains duplicate entries");
const macResourceNames = (await readdir(resolve(root, "apps/macos/Sources/TokenCue/Resources"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(".lproj"))
  .map((entry) => entry.name.replace(/\.lproj$/, ""));
assert(equalSets(localeCatalog.locales, macResourceNames), `macOS locale folders drift from the 23-locale catalog`);

const windowsLocaleMap = await readJson("shared/locales/windows-map.json");
assert(equalSets(localeCatalog.locales, Object.keys(windowsLocaleMap)), "Windows locale mapping must cover every canonical locale");
for (const file of Object.values(windowsLocaleMap)) {
  try { await read(`apps/windows/rust/src/locale/${file}.ftl`); }
  catch { failures.push(`missing Windows locale catalog: ${file}.ftl`); }
}

const tokens = await readJson("shared/design/tokens.json");
assert(tokens.geometry.trayWidth === 380, "tray width must be 380");
assert(tokens.geometry.settingsWidth === 880, "settings width must be 880");
assert(tokens.threshold.normalMaxExclusive === 70, "normal threshold must end at 70");
assert(tokens.threshold.warningMaxExclusive === 95 && tokens.threshold.criticalMinInclusive === 95, "warning/critical threshold must meet at 95");
const digest = createHash("sha256").update(JSON.stringify({ tokens, manifest })).digest("hex");
for (const path of [
  "shared/design/generated/tokencue.css",
  "apps/windows/apps/desktop-tauri/src/generated/designTokens.css",
  "apps/macos/Sources/TokenCue/Generated/TokenCueDesignTokens.swift",
]) {
  assert((await read(path)).includes(digest), `${path} is stale; run pnpm run generate`);
}

const usageFixture = await read("shared/fixtures/usage.sample.json");
assert(!/(sk-[a-zA-Z0-9]{12,}|Bearer\s+[a-zA-Z0-9._-]{12,}|session[_-]?token\s*[:=]\s*(?!\[REDACTED\]))/i.test(usageFixture), "fixture appears to contain a raw credential");
const cliSchema = await readJson("shared/contracts/cli-v1.schema.json");
assert(cliSchema.properties.command.enum.join(",") === "usage,cost,diagnose,sessions,serve,config,hooks,guard,plugins", "CLI command contract drift");
const cliCommandFiles = {
  usage: ["apps/macos/Sources/TokenCueCLI/CLIUsageCommand.swift", "apps/windows/rust/src/cli/usage.rs"],
  cost: ["apps/macos/Sources/TokenCueCLI/CLICostCommand.swift", "apps/windows/rust/src/cli/cost.rs"],
  diagnose: ["apps/macos/Sources/TokenCueCLI/CLIDiagnoseCommand.swift", "apps/windows/rust/src/cli/diagnose.rs"],
  sessions: ["apps/macos/Sources/TokenCueCLI/CLISessionsCommand.swift", "apps/windows/rust/src/cli/sessions.rs"],
  serve: ["apps/macos/Sources/TokenCueCLI/CLIServeCommand.swift", "apps/windows/rust/src/cli/serve.rs"],
  config: ["apps/macos/Sources/TokenCueCLI/CLIConfigCommand.swift", "apps/windows/rust/src/cli/config.rs"],
  hooks: ["apps/macos/Sources/TokenCueCLI/CLIHooksCommand.swift", "apps/windows/rust/src/cli/hooks.rs"],
  guard: ["apps/macos/Sources/TokenCueCLI/CLIGuardCommand.swift", "apps/windows/rust/src/cli/guard.rs"],
  plugins: ["apps/macos/Sources/TokenCueCLI/CLIPluginsCommand.swift", "apps/windows/rust/src/cli/plugins.rs"],
};
for (const command of cliSchema.properties.command.enum) {
  for (const path of cliCommandFiles[command] ?? []) {
    assert(await exists(path), `${command} CLI implementation missing: ${path}`);
  }
}

const pluginManifestSchema = await readJson("shared/contracts/plugin-manifest.schema.json");
const pluginLimits = pluginManifestSchema.properties.limits.properties;
assert(pluginLimits.timeoutMs.default === 10000 && pluginLimits.timeoutMs.maximum === 30000,
  "plugin timeout contract must default to 10s and cap at 30s");
assert(pluginLimits.maxResponseBytes.default === 1048576 && pluginLimits.maxResponseBytes.maximum === 5242880,
  "plugin response contract must default to 1 MiB and cap at 5 MiB");
const sharedPrelude = await read("shared/plugins/provider-plugin-prelude.js");
const macPrelude = await read("apps/macos/Sources/TokenCueCore/Resources/Plugins/provider-plugin-prelude.js");
const sharedSucrase = await read("shared/plugins/sucrase-3.35.1.min.js");
const macSucrase = await read("apps/macos/Sources/TokenCueCore/Resources/Plugins/sucrase-3.35.1.min.js");
assert(sharedPrelude === macPrelude, "macOS plugin prelude drifted from the shared runtime asset");
assert(sharedSucrase === macSucrase, "macOS Sucrase asset drifted from the shared runtime asset");
assert(sharedPrelude.includes("__TOKENCUE_FAILURE__") && !sharedPrelude.includes("__CODEXBAR_FAILURE__"),
  "plugin failure marker must use the TokenCue namespace");
for (const fixture of [
  "basic.ts",
  "basic.expected.json",
  "forbidden-domain.js",
  "cookie-without-broker.js",
  "timeout.js",
  "oversized-response.js",
]) {
  const content = await read(`shared/fixtures/plugins/${fixture}`);
  assert(!/(sk-[a-zA-Z0-9]{12,}|Bearer\s+[a-zA-Z0-9._-]{12,}|session[_-]?token\s*[:=]\s*(?!\[REDACTED\]))/i.test(content),
    `plugin fixture ${fixture} appears to contain a raw credential`);
}

if (failures.length) {
  console.error("TokenCue contract gate failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`TokenCue contract gate passed: 67 providers, 23 locales, design thresholds 70/95.`);
