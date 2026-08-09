use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rquickjs::{Context, Ctx, Runtime};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::core::ProviderId;

use super::manifest::PluginManifest;
use super::{PluginError, PluginResult};

const MAX_SOURCE_BYTES: usize = 1024 * 1024;
const SUCRASE_SOURCE: &str = include_str!("../../../../../shared/plugins/sucrase-3.35.1.min.js");

const MANIFEST_EXTRACTOR: &str = r#"
(() => {
  const value = globalThis.__tokencueDefinition;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('plugin did not call defineProvider(...) with an object');
  }
  if (typeof value.fetchUsage !== 'function') {
    throw new TypeError('fetchUsage must be a function');
  }
  return JSON.stringify({
    schemaVersion: value.schemaVersion === undefined ? 1 : value.schemaVersion,
    id: value.id,
    name: value.name,
    icon: value.icon,
    endpoints: value.endpoints,
    auth: value.auth,
    settings: value.settings === undefined ? [] : value.settings,
    capabilities: value.capabilities === undefined ? [] : value.capabilities,
    cookieDomains: value.cookieDomains === undefined ? [] : value.cookieDomains,
    limits: value.limits === undefined ? {} : value.limits,
  });
})()
"#;

#[derive(Debug, Clone)]
pub struct LoadedPlugin {
    pub file_path: PathBuf,
    pub source_hash: String,
    pub source: String,
    pub transpiled_source: String,
    pub manifest: PluginManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiscoveryResult {
    pub file_path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip)]
    pub plugin: Option<LoadedPlugin>,
}

pub fn default_plugins_directory() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TokenCue")
        .join("plugins")
}

pub fn discover_plugins(directory: &Path) -> Vec<PluginDiscoveryResult> {
    if let Err(error) = fs::create_dir_all(directory) {
        return vec![PluginDiscoveryResult {
            file_path: directory.to_path_buf(),
            plugin_id: None,
            name: None,
            error: Some(format!("could not scan plugin directory: {error}")),
            plugin: None,
        }];
    }

    let mut paths = match fs::read_dir(directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        extension.eq_ignore_ascii_case("js") || extension.eq_ignore_ascii_case("ts")
                    })
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            return vec![PluginDiscoveryResult {
                file_path: directory.to_path_buf(),
                plugin_id: None,
                name: None,
                error: Some(format!("could not scan plugin directory: {error}")),
                plugin: None,
            }];
        }
    };
    paths.sort_by_key(|path| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });

    let mut ids = ProviderId::all()
        .iter()
        .map(|provider| provider.cli_name().to_string())
        .collect::<HashSet<_>>();
    paths
        .into_iter()
        .map(|path| match load_plugin(&path) {
            Ok(plugin) if ids.insert(plugin.manifest.id.clone()) => PluginDiscoveryResult {
                file_path: path,
                plugin_id: Some(plugin.manifest.id.clone()),
                name: Some(plugin.manifest.name.clone()),
                error: None,
                plugin: Some(plugin),
            },
            Ok(plugin) => PluginDiscoveryResult {
                file_path: path,
                plugin_id: Some(plugin.manifest.id.clone()),
                name: Some(plugin.manifest.name.clone()),
                error: Some(format!(
                    "provider id '{}' collides with a built-in or another plugin",
                    plugin.manifest.id
                )),
                plugin: None,
            },
            Err(error) => PluginDiscoveryResult {
                file_path: path,
                plugin_id: None,
                name: None,
                error: Some(error.to_string()),
                plugin: None,
            },
        })
        .collect()
}

pub fn load_plugin(path: &Path) -> PluginResult<LoadedPlugin> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| PluginError::Load("plugin must use a .js or .ts extension".into()))?;
    if extension != "js" && extension != "ts" {
        return Err(PluginError::Load(
            "plugin must use a .js or .ts extension".into(),
        ));
    }
    let metadata = fs::metadata(path)
        .map_err(|error| PluginError::Load(format!("could not inspect plugin: {error}")))?;
    if !metadata.is_file() {
        return Err(PluginError::Load(
            "plugin path is not a regular file".into(),
        ));
    }
    if metadata.len() > MAX_SOURCE_BYTES as u64 {
        return Err(PluginError::Load(
            "plugin exceeds the 1 MiB source limit".into(),
        ));
    }
    let bytes = fs::read(path)
        .map_err(|error| PluginError::Load(format!("could not read plugin: {error}")))?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(PluginError::Load(
            "plugin exceeds the 1 MiB source limit".into(),
        ));
    }
    let source = String::from_utf8(bytes.clone())
        .map_err(|_| PluginError::Load("plugin source is not valid UTF-8".into()))?;
    let source_hash = format!("{:x}", Sha256::digest(&bytes));
    let transpiled_source = if extension == "ts" {
        transpile_typescript(&source)?
    } else {
        source.clone()
    };
    validate_source_policy(&transpiled_source)?;
    let manifest = extract_manifest(&transpiled_source)?;
    Ok(LoadedPlugin {
        file_path: path.to_path_buf(),
        source_hash,
        source,
        transpiled_source,
        manifest,
    })
}

pub fn extract_manifest(source: &str) -> PluginResult<PluginManifest> {
    let started = Instant::now();
    let runtime = runtime_with_limits(Duration::from_secs(2), started)?;
    let context = Context::full(&runtime)
        .map_err(|error| PluginError::Load(format!("could not create QuickJS context: {error}")))?;
    let json = context.with(|ctx| {
        ctx.eval::<(), _>(
            "globalThis.defineProvider = value => { if (globalThis.__tokencueDefinition !== undefined) throw new TypeError('defineProvider may only be called once'); globalThis.__tokencueDefinition = value; };",
        )
        .map_err(|error| js_error(&ctx, error))?;
        ctx.eval::<(), _>(source)
            .map_err(|error| js_error(&ctx, error))?;
        ctx.eval::<String, _>(MANIFEST_EXTRACTOR)
            .map_err(|error| js_error(&ctx, error))
    })?;
    let mut manifest: PluginManifest = serde_json::from_str(&json).map_err(|error| {
        PluginError::InvalidManifest(format!("manifest is not valid JSON data: {error}"))
    })?;
    manifest.validate()?;
    Ok(manifest)
}

pub fn transpile_typescript(source: &str) -> PluginResult<String> {
    let started = Instant::now();
    let runtime = runtime_with_limits(Duration::from_secs(5), started)?;
    runtime.set_memory_limit(64 * 1024 * 1024);
    // Sucrase's generated parser is deeply recursive; this limit applies only
    // to the trusted bundled transpiler, not to provider plugin execution.
    runtime.set_max_stack_size(8 * 1024 * 1024);
    let context = Context::full(&runtime).map_err(|error| {
        PluginError::Load(format!(
            "could not create TypeScript transpiler context: {error}"
        ))
    })?;
    context.with(|ctx| {
        ctx.eval::<(), _>(SUCRASE_SOURCE)
            .map_err(|error| js_error(&ctx, error))?;
        ctx.globals()
            .set("__tokencueTypeScriptSource", source.to_string())
            .map_err(|error| js_error(&ctx, error))?;
        ctx.eval::<String, _>(
            "sucrase.transform(__tokencueTypeScriptSource, {transforms:['typescript']}).code",
        )
        .map_err(|error| {
            PluginError::Load(format!(
                "TypeScript transpilation failed: {}",
                js_error(&ctx, error)
            ))
        })
    })
}

pub fn validate_source_policy(source: &str) -> PluginResult<()> {
    const FORBIDDEN: &[(&str, &str)] = &[
        ("import(", "dynamic import"),
        ("import (", "dynamic import"),
        ("eval(", "eval"),
        ("eval (", "eval"),
        ("Function(", "Function constructor"),
        ("Function (", "Function constructor"),
        ("new Function", "Function constructor"),
        (".constructor(", "constructor-based code generation"),
        ("process.", "process global"),
        ("require(", "Node require"),
        ("require (", "Node require"),
        ("child_process", "subprocess API"),
        ("Deno.", "Deno global"),
        ("Bun.", "Bun global"),
        ("XMLHttpRequest", "browser network global"),
        ("WebSocket", "browser network global"),
        ("document.", "browser document global"),
        ("window.", "browser window global"),
        ("localStorage", "browser storage global"),
        ("sessionStorage", "browser storage global"),
    ];
    for (needle, label) in FORBIDDEN {
        if source.contains(needle) {
            return Err(PluginError::SecurityPolicy(format!(
                "plugin source uses prohibited {label}"
            )));
        }
    }
    Ok(())
}

pub(crate) fn runtime_with_limits(timeout: Duration, started: Instant) -> PluginResult<Runtime> {
    let runtime = Runtime::new()
        .map_err(|error| PluginError::Load(format!("could not create QuickJS runtime: {error}")))?;
    runtime.set_memory_limit(32 * 1024 * 1024);
    runtime.set_max_stack_size(512 * 1024);
    runtime.set_interrupt_handler(Some(Box::new(move || started.elapsed() >= timeout)));
    Ok(runtime)
}

pub(crate) fn js_error(ctx: &Ctx<'_>, error: rquickjs::Error) -> PluginError {
    if matches!(error, rquickjs::Error::Exception) {
        let value = ctx.catch();
        if let Some(object) = value.as_object()
            && let Ok(message) = object.get::<_, String>("message")
        {
            return PluginError::Script(redact_engine_message(&message));
        }
    }
    let message = error.to_string();
    if message.to_ascii_lowercase().contains("interrupted") {
        PluginError::TimedOut
    } else {
        PluginError::Script(redact_engine_message(&message))
    }
}

fn redact_engine_message(message: &str) -> String {
    let mut value = message.replace(['\r', '\n'], " ");
    if value.len() > 1024 {
        value.truncate(1024);
        value.push('…');
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_PLUGIN: &str = r#"
        defineProvider({
          schemaVersion: 1,
          id: "fixture-provider",
          name: "Fixture Provider",
          endpoints: ["https://api.example.com"],
          settings: [],
          async fetchUsage() { return { primary: { usedPercent: 25 } }; },
        });
    "#;

    #[test]
    fn extracts_inline_manifest() {
        let manifest = extract_manifest(VALID_PLUGIN).unwrap();
        assert_eq!(manifest.id, "fixture-provider");
        assert_eq!(manifest.limits.timeout_ms, 10_000);
    }

    #[test]
    fn transpiles_typescript_with_shared_sucrase() {
        let source = VALID_PLUGIN.replace(
            "async fetchUsage()",
            "async fetchUsage(_ctx: unknown): Promise<object>",
        );
        let output = transpile_typescript(&source).unwrap();
        assert!(!output.contains(": unknown"));
        assert!(extract_manifest(&output).is_ok());
    }

    #[test]
    fn blocks_forbidden_runtime_globals() {
        let error = validate_source_policy("process.exit(1)").unwrap_err();
        assert!(matches!(error, PluginError::SecurityPolicy(_)));
    }
}
