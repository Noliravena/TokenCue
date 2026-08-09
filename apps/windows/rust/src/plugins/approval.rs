use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::loader::LoadedPlugin;
use super::manifest::{PluginAuthKind, PluginCapability};
use super::{PluginError, PluginResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginApprovalBinding {
    pub plugin_id: String,
    pub source_hash: String,
    pub origins: Vec<String>,
    pub auth_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_header: Option<String>,
    pub secret_names: Vec<String>,
    pub capabilities: Vec<String>,
    pub cookie_domains: Vec<String>,
    pub timeout_ms: u64,
    pub max_response_bytes: usize,
}

impl PluginApprovalBinding {
    pub fn new(plugin: &LoadedPlugin, settings: &HashMap<String, String>) -> PluginResult<Self> {
        let manifest = &plugin.manifest;
        let auth_mode = match manifest.auth.as_ref().map(|auth| auth.kind) {
            None => "none",
            Some(PluginAuthKind::Bearer) => "bearer",
            Some(PluginAuthKind::XApiKey) => "x-api-key",
            Some(PluginAuthKind::Header) => "header",
            Some(PluginAuthKind::AuthorizationScheme) => "authorization-scheme",
        }
        .to_string();
        let mut secret_names = manifest
            .settings
            .iter()
            .filter(|setting| setting.kind == super::manifest::PluginSettingKind::Secure)
            .map(|setting| setting.key.clone())
            .collect::<Vec<_>>();
        secret_names.sort();
        let capabilities = manifest
            .capabilities
            .iter()
            .map(|capability| match capability {
                PluginCapability::BrowserCookies => "browser-cookies".to_string(),
            })
            .collect();
        Ok(Self {
            plugin_id: manifest.id.clone(),
            source_hash: plugin.source_hash.clone(),
            origins: manifest.resolved_origins(settings)?,
            auth_mode,
            auth_header: manifest.auth.as_ref().and_then(|auth| auth.header.clone()),
            secret_names,
            capabilities,
            cookie_domains: manifest.cookie_domains.iter().cloned().collect(),
            timeout_ms: manifest.limits.timeout_ms,
            max_response_bytes: manifest.limits.max_response_bytes,
        })
    }

    pub fn requires_typed_origin_confirmation(&self) -> bool {
        self.origins.iter().any(|origin| {
            reqwest::Url::parse(origin)
                .ok()
                .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
                .is_none_or(|host| {
                    host == "localhost"
                        || host.ends_with(".local")
                        || host.parse::<std::net::IpAddr>().is_ok()
                })
        })
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalPayload {
    #[serde(default = "payload_version")]
    version: u32,
    #[serde(default)]
    approvals: BTreeMap<String, PluginApprovalBinding>,
}

#[derive(Debug, Clone)]
pub struct PluginApprovalStore {
    file_path: PathBuf,
}

impl PluginApprovalStore {
    pub fn new(file_path: PathBuf) -> Self {
        Self { file_path }
    }

    pub fn default_store() -> Self {
        Self::new(default_approval_path())
    }

    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    pub fn is_approved(&self, binding: &PluginApprovalBinding) -> bool {
        self.load()
            .ok()
            .and_then(|payload| payload.approvals.get(&binding.plugin_id).cloned())
            .as_ref()
            == Some(binding)
    }

    pub fn record(&self, binding: PluginApprovalBinding) -> PluginResult<()> {
        let mut payload = self.load().unwrap_or_default();
        payload.version = payload_version();
        payload.approvals.insert(binding.plugin_id.clone(), binding);
        self.save(&payload)
    }

    pub fn remove(&self, plugin_id: &str) -> PluginResult<bool> {
        let mut payload = self.load().unwrap_or_default();
        let removed = payload.approvals.remove(plugin_id).is_some();
        if removed {
            self.save(&payload)?;
        }
        Ok(removed)
    }

    fn load(&self) -> PluginResult<ApprovalPayload> {
        if !self.file_path.exists() {
            return Ok(ApprovalPayload::default());
        }
        let bytes = fs::read(&self.file_path).map_err(|error| {
            PluginError::Approval(format!("could not read approval store: {error}"))
        })?;
        let payload: ApprovalPayload = serde_json::from_slice(&bytes).map_err(|error| {
            PluginError::Approval(format!("approval store is invalid JSON: {error}"))
        })?;
        if payload.version != payload_version() {
            return Err(PluginError::Approval(format!(
                "unsupported approval store version {}",
                payload.version
            )));
        }
        Ok(payload)
    }

    fn save(&self, payload: &ApprovalPayload) -> PluginResult<()> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                PluginError::Approval(format!("could not create approval directory: {error}"))
            })?;
        }
        let bytes = serde_json::to_vec_pretty(payload).map_err(|error| {
            PluginError::Approval(format!("could not encode approval store: {error}"))
        })?;
        fs::write(&self.file_path, bytes).map_err(|error| {
            PluginError::Approval(format!("could not save approval store: {error}"))
        })
    }
}

pub fn default_approval_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TokenCue")
        .join("plugin-approvals.json")
}

const fn payload_version() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::loader::load_plugin;

    #[test]
    fn source_change_invalidates_approval() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("fixture.js");
        let source = |percent| {
            format!(
                r#"defineProvider({{
                  id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"],
                  settings: [], fetchUsage() {{ return {{ primary: {{ usedPercent: {percent} }} }}; }}
                }});"#
            )
        };
        fs::write(&path, source(20)).unwrap();
        let plugin = load_plugin(&path).unwrap();
        let first = PluginApprovalBinding::new(&plugin, &HashMap::new()).unwrap();
        let store = PluginApprovalStore::new(temporary.path().join("approvals.json"));
        store.record(first.clone()).unwrap();
        assert!(store.is_approved(&first));

        fs::write(&path, source(21)).unwrap();
        let changed =
            PluginApprovalBinding::new(&load_plugin(&path).unwrap(), &HashMap::new()).unwrap();
        assert!(!store.is_approved(&changed));
    }
}
