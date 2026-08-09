//! `tokencue plugins` — discover and execute explicitly approved JS/TS providers.

use std::collections::HashMap;
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;

use anyhow::Context;
use clap::{Args, Subcommand};
use serde::Serialize;
use serde_json::{Value, json};

use crate::core::{ProviderFetchResult, RateWindow};
use crate::plugins::approval::{PluginApprovalBinding, PluginApprovalStore};
use crate::plugins::loader::{LoadedPlugin, default_plugins_directory, discover_plugins};
use crate::plugins::manifest::{PluginCapability, PluginSettingKind};
use crate::plugins::runtime::{PluginExecutionContext, fetch_approved};

#[derive(Args, Debug, Clone)]
pub struct PluginsArgs {
    /// Override the plugin directory (defaults to the TokenCue user config directory)
    #[arg(long, global = true, env = "TOKENCUE_PLUGIN_DIR")]
    pub plugin_dir: Option<PathBuf>,

    /// Override the non-secret approval store path
    #[arg(long, global = true, env = "TOKENCUE_PLUGIN_APPROVALS")]
    pub approval_store: Option<PathBuf>,

    #[command(subcommand)]
    pub command: PluginsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum PluginsCommand {
    /// List discovered local plugins
    List(PluginsListArgs),
    /// Fetch one plugin after interactive permission approval
    Fetch(PluginsFetchArgs),
    /// Revoke the recorded approval for one plugin
    Revoke(PluginsRevokeArgs),
}

#[derive(Args, Debug, Clone)]
pub struct PluginsListArgs {
    /// Emit the versioned TokenCue CLI JSON envelope
    #[arg(long)]
    pub json: bool,
    /// Pretty-print JSON output
    #[arg(long)]
    pub pretty: bool,
}

#[derive(Args, Debug, Clone)]
pub struct PluginsFetchArgs {
    /// Plugin provider ID
    pub id: String,
    /// Plain plugin setting in KEY=VALUE form; repeat as needed
    #[arg(long = "setting", value_name = "KEY=VALUE")]
    pub settings: Vec<String>,
    /// Emit the versioned TokenCue CLI JSON envelope
    #[arg(long)]
    pub json: bool,
    /// Pretty-print JSON output
    #[arg(long)]
    pub pretty: bool,
}

#[derive(Args, Debug, Clone)]
pub struct PluginsRevokeArgs {
    /// Plugin provider ID
    pub id: String,
    /// Emit the versioned TokenCue CLI JSON envelope
    #[arg(long)]
    pub json: bool,
    /// Pretty-print JSON output
    #[arg(long)]
    pub pretty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginListItem {
    id: Option<String>,
    name: Option<String>,
    path: String,
    source_type: String,
    valid: bool,
    error: Option<String>,
}

pub async fn run(args: PluginsArgs) -> anyhow::Result<()> {
    let directory = args.plugin_dir.unwrap_or_else(default_plugins_directory);
    let approvals = args
        .approval_store
        .map(PluginApprovalStore::new)
        .unwrap_or_else(PluginApprovalStore::default_store);
    match args.command {
        PluginsCommand::List(list) => run_list(&directory, list),
        PluginsCommand::Fetch(fetch) => run_fetch(&directory, approvals, fetch).await,
        PluginsCommand::Revoke(revoke) => run_revoke(approvals, revoke),
    }
}

fn run_list(directory: &std::path::Path, args: PluginsListArgs) -> anyhow::Result<()> {
    let results = discover_plugins(directory);
    let items = results
        .iter()
        .map(|result| PluginListItem {
            id: result.plugin_id.clone(),
            name: result.name.clone(),
            path: result.file_path.display().to_string(),
            source_type: result
                .file_path
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("")
                .to_ascii_lowercase(),
            valid: result.plugin.is_some(),
            error: result.error.clone(),
        })
        .collect::<Vec<_>>();
    if args.json {
        let errors = items
            .iter()
            .filter_map(|item| {
                item.error
                    .as_ref()
                    .map(|message| cli_error(item.id.as_deref(), "plugin_load", message, false))
            })
            .collect::<Vec<_>>();
        print_json(
            &cli_envelope(
                "plugins",
                errors.is_empty(),
                json!({ "plugins": items }),
                errors,
            ),
            args.pretty,
        )?;
    } else if items.is_empty() {
        println!("No plugins found in {}", directory.display());
    } else {
        for item in items {
            if item.valid {
                println!(
                    "{}\t{}\t{}",
                    item.id.as_deref().unwrap_or("unknown"),
                    item.name.as_deref().unwrap_or("Unnamed plugin"),
                    item.path
                );
            } else {
                println!("error\t{}\t{}", item.path, item.error.unwrap_or_default());
            }
        }
    }
    Ok(())
}

async fn run_fetch(
    directory: &std::path::Path,
    approval_store: PluginApprovalStore,
    args: PluginsFetchArgs,
) -> anyhow::Result<()> {
    let plugin = find_plugin(directory, &args.id)?;
    if plugin
        .manifest
        .capabilities
        .contains(&PluginCapability::BrowserCookies)
    {
        anyhow::bail!(
            "Browser-cookie plugins require the TokenCue desktop approval flow; non-interactive CLI access fails closed."
        );
    }
    let settings = parse_plain_settings(&plugin, &args.settings)?;
    let secrets = plugin
        .manifest
        .settings
        .iter()
        .filter(|setting| setting.kind == PluginSettingKind::Secure)
        .filter_map(|setting| {
            let key = plugin_environment_key(&plugin.manifest.id, &setting.key);
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|value| (setting.key.clone(), value))
        })
        .collect::<HashMap<_, _>>();
    let binding = PluginApprovalBinding::new(&plugin, &settings)?;
    if !approval_store.is_approved(&binding) {
        if !io::stdin().is_terminal() || !io::stderr().is_terminal() {
            anyhow::bail!(
                "Plugin approval is required, but no interactive terminal is available; access fails closed."
            );
        }
        if !confirm_approval(&binding)? {
            anyhow::bail!("Plugin approval cancelled");
        }
        approval_store.record(binding)?;
    }
    let result = fetch_approved(
        plugin.clone(),
        PluginExecutionContext {
            settings,
            secrets,
            cookie_headers: HashMap::new(),
        },
        approval_store,
    )
    .await?;
    if args.json {
        print_json(
            &cli_envelope(
                "plugins",
                true,
                canonical_usage_json(&plugin.manifest.id, &result),
                Vec::new(),
            ),
            args.pretty,
        )?;
    } else {
        print_snapshot(&plugin, &result);
    }
    Ok(())
}

fn run_revoke(approval_store: PluginApprovalStore, args: PluginsRevokeArgs) -> anyhow::Result<()> {
    let removed = approval_store.remove(&args.id)?;
    if args.json {
        print_json(
            &cli_envelope(
                "plugins",
                true,
                json!({ "pluginId": args.id, "revoked": removed }),
                Vec::new(),
            ),
            args.pretty,
        )?;
    } else if removed {
        println!("Revoked plugin approval for {}", args.id);
    } else {
        println!("No recorded plugin approval for {}", args.id);
    }
    Ok(())
}

fn find_plugin(directory: &std::path::Path, id: &str) -> anyhow::Result<LoadedPlugin> {
    let results = discover_plugins(directory);
    if let Some(plugin) = results
        .iter()
        .filter_map(|result| result.plugin.clone())
        .find(|plugin| plugin.manifest.id == id)
    {
        return Ok(plugin);
    }
    if let Some(result) = results
        .iter()
        .find(|result| result.plugin_id.as_deref() == Some(id))
        && let Some(error) = &result.error
    {
        anyhow::bail!("Plugin '{id}' could not be loaded: {error}");
    }
    anyhow::bail!("Plugin '{id}' was not found in {}", directory.display())
}

fn parse_plain_settings(
    plugin: &LoadedPlugin,
    values: &[String],
) -> anyhow::Result<HashMap<String, String>> {
    let mut settings = HashMap::new();
    for value in values {
        let (key, raw_value) = value
            .split_once('=')
            .with_context(|| "--setting must use KEY=VALUE")?;
        if plugin.manifest.setting_kind(key) != Some(PluginSettingKind::Plain) {
            anyhow::bail!("Plain plugin setting '{key}' is not declared");
        }
        settings.insert(key.to_string(), raw_value.trim().to_string());
    }
    for setting in &plugin.manifest.settings {
        if setting.kind == PluginSettingKind::Plain && !settings.contains_key(&setting.key) {
            let key = plugin_environment_key(&plugin.manifest.id, &setting.key);
            if let Ok(value) = std::env::var(key)
                && !value.trim().is_empty()
            {
                settings.insert(setting.key.clone(), value.trim().to_string());
            }
        }
    }
    Ok(settings)
}

fn confirm_approval(binding: &PluginApprovalBinding) -> anyhow::Result<bool> {
    let mut stderr = io::stderr().lock();
    writeln!(
        stderr,
        "Plugin {} requests the following capabilities:",
        binding.plugin_id
    )?;
    for origin in &binding.origins {
        writeln!(stderr, "  origin: {origin}")?;
    }
    writeln!(stderr, "  auth: {}", binding.auth_mode)?;
    writeln!(stderr, "  secrets: {}", binding.secret_names.join(", "))?;
    writeln!(
        stderr,
        "  capabilities: {}",
        binding.capabilities.join(", ")
    )?;
    for domain in &binding.cookie_domains {
        writeln!(stderr, "  cookie domain: {domain}")?;
    }
    if binding.requires_typed_origin_confirmation() {
        for origin in &binding.origins {
            let url = reqwest::Url::parse(origin)?;
            let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
            let risky = host == "localhost"
                || host.ends_with(".local")
                || host.parse::<std::net::IpAddr>().is_ok();
            if risky {
                write!(stderr, "Type {origin} to confirm: ")?;
                stderr.flush()?;
                let mut answer = String::new();
                io::stdin().read_line(&mut answer)?;
                if answer.trim() != origin {
                    return Ok(false);
                }
            }
        }
    }
    write!(stderr, "Approve? [y/N] ")?;
    stderr.flush()?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    Ok(answer.trim().eq_ignore_ascii_case("y"))
}

fn plugin_environment_key(plugin_id: &str, setting_key: &str) -> String {
    let normalize = |value: &str| {
        value
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_uppercase()
                } else {
                    '_'
                }
            })
            .collect::<String>()
    };
    format!(
        "TOKENCUE_PLUGIN_{}_{}",
        normalize(plugin_id),
        normalize(setting_key)
    )
}

fn print_snapshot(plugin: &LoadedPlugin, result: &ProviderFetchResult) {
    println!("{}", plugin.manifest.name);
    println!(
        "Primary: {}% used",
        result.usage.primary.used_percent.round() as i64
    );
    if let Some(window) = &result.usage.secondary {
        println!("Secondary: {}% used", window.used_percent.round() as i64);
    }
    if let Some(cost) = &result.cost {
        println!("Cost: {:.2} {}", cost.used, cost.currency_code);
    }
}

fn canonical_usage_json(plugin_id: &str, result: &ProviderFetchResult) -> Value {
    let usage = &result.usage;
    let mut windows = vec![window_json("primary", "Primary", &usage.primary)];
    if let Some(window) = &usage.secondary {
        windows.push(window_json("secondary", "Secondary", window));
    }
    if let Some(window) = &usage.model_specific {
        windows.push(window_json("model-specific", "Model-specific", window));
    }
    if let Some(window) = &usage.tertiary {
        windows.push(window_json("tertiary", "Tertiary", window));
    }
    for extra in &usage.extra_rate_windows {
        windows.push(window_json(&extra.id, &extra.title, &extra.window));
    }
    let identity = if usage.account_email.is_some()
        || usage.account_organization.is_some()
        || usage.login_method.is_some()
    {
        json!({
            "accountId": null,
            "displayName": usage.account_email.as_ref().or(usage.account_organization.as_ref()),
            "plan": usage.login_method,
        })
    } else {
        Value::Null
    };
    let cost = result.cost.as_ref().map_or(Value::Null, |cost| {
        json!({
            "period": cost.period,
            "groups": [{ "amount": cost.used, "currency": cost.currency_code }],
        })
    });
    let balance = result.cost.as_ref().and_then(|cost| cost.balance).map_or(
        Value::Null,
        |amount| {
            json!({
                "amount": amount,
                "currency": result.cost.as_ref().map(|cost| cost.currency_code.as_str()).unwrap_or("USD"),
            })
        },
    );
    json!({
        "schemaVersion": 1,
        "providerId": plugin_id,
        "fetchedAt": usage.updated_at,
        "lastSuccessfulAt": usage.updated_at,
        "state": "fresh",
        "error": null,
        "identity": identity,
        "windows": windows,
        "accounts": [],
        "balance": balance,
        "cost": cost,
        "status": null,
        "diagnostics": { "source": "plugin" },
    })
}

fn window_json(id: &str, label: &str, window: &RateWindow) -> Value {
    json!({
        "id": id,
        "label": label,
        "usedPercent": window.used_percent,
        "resetsAt": window.resets_at,
        "pacePercent": null,
    })
}

fn cli_envelope(command: &str, ok: bool, data: Value, errors: Vec<Value>) -> Value {
    json!({
        "schemaVersion": 1,
        "command": command,
        "ok": ok,
        "data": data,
        "errors": errors,
        "redactions": ["credentials", "cookies", "tokens"],
    })
}

fn cli_error(provider_id: Option<&str>, code: &str, message: &str, retryable: bool) -> Value {
    json!({
        "providerId": provider_id,
        "code": code,
        "message": message,
        "retryable": retryable,
    })
}

fn print_json(value: &Value, pretty: bool) -> anyhow::Result<()> {
    if pretty {
        println!("{}", serde_json::to_string_pretty(value)?);
    } else {
        println!("{}", serde_json::to_string(value)?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{CostSnapshot, ProviderFetchResult, UsageSnapshot};

    #[test]
    fn environment_keys_match_macos_contract() {
        assert_eq!(
            plugin_environment_key("my-provider", "API_KEY"),
            "TOKENCUE_PLUGIN_MY_PROVIDER_API_KEY"
        );
    }

    #[test]
    fn json_fetch_uses_versioned_cli_and_usage_contracts() {
        let result = ProviderFetchResult::new(UsageSnapshot::new(RateWindow::new(42.0)), "plugin")
            .with_cost(CostSnapshot::new(2.5, "USD", "Monthly"));
        let envelope = cli_envelope(
            "plugins",
            true,
            canonical_usage_json("fixture-provider", &result),
            Vec::new(),
        );
        assert_eq!(envelope["schemaVersion"], 1);
        assert_eq!(envelope["command"], "plugins");
        assert_eq!(envelope["data"]["providerId"], "fixture-provider");
        assert_eq!(envelope["data"]["windows"][0]["usedPercent"], 42.0);
        assert_eq!(envelope["data"]["cost"]["groups"][0]["currency"], "USD");
    }
}
