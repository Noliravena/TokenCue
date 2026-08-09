use std::collections::{BTreeSet, HashMap};

use reqwest::Url;
use serde::{Deserialize, Serialize};

use super::{PluginError, PluginResult};

pub const DEFAULT_TIMEOUT_MS: u64 = 10_000;
pub const MAX_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_RESPONSE_BYTES: usize = 1024 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<PluginIcon>,
    pub endpoints: Vec<PluginEndpoint>,
    #[serde(default)]
    pub auth: Option<PluginAuth>,
    #[serde(default)]
    pub settings: Vec<PluginSetting>,
    #[serde(default)]
    pub capabilities: BTreeSet<PluginCapability>,
    #[serde(default)]
    pub cookie_domains: BTreeSet<String>,
    #[serde(default)]
    pub limits: PluginLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginIcon {
    pub monogram: String,
    pub tint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum PluginEndpoint {
    Fixed(String),
    Setting {
        setting: String,
        policy: EndpointPolicy,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EndpointPolicy {
    Https,
    HttpsOrLoopbackHttp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginAuth {
    #[serde(rename = "type")]
    pub kind: PluginAuthKind,
    pub secret: String,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub scheme: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginAuthKind {
    Bearer,
    XApiKey,
    Header,
    AuthorizationScheme,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginSetting {
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: PluginSettingKind,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginSettingKind {
    Plain,
    #[default]
    Secure,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum PluginCapability {
    BrowserCookies,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginLimits {
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_response_bytes")]
    pub max_response_bytes: usize,
}

impl Default for PluginLimits {
    fn default() -> Self {
        Self {
            timeout_ms: DEFAULT_TIMEOUT_MS,
            max_response_bytes: DEFAULT_RESPONSE_BYTES,
        }
    }
}

impl PluginManifest {
    pub fn validate(&mut self) -> PluginResult<()> {
        if self.schema_version != 1 {
            return Err(PluginError::InvalidManifest(
                "schemaVersion must be 1".to_string(),
            ));
        }
        validate_id(&self.id)?;
        validate_bounded(&self.name, "name", 80)?;
        if self.endpoints.is_empty() || self.endpoints.len() > 16 {
            return Err(PluginError::InvalidManifest(
                "endpoints must contain between 1 and 16 entries".to_string(),
            ));
        }
        if self.settings.len() > 32 {
            return Err(PluginError::InvalidManifest(
                "settings exceeds 32 entries".to_string(),
            ));
        }

        let mut keys = BTreeSet::new();
        for setting in &self.settings {
            validate_setting_key(&setting.key)?;
            validate_bounded(&setting.title, "setting title", 80)?;
            if let Some(subtitle) = &setting.subtitle {
                validate_bounded(subtitle, "setting subtitle", 256)?;
            }
            if !keys.insert(setting.key.clone()) {
                return Err(PluginError::InvalidManifest(format!(
                    "duplicate setting key '{}'",
                    setting.key
                )));
            }
        }

        for endpoint in &mut self.endpoints {
            match endpoint {
                PluginEndpoint::Fixed(origin) => {
                    *origin = normalize_origin(origin, EndpointPolicy::Https)?;
                }
                PluginEndpoint::Setting { setting, .. } => {
                    let declared = self
                        .settings
                        .iter()
                        .find(|candidate| candidate.key == *setting);
                    if declared.map(|value| value.kind) != Some(PluginSettingKind::Plain) {
                        return Err(PluginError::InvalidManifest(format!(
                            "endpoint setting '{setting}' must be declared as a plain setting"
                        )));
                    }
                }
            }
        }

        if let Some(auth) = &mut self.auth {
            let declared = self
                .settings
                .iter()
                .find(|candidate| candidate.key == auth.secret);
            if declared.map(|value| value.kind) != Some(PluginSettingKind::Secure) {
                return Err(PluginError::InvalidManifest(format!(
                    "auth secret '{}' must be declared as a secure setting",
                    auth.secret
                )));
            }
            match auth.kind {
                PluginAuthKind::Bearer => {
                    auth.header = Some("Authorization".to_string());
                    auth.scheme = Some("Bearer".to_string());
                }
                PluginAuthKind::XApiKey => {
                    auth.header = Some("X-API-Key".to_string());
                    auth.scheme = None;
                }
                PluginAuthKind::Header => {
                    let header = auth.header.as_deref().ok_or_else(|| {
                        PluginError::InvalidManifest("header auth requires a header".to_string())
                    })?;
                    validate_header_name(header)?;
                    auth.scheme = None;
                }
                PluginAuthKind::AuthorizationScheme => {
                    auth.header = Some("Authorization".to_string());
                    let scheme = auth.scheme.as_deref().ok_or_else(|| {
                        PluginError::InvalidManifest(
                            "authorization-scheme auth requires a scheme".to_string(),
                        )
                    })?;
                    validate_header_name(scheme)?;
                    if scheme.len() > 32 {
                        return Err(PluginError::InvalidManifest(
                            "authorization scheme exceeds 32 bytes".to_string(),
                        ));
                    }
                }
            }
        }

        let cookies_enabled = self
            .capabilities
            .contains(&PluginCapability::BrowserCookies);
        if cookies_enabled == self.cookie_domains.is_empty() {
            return Err(PluginError::InvalidManifest(
                "browser-cookies capability and cookieDomains must be declared together"
                    .to_string(),
            ));
        }
        self.cookie_domains = self
            .cookie_domains
            .iter()
            .map(|domain| normalize_domain(domain))
            .collect::<PluginResult<_>>()?;

        if !(100..=MAX_TIMEOUT_MS).contains(&self.limits.timeout_ms) {
            return Err(PluginError::InvalidManifest(format!(
                "limits.timeoutMs must be between 100 and {MAX_TIMEOUT_MS}"
            )));
        }
        if !(1024..=MAX_RESPONSE_BYTES).contains(&self.limits.max_response_bytes) {
            return Err(PluginError::InvalidManifest(format!(
                "limits.maxResponseBytes must be between 1024 and {MAX_RESPONSE_BYTES}"
            )));
        }
        Ok(())
    }

    pub fn resolved_origins(
        &self,
        settings: &HashMap<String, String>,
    ) -> PluginResult<Vec<String>> {
        let mut origins = BTreeSet::new();
        for endpoint in &self.endpoints {
            match endpoint {
                PluginEndpoint::Fixed(origin) => {
                    origins.insert(origin.clone());
                }
                PluginEndpoint::Setting { setting, policy } => {
                    let value = settings
                        .get(setting)
                        .map(|value| value.trim())
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| {
                            PluginError::InvalidManifest(format!(
                                "endpoint setting '{setting}' must contain a URL before approval"
                            ))
                        })?;
                    origins.insert(normalize_origin(value, *policy)?);
                }
            }
        }
        if self.auth.is_some() && origins.iter().any(|origin| origin.starts_with("http://")) {
            return Err(PluginError::NetworkPolicy(
                "authenticated plugin origins must use HTTPS".to_string(),
            ));
        }
        Ok(origins.into_iter().collect())
    }

    pub fn setting_kind(&self, key: &str) -> Option<PluginSettingKind> {
        self.settings
            .iter()
            .find(|setting| setting.key == key)
            .map(|setting| setting.kind)
    }
}

pub fn normalize_origin(raw: &str, policy: EndpointPolicy) -> PluginResult<String> {
    let url = Url::parse(raw.trim()).map_err(|_| {
        PluginError::InvalidManifest(format!("endpoint '{raw}' is not a valid URL"))
    })?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(PluginError::InvalidManifest(format!(
            "endpoint '{raw}' must not contain credentials, query, or fragment"
        )));
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err(PluginError::InvalidManifest(format!(
            "endpoint '{raw}' must be an origin without a path"
        )));
    }
    let scheme = url.scheme().to_ascii_lowercase();
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| PluginError::InvalidManifest("endpoint has no host".to_string()))?;
    let loopback = host == "localhost"
        || host == "::1"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    let allowed = scheme == "https"
        || (policy == EndpointPolicy::HttpsOrLoopbackHttp && scheme == "http" && loopback);
    if !allowed {
        return Err(PluginError::NetworkPolicy(
            "endpoints require HTTPS; HTTP is restricted to declared loopback endpoints"
                .to_string(),
        ));
    }
    let port = url.port();
    let default_port = if scheme == "https" { 443 } else { 80 };
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host
    };
    Ok(format!(
        "{scheme}://{host}{}",
        port.filter(|port| *port != default_port)
            .map(|port| format!(":{port}"))
            .unwrap_or_default()
    ))
}

pub fn origin_for_request(url: &Url) -> PluginResult<String> {
    let policy = if url.scheme().eq_ignore_ascii_case("http") {
        EndpointPolicy::HttpsOrLoopbackHttp
    } else {
        EndpointPolicy::Https
    };
    let mut origin = url.clone();
    origin.set_path("");
    origin.set_query(None);
    origin.set_fragment(None);
    normalize_origin(origin.as_str(), policy)
}

fn schema_version() -> u32 {
    1
}

fn default_timeout_ms() -> u64 {
    DEFAULT_TIMEOUT_MS
}

fn default_response_bytes() -> usize {
    DEFAULT_RESPONSE_BYTES
}

fn validate_id(value: &str) -> PluginResult<()> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 64
        || bytes
            .iter()
            .any(|byte| !byte.is_ascii_lowercase() && !byte.is_ascii_digit() && *byte != b'-')
    {
        return Err(PluginError::InvalidManifest(
            "id must contain 1-64 lowercase ASCII letters, digits, or hyphens".to_string(),
        ));
    }
    Ok(())
}

fn validate_setting_key(value: &str) -> PluginResult<()> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 64
        || !bytes[0].is_ascii_alphabetic()
        || bytes
            .iter()
            .any(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
    {
        return Err(PluginError::InvalidManifest(format!(
            "setting key '{value}' must contain ASCII letters, digits, or underscores and start with a letter"
        )));
    }
    Ok(())
}

fn validate_bounded(value: &str, label: &str, maximum: usize) -> PluginResult<()> {
    let value = value.trim();
    if value.is_empty() || value.len() > maximum {
        return Err(PluginError::InvalidManifest(format!(
            "{label} must contain 1-{maximum} UTF-8 bytes"
        )));
    }
    Ok(())
}

pub fn validate_header_name(value: &str) -> PluginResult<()> {
    if value.is_empty()
        || value
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && !b"!#$%&'*+-.^_`|~".contains(&byte))
    {
        return Err(PluginError::InvalidManifest(format!(
            "HTTP header name '{value}' is invalid"
        )));
    }
    Ok(())
}

fn normalize_domain(raw: &str) -> PluginResult<String> {
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 253
        || value.starts_with('.')
        || value.ends_with('.')
        || value.contains(['/', ':'])
    {
        return Err(PluginError::InvalidManifest(format!(
            "cookie domain '{raw}' is invalid"
        )));
    }
    let valid = value.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    });
    if !valid {
        return Err(PluginError::InvalidManifest(format!(
            "cookie domain '{raw}' is invalid"
        )));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> PluginManifest {
        PluginManifest {
            schema_version: 1,
            id: "fixture-provider".into(),
            name: "Fixture Provider".into(),
            icon: None,
            endpoints: vec![PluginEndpoint::Fixed("https://api.example.com".into())],
            auth: None,
            settings: Vec::new(),
            capabilities: BTreeSet::new(),
            cookie_domains: BTreeSet::new(),
            limits: PluginLimits::default(),
        }
    }

    #[test]
    fn normalizes_fixed_https_origin() {
        let mut value = manifest();
        value.validate().unwrap();
        assert_eq!(
            value.endpoints,
            vec![PluginEndpoint::Fixed("https://api.example.com".into())]
        );
    }

    #[test]
    fn rejects_non_loopback_http() {
        let error = normalize_origin("http://example.com", EndpointPolicy::HttpsOrLoopbackHttp)
            .unwrap_err();
        assert!(matches!(error, PluginError::NetworkPolicy(_)));
    }

    #[test]
    fn allows_explicit_loopback_http() {
        assert_eq!(
            normalize_origin("http://127.0.0.1:8787", EndpointPolicy::HttpsOrLoopbackHttp).unwrap(),
            "http://127.0.0.1:8787"
        );
    }

    #[test]
    fn rejects_limits_above_contract_caps() {
        let mut value = manifest();
        value.limits.max_response_bytes = MAX_RESPONSE_BYTES + 1;
        assert!(value.validate().is_err());
    }
}
