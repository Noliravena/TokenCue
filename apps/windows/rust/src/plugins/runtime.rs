use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Datelike, LocalResult, TimeZone, Utc};
use chrono_tz::Tz;
use reqwest::Url;
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    ACCEPT, ACCEPT_ENCODING, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue, LOCATION,
};
use reqwest::{Method, StatusCode};
use rquickjs::function::Func;
use rquickjs::promise::MaybePromise;
use rquickjs::{Context, Ctx, Function, Object, Value};
use serde::Deserialize;
use serde_json::{Map, Value as JsonValue, json};

use crate::core::{CostSnapshot, NamedRateWindow, ProviderFetchResult, RateWindow, UsageSnapshot};

use super::approval::{PluginApprovalBinding, PluginApprovalStore};
use super::loader::{LoadedPlugin, js_error, runtime_with_limits};
use super::manifest::{PluginAuthKind, PluginManifest, PluginSettingKind, origin_for_request};
use super::{PluginError, PluginResult};

const PLUGIN_PRELUDE: &str =
    include_str!("../../../../../shared/plugins/provider-plugin-prelude.js");
const MAX_REDIRECTS: usize = 5;
const MAX_LOG_BYTES: usize = 4096;
const MAX_CACHE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Default)]
pub struct PluginExecutionContext {
    pub settings: HashMap<String, String>,
    pub secrets: HashMap<String, String>,
    /// Cookie headers must be supplied by an explicit, user-approved browser broker.
    /// The CLI intentionally leaves this map empty and therefore fails closed.
    pub cookie_headers: HashMap<String, String>,
}

pub async fn fetch_approved(
    plugin: LoadedPlugin,
    context: PluginExecutionContext,
    approval_store: PluginApprovalStore,
) -> PluginResult<ProviderFetchResult> {
    let binding = PluginApprovalBinding::new(&plugin, &context.settings)?;
    if !approval_store.is_approved(&binding) {
        return Err(PluginError::ApprovalRequired(Box::new(binding)));
    }
    tokio::task::spawn_blocking(move || execute_sync(plugin, context, binding))
        .await
        .map_err(|error| PluginError::Runtime(format!("plugin worker failed: {error}")))?
}

pub fn execute_sync(
    plugin: LoadedPlugin,
    context: PluginExecutionContext,
    binding: PluginApprovalBinding,
) -> PluginResult<ProviderFetchResult> {
    if binding.plugin_id != plugin.manifest.id || binding.source_hash != plugin.source_hash {
        return Err(PluginError::Approval(
            "approval binding does not match the loaded plugin".to_string(),
        ));
    }
    let timeout = Duration::from_millis(plugin.manifest.limits.timeout_ms);
    let started = Instant::now();
    let runtime = runtime_with_limits(timeout, started)?;
    let context_js = Context::full(&runtime).map_err(|error| {
        PluginError::Runtime(format!("could not create QuickJS context: {error}"))
    })?;
    let native = Arc::new(NativeState::new(&plugin, context, binding, started)?);

    let execution = context_js.with(|ctx| {
        install_definition_capture(&ctx)?;
        remove_unavailable_globals(&ctx);
        ctx.eval::<(), _>(plugin.transpiled_source.as_str())
            .map_err(|error| js_error(&ctx, error))?;
        let globals = ctx.globals();
        let definition: Object = globals
            .get("__tokencueDefinition")
            .map_err(|error| js_error(&ctx, error))?;
        let fetch_usage: Function = definition
            .get("fetchUsage")
            .map_err(|error| js_error(&ctx, error))?;
        let plugin_context = build_plugin_context(&ctx, Arc::clone(&native))?;
        let _ = globals.remove("defineProvider");
        let _ = globals.remove("__tokencueDefinition");

        let pending: Value = fetch_usage
            .call((plugin_context,))
            .map_err(|error| js_error(&ctx, error))?;
        let resolved: Value = MaybePromise::from_value(pending)
            .finish()
            .map_err(|error| js_error(&ctx, error))?;
        let encoded = ctx
            .json_stringify(resolved)
            .map_err(|error| js_error(&ctx, error))?
            .ok_or_else(|| PluginError::InvalidSnapshot("fetchUsage returned undefined".into()))?;
        encoded.to_string().map_err(|error| {
            PluginError::InvalidSnapshot(format!("could not encode snapshot: {error}"))
        })
    });
    let json = execution.map_err(|error| native.redact_error(error))?;
    let snapshot: PluginSnapshot = serde_json::from_str(&json).map_err(|error| {
        PluginError::InvalidSnapshot(format!("fetchUsage returned an invalid snapshot: {error}"))
    })?;
    map_snapshot(snapshot)
}

fn install_definition_capture(ctx: &Ctx<'_>) -> PluginResult<()> {
    ctx.eval::<(), _>(
        "globalThis.defineProvider = value => { if (globalThis.__tokencueDefinition !== undefined) throw new TypeError('defineProvider may only be called once'); globalThis.__tokencueDefinition = value; };",
    )
    .map_err(|error| js_error(ctx, error))
}

fn remove_unavailable_globals(ctx: &Ctx<'_>) {
    let globals = ctx.globals();
    for name in [
        "eval",
        "Function",
        "process",
        "require",
        "module",
        "exports",
        "Buffer",
        "Deno",
        "Bun",
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "Worker",
        "SharedWorker",
        "window",
        "document",
        "navigator",
        "localStorage",
        "sessionStorage",
    ] {
        let _ = globals.remove(name);
    }
}

fn build_plugin_context<'js>(
    ctx: &Ctx<'js>,
    native: Arc<NativeState>,
) -> PluginResult<Object<'js>> {
    let globals = ctx.globals();

    let state = Arc::clone(&native);
    globals
        .set(
            "__tokencueHttp",
            Func::from(
                move |ctx: Ctx<'js>,
                      url: String,
                      options: String,
                      method: String,
                      wants_json: bool| {
                    state
                        .http(&url, &options, &method, wants_json)
                        .map_err(|message| rquickjs::Exception::throw_message(&ctx, &message))
                },
            ),
        )
        .map_err(|error| js_error(ctx, error))?;

    let state = Arc::clone(&native);
    globals
        .set(
            "__tokencueSettingGet",
            Func::from(move |ctx: Ctx<'js>, key: String, secure: bool| {
                state
                    .setting(&key, secure)
                    .map_err(|message| rquickjs::Exception::throw_message(&ctx, &message))
            }),
        )
        .map_err(|error| js_error(ctx, error))?;

    let state = Arc::clone(&native);
    globals
        .set(
            "__tokencueCookieHeader",
            Func::from(move |ctx: Ctx<'js>, domain: String| {
                state
                    .cookie_header(&domain)
                    .map_err(|message| rquickjs::Exception::throw_message(&ctx, &message))
            }),
        )
        .map_err(|error| js_error(ctx, error))?;

    let state = Arc::clone(&native);
    globals
        .set(
            "__tokencueLog",
            Func::from(move |message: String| state.log(&message)),
        )
        .map_err(|error| js_error(ctx, error))?;

    let state = Arc::clone(&native);
    globals
        .set(
            "__tokencueCacheGet",
            Func::from(move |key: String| state.cache_get(&key)),
        )
        .map_err(|error| js_error(ctx, error))?;

    let state = Arc::clone(&native);
    globals
        .set(
            "__tokencueCacheSet",
            Func::from(move |ctx: Ctx<'js>, key: String, value: String, ttl: f64| {
                state
                    .cache_set(&key, value, ttl)
                    .map_err(|message| rquickjs::Exception::throw_message(&ctx, &message))
            }),
        )
        .map_err(|error| js_error(ctx, error))?;

    globals
        .set(
            "__tokencueNextDailyReset",
            Func::from(move |ctx: Ctx<'js>, time_zone: String, hour: i32| {
                next_daily_reset(&time_zone, hour)
                    .map_err(|message| rquickjs::Exception::throw_message(&ctx, &message))
            }),
        )
        .map_err(|error| js_error(ctx, error))?;

    let bootstrap = format!(
        r#"
        globalThis.__tokencueContext = ((nativeHttp, nativeSettingGet, nativeCookieHeader,
          nativeLog, nativeCacheGet, nativeCacheSet, nativeNextDailyReset) => {{
          const host = Object.freeze({{
            http(url, options, method, wantsJSON, resolve, reject) {{
              try {{
                const payload = nativeHttp(String(url), JSON.stringify(options || {{}}), String(method), Boolean(wantsJSON));
                resolve(JSON.parse(payload));
              }} catch (error) {{ reject(error); }}
            }},
            settingGet(key, secure) {{ return nativeSettingGet(String(key), Boolean(secure)); }},
            cookieHeader(domain, resolve, reject) {{
              try {{ resolve(nativeCookieHeader(String(domain))); }} catch (error) {{ reject(error); }}
            }},
            log(message) {{ nativeLog(String(message)); }},
            cacheGet(key) {{
              const value = nativeCacheGet(String(key));
              return value === null ? null : JSON.parse(value);
            }},
            cacheSet(key, value, ttlSeconds) {{
              nativeCacheSet(String(key), JSON.stringify(value), Number(ttlSeconds));
            }},
            nextDailyReset(timeZone, hour) {{ return nativeNextDailyReset(String(timeZone), Number(hour)); }},
          }});
          return Object.freeze(({})(Object.create(null), host));
        }})(__tokencueHttp, __tokencueSettingGet, __tokencueCookieHeader, __tokencueLog,
          __tokencueCacheGet, __tokencueCacheSet, __tokencueNextDailyReset);
        "#,
        PLUGIN_PRELUDE
    );
    ctx.eval::<(), _>(bootstrap)
        .map_err(|error| js_error(ctx, error))?;
    let value = globals
        .get("__tokencueContext")
        .map_err(|error| js_error(ctx, error))?;
    for name in [
        "__tokencueHttp",
        "__tokencueSettingGet",
        "__tokencueCookieHeader",
        "__tokencueLog",
        "__tokencueCacheGet",
        "__tokencueCacheSet",
        "__tokencueNextDailyReset",
        "__tokencueContext",
    ] {
        let _ = globals.remove(name);
    }
    Ok(value)
}

#[derive(Debug)]
struct NativeState {
    plugin_id: String,
    manifest: PluginManifest,
    settings: HashMap<String, String>,
    secrets: HashMap<String, String>,
    cookies: HashMap<String, String>,
    allowed_origins: Vec<String>,
    client: Client,
    started: Instant,
    deadline: Instant,
    cache: Mutex<HashMap<String, CacheValue>>,
}

#[derive(Debug, Clone)]
struct CacheValue {
    json: String,
    expires_at: Instant,
}

impl NativeState {
    fn new(
        plugin: &LoadedPlugin,
        context: PluginExecutionContext,
        binding: PluginApprovalBinding,
        started: Instant,
    ) -> PluginResult<Self> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .cookie_store(false)
            .build()
            .map_err(|error| {
                PluginError::Runtime(format!("could not build plugin HTTP client: {error}"))
            })?;
        Ok(Self {
            plugin_id: plugin.manifest.id.clone(),
            manifest: plugin.manifest.clone(),
            settings: context.settings,
            secrets: context.secrets,
            cookies: context
                .cookie_headers
                .into_iter()
                .map(|(domain, header)| (domain.to_ascii_lowercase(), header))
                .collect(),
            allowed_origins: binding.origins,
            client,
            started,
            deadline: started + Duration::from_millis(plugin.manifest.limits.timeout_ms),
            cache: Mutex::new(HashMap::new()),
        })
    }

    fn setting(&self, key: &str, secure: bool) -> Result<Option<String>, String> {
        let expected = if secure {
            PluginSettingKind::Secure
        } else {
            PluginSettingKind::Plain
        };
        if self.manifest.setting_kind(key) != Some(expected) {
            return Err(self.redact(&format!(
                "{} setting '{key}' is not declared",
                if secure { "secret" } else { "plain" }
            )));
        }
        let values = if secure {
            &self.secrets
        } else {
            &self.settings
        };
        Ok(values
            .get(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()))
    }

    fn cookie_header(&self, domain: &str) -> Result<String, String> {
        let normalized = domain.trim().trim_start_matches('.').to_ascii_lowercase();
        if !self.manifest.cookie_domains.contains(&normalized) {
            return Err("cookie domain is not declared".to_string());
        }
        self.cookies
            .get(&normalized)
            .filter(|value| !value.is_empty())
            .cloned()
            .ok_or_else(|| {
                "browser cookie access is unavailable without interactive authorization".to_string()
            })
    }

    fn http(
        &self,
        raw_url: &str,
        raw_options: &str,
        raw_method: &str,
        wants_json: bool,
    ) -> Result<String, String> {
        let options: HttpOptions = serde_json::from_str(raw_options)
            .map_err(|error| self.redact(&format!("HTTP options are invalid: {error}")))?;
        let mut url = Url::parse(raw_url).map_err(|_| "request URL is invalid".to_string())?;
        self.validate_url(&url)?;
        let mut method = Method::from_bytes(raw_method.as_bytes())
            .map_err(|_| "HTTP method is invalid".to_string())?;
        if method != Method::GET && method != Method::POST {
            return Err("HTTP method is not allowed".to_string());
        }
        if options.headers.len() > 64 {
            return Err("request headers exceed 64 entries".to_string());
        }
        let mut body = if method == Method::POST {
            Some(
                options
                    .body_json
                    .clone()
                    .ok_or_else(|| "POST JSON body is missing".to_string())?,
            )
        } else {
            None
        };
        let mut redirects = 0;
        loop {
            let timeout = self.request_timeout(options.timeout_seconds)?;
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .timeout(timeout);
            request = request.header(ACCEPT, "application/json");
            request = request.header(ACCEPT_ENCODING, "identity");
            if method == Method::POST {
                request = request.header(CONTENT_TYPE, "application/json");
                request = request.body(body.clone().unwrap_or_default());
            }
            request = self.apply_headers(request, &options.headers)?;
            request = self.apply_auth(request)?;
            let response = request
                .send()
                .map_err(|error| self.redact(&format!("plugin HTTP request failed: {error}")))?;
            if response.status().is_redirection() {
                if redirects >= MAX_REDIRECTS {
                    return Err("plugin HTTP redirect limit exceeded".to_string());
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| "redirect response has no valid Location header".to_string())?;
                let next = url
                    .join(location)
                    .map_err(|_| "redirect target is invalid".to_string())?;
                self.validate_url(&next)?;
                if matches!(
                    response.status(),
                    StatusCode::MOVED_PERMANENTLY | StatusCode::FOUND | StatusCode::SEE_OTHER
                ) {
                    method = Method::GET;
                    body = None;
                }
                url = next;
                redirects += 1;
                continue;
            }
            return self.response_payload(response, wants_json);
        }
    }

    fn validate_url(&self, url: &Url) -> Result<(), String> {
        let origin = origin_for_request(url).map_err(|error| error.to_string())?;
        if !self.allowed_origins.contains(&origin) {
            return Err(format!("origin '{origin}' is not declared and approved"));
        }
        if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
            return Err("request URL may not contain credentials or a fragment".to_string());
        }
        Ok(())
    }

    fn request_timeout(&self, requested: Option<f64>) -> Result<Duration, String> {
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("plugin timed out".to_string());
        }
        let duration = if let Some(seconds) = requested {
            if !seconds.is_finite() || !(1.0..=30.0).contains(&seconds) {
                return Err("timeoutSeconds must be a number from 1 through 30".to_string());
            }
            Duration::from_secs_f64(seconds)
        } else {
            remaining
        };
        Ok(duration.min(remaining))
    }

    fn apply_headers(
        &self,
        mut request: reqwest::blocking::RequestBuilder,
        headers: &BTreeMap<String, String>,
    ) -> Result<reqwest::blocking::RequestBuilder, String> {
        let auth_header = self
            .manifest
            .auth
            .as_ref()
            .and_then(|auth| auth.header.as_deref());
        let mut total_bytes = 0usize;
        for (raw_name, raw_value) in headers {
            total_bytes = total_bytes.saturating_add(raw_name.len() + raw_value.len());
            if total_bytes > 16 * 1024 {
                return Err("request headers exceed the 16 KiB limit".to_string());
            }
            if [
                "host",
                "content-length",
                "transfer-encoding",
                "accept-encoding",
            ]
            .iter()
            .any(|blocked| raw_name.eq_ignore_ascii_case(blocked))
                || auth_header.is_some_and(|header| raw_name.eq_ignore_ascii_case(header))
            {
                return Err(format!(
                    "plugins may not override request header '{raw_name}'"
                ));
            }
            let name = HeaderName::from_bytes(raw_name.as_bytes())
                .map_err(|_| format!("request header '{raw_name}' is invalid"))?;
            let value = HeaderValue::from_str(raw_value)
                .map_err(|_| format!("request header '{raw_name}' has an invalid value"))?;
            request = request.header(name, value);
        }
        Ok(request)
    }

    fn apply_auth(
        &self,
        request: reqwest::blocking::RequestBuilder,
    ) -> Result<reqwest::blocking::RequestBuilder, String> {
        let Some(auth) = &self.manifest.auth else {
            return Ok(request);
        };
        let secret = self
            .secrets
            .get(&auth.secret)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("required secret '{}' is unavailable", auth.secret))?;
        let header = auth
            .header
            .as_deref()
            .ok_or_else(|| "auth header is unavailable".to_string())?;
        let value = match auth.kind {
            PluginAuthKind::Bearer => format!("Bearer {secret}"),
            PluginAuthKind::AuthorizationScheme => {
                format!("{} {secret}", auth.scheme.as_deref().unwrap_or_default())
            }
            PluginAuthKind::XApiKey | PluginAuthKind::Header => secret.to_string(),
        };
        Ok(request.header(header, value))
    }

    fn response_payload(&self, mut response: Response, wants_json: bool) -> Result<String, String> {
        let status = response.status().as_u16();
        let headers = safe_response_headers(response.headers());
        let limit = self.manifest.limits.max_response_bytes;
        let mut bytes = Vec::new();
        response
            .by_ref()
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                self.redact(&format!("could not read plugin HTTP response: {error}"))
            })?;
        if bytes.len() > limit {
            return Err(format!("response exceeded the {limit}-byte limit"));
        }
        let mut payload = Map::new();
        payload.insert("status".to_string(), JsonValue::from(status));
        payload.insert(
            "headers".to_string(),
            serde_json::to_value(headers).unwrap_or_else(|_| json!({})),
        );
        if wants_json {
            let value: JsonValue = serde_json::from_slice(&bytes)
                .map_err(|_| "response was not valid JSON".to_string())?;
            payload.insert("json".to_string(), value);
        } else {
            let text = String::from_utf8(bytes)
                .map_err(|_| "response body was not valid UTF-8".to_string())?;
            payload.insert("bodyText".to_string(), JsonValue::String(text));
        }
        serde_json::to_string(&payload)
            .map_err(|error| format!("could not encode response payload: {error}"))
    }

    fn log(&self, message: &str) {
        let mut message = self.redact(message).replace(['\r', '\n'], " ");
        if message.len() > MAX_LOG_BYTES {
            message.truncate(MAX_LOG_BYTES);
            message.push('…');
        }
        tracing::info!(plugin_id = %self.plugin_id, elapsed_ms = self.started.elapsed().as_millis(), "{message}");
    }

    fn cache_get(&self, key: &str) -> Option<String> {
        let mut cache = self.cache.lock().ok()?;
        let value = cache.get(key)?.clone();
        if value.expires_at <= Instant::now() {
            cache.remove(key);
            return None;
        }
        Some(value.json)
    }

    fn cache_set(&self, key: &str, value: String, ttl_seconds: f64) -> Result<(), String> {
        if key.is_empty() || key.len() > 128 {
            return Err("cache key must contain 1-128 bytes".to_string());
        }
        if value.len() > MAX_CACHE_BYTES {
            return Err("cache value exceeds 256 KiB".to_string());
        }
        if !ttl_seconds.is_finite() || !(1.0..=3600.0).contains(&ttl_seconds) {
            return Err("cache TTL must be between 1 and 3600 seconds".to_string());
        }
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "plugin cache lock is unavailable".to_string())?;
        if cache.len() >= 64 && !cache.contains_key(key) {
            return Err("plugin cache exceeds 64 entries".to_string());
        }
        cache.insert(
            key.to_string(),
            CacheValue {
                json: value,
                expires_at: Instant::now() + Duration::from_secs_f64(ttl_seconds),
            },
        );
        Ok(())
    }

    fn redact(&self, message: &str) -> String {
        let mut value = message.to_string();
        for secret in self.secrets.values().chain(self.cookies.values()) {
            if !secret.is_empty() {
                value = value.replace(secret, "<redacted>");
            }
        }
        value
    }

    fn redact_error(&self, error: PluginError) -> PluginError {
        match error {
            PluginError::Load(message) => PluginError::Load(self.redact(&message)),
            PluginError::InvalidManifest(message) => {
                PluginError::InvalidManifest(self.redact(&message))
            }
            PluginError::SecurityPolicy(message) => {
                PluginError::SecurityPolicy(self.redact(&message))
            }
            PluginError::NetworkPolicy(message) => {
                PluginError::NetworkPolicy(self.redact(&message))
            }
            PluginError::Approval(message) => PluginError::Approval(self.redact(&message)),
            PluginError::Runtime(message) => PluginError::Runtime(self.redact(&message)),
            PluginError::Script(message) => PluginError::Script(self.redact(&message)),
            PluginError::InvalidSnapshot(message) => {
                PluginError::InvalidSnapshot(self.redact(&message))
            }
            PluginError::ApprovalRequired(binding) => PluginError::ApprovalRequired(binding),
            PluginError::TimedOut => PluginError::TimedOut,
        }
    }
}

fn safe_response_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut output = BTreeMap::new();
    for (name, value) in headers.iter().take(64) {
        if name.as_str().eq_ignore_ascii_case("set-cookie") {
            continue;
        }
        if let Ok(value) = value.to_str() {
            let mut value = value.to_string();
            if value.len() > 1024 {
                value.truncate(1024);
            }
            output.insert(name.as_str().to_ascii_lowercase(), value);
        }
    }
    output
}

fn next_daily_reset(time_zone: &str, hour: i32) -> Result<i64, String> {
    if !(0..=23).contains(&hour) {
        return Err("reset hour must be an integer from 0 through 23".to_string());
    }
    let zone: Tz = time_zone
        .parse()
        .map_err(|_| "time zone is invalid".to_string())?;
    let now = Utc::now();
    let local = now.with_timezone(&zone);
    let mut date = local.date_naive();
    for _ in 0..2 {
        let candidate =
            match zone.with_ymd_and_hms(date.year(), date.month(), date.day(), hour as u32, 0, 0) {
                LocalResult::Single(value) => value,
                LocalResult::Ambiguous(first, second) => first.min(second),
                LocalResult::None => {
                    date = date
                        .succ_opt()
                        .ok_or_else(|| "reset date overflowed".to_string())?;
                    continue;
                }
            };
        if candidate.with_timezone(&Utc) > now {
            return Ok(candidate.timestamp_millis());
        }
        date = date
            .succ_opt()
            .ok_or_else(|| "reset date overflowed".to_string())?;
    }
    Err("could not calculate the next daily reset".to_string())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpOptions {
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body_json: Option<String>,
    #[serde(default)]
    timeout_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginSnapshot {
    #[serde(default)]
    primary: Option<PluginWindow>,
    #[serde(default)]
    secondary: Option<PluginWindow>,
    #[serde(default)]
    model_specific: Option<PluginWindow>,
    #[serde(default)]
    tertiary: Option<PluginWindow>,
    #[serde(default)]
    extra_windows: Vec<PluginExtraWindow>,
    #[serde(default)]
    identity: Option<PluginIdentity>,
    #[serde(default)]
    cost: Option<PluginCost>,
    #[serde(default)]
    details: Vec<JsonValue>,
    #[serde(default)]
    subscription_renews_at: Option<DateTime<Utc>>,
    #[serde(default)]
    subscription_expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    data_confidence: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginWindow {
    used_percent: f64,
    #[serde(default)]
    window_minutes: Option<u32>,
    #[serde(default)]
    resets_at: Option<DateTime<Utc>>,
    #[serde(default)]
    reset_description: Option<String>,
    #[serde(default)]
    next_regen_percent: Option<f64>,
}

impl PluginWindow {
    fn into_rate_window(self) -> PluginResult<RateWindow> {
        if !self.used_percent.is_finite() {
            return Err(PluginError::InvalidSnapshot(
                "usedPercent must be finite".to_string(),
            ));
        }
        if self
            .reset_description
            .as_ref()
            .is_some_and(|value| value.len() > 256)
        {
            return Err(PluginError::InvalidSnapshot(
                "resetDescription exceeds 256 bytes".to_string(),
            ));
        }
        if self
            .next_regen_percent
            .is_some_and(|value| !value.is_finite())
        {
            return Err(PluginError::InvalidSnapshot(
                "nextRegenPercent must be finite".to_string(),
            ));
        }
        Ok(RateWindow::with_details(
            self.used_percent,
            self.window_minutes.filter(|value| *value > 0),
            self.resets_at,
            self.reset_description,
        ))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginExtraWindow {
    id: String,
    title: String,
    #[serde(default)]
    window: Option<PluginWindow>,
    #[serde(default)]
    used_percent: Option<f64>,
    #[serde(default)]
    window_minutes: Option<u32>,
    #[serde(default)]
    resets_at: Option<DateTime<Utc>>,
    #[serde(default)]
    reset_description: Option<String>,
    #[serde(default)]
    next_regen_percent: Option<f64>,
}

impl PluginExtraWindow {
    fn into_window(self) -> PluginResult<(String, String, RateWindow)> {
        let window = self.window.or_else(|| {
            self.used_percent.map(|used_percent| PluginWindow {
                used_percent,
                window_minutes: self.window_minutes,
                resets_at: self.resets_at,
                reset_description: self.reset_description,
                next_regen_percent: self.next_regen_percent,
            })
        });
        let window = window.ok_or_else(|| {
            PluginError::InvalidSnapshot(
                "extra window must contain window or usedPercent".to_string(),
            )
        })?;
        Ok((self.id, self.title, window.into_rate_window()?))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginIdentity {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    organization: Option<String>,
    #[serde(default)]
    login_method: Option<String>,
    #[serde(default)]
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginCost {
    used: f64,
    #[serde(default)]
    limit: Option<f64>,
    currency: String,
    #[serde(default = "default_cost_period")]
    period: String,
    #[serde(default)]
    resets_at: Option<DateTime<Utc>>,
    #[serde(default)]
    balance: Option<f64>,
    #[serde(default)]
    next_regen_amount: Option<f64>,
}

fn default_cost_period() -> String {
    "Current".to_string()
}

fn map_snapshot(snapshot: PluginSnapshot) -> PluginResult<ProviderFetchResult> {
    let PluginSnapshot {
        primary,
        mut secondary,
        mut model_specific,
        mut tertiary,
        mut extra_windows,
        identity,
        cost,
        details,
        subscription_renews_at,
        subscription_expires_at,
        data_confidence,
    } = snapshot;
    if details.len() > 16 {
        return Err(PluginError::InvalidSnapshot(
            "details exceeds 16 sections".to_string(),
        ));
    }
    if let Some(confidence) = data_confidence.as_deref()
        && !matches!(
            confidence,
            "exact" | "estimated" | "percentOnly" | "unknown"
        )
    {
        return Err(PluginError::InvalidSnapshot(
            "dataConfidence is invalid".to_string(),
        ));
    }
    let promoted_extra = if primary.is_none()
        && secondary.is_none()
        && model_specific.is_none()
        && tertiary.is_none()
        && !extra_windows.is_empty()
    {
        Some(extra_windows.remove(0).into_window()?)
    } else {
        None
    };
    let primary = primary
        .or_else(|| secondary.take())
        .or_else(|| model_specific.take())
        .or_else(|| tertiary.take())
        .map(PluginWindow::into_rate_window)
        .transpose()?
        .or_else(|| promoted_extra.as_ref().map(|(_, _, window)| window.clone()))
        .or_else(|| {
            (cost.is_some() || !details.is_empty()).then(|| {
                RateWindow::informational(if cost.is_some() {
                    "Cost data"
                } else {
                    "Provider details"
                })
            })
        })
        .ok_or_else(|| {
            PluginError::InvalidSnapshot(
                "snapshot must contain at least one rate window, cost, or detail".to_string(),
            )
        })?;
    let mut usage = UsageSnapshot::new(primary);
    usage.secondary = secondary.map(PluginWindow::into_rate_window).transpose()?;
    usage.model_specific = model_specific
        .map(PluginWindow::into_rate_window)
        .transpose()?;
    usage.tertiary = tertiary.map(PluginWindow::into_rate_window).transpose()?;
    usage.extra_rate_windows = extra_windows
        .into_iter()
        .map(|entry| {
            let (id, title, window) = entry.into_window()?;
            if id.is_empty() || id.len() > 64 || title.is_empty() || title.len() > 80 {
                return Err(PluginError::InvalidSnapshot(
                    "extra window id/title is invalid".to_string(),
                ));
            }
            Ok(NamedRateWindow::new(id, title, window))
        })
        .collect::<PluginResult<Vec<_>>>()?;
    if let Some((id, title, _)) = promoted_extra {
        usage
            .extra_rate_windows
            .insert(0, NamedRateWindow::new(id, title, usage.primary.clone()));
    }
    if let Some(date) = subscription_renews_at {
        usage.extra_rate_windows.push(NamedRateWindow::new(
            "subscription-renews",
            "Subscription renews",
            RateWindow::with_details(0.0, None, Some(date), None),
        ));
    }
    if let Some(date) = subscription_expires_at {
        usage.extra_rate_windows.push(NamedRateWindow::new(
            "subscription-expires",
            "Subscription expires",
            RateWindow::with_details(0.0, None, Some(date), None),
        ));
    }
    if let Some(identity) = identity {
        usage.account_email = bounded(identity.email, "identity.email", 256)?;
        usage.account_organization = bounded(identity.organization, "identity.organization", 256)?;
        usage.login_method = bounded(identity.login_method, "identity.loginMethod", 256)?;
        let _ = bounded(identity.account_id, "identity.accountID", 256)?;
    }
    let mut result = ProviderFetchResult::new(usage, "plugin");
    if let Some(cost) = cost {
        if !cost.used.is_finite()
            || cost.limit.is_some_and(|value| !value.is_finite())
            || cost.balance.is_some_and(|value| !value.is_finite())
            || cost
                .next_regen_amount
                .is_some_and(|value| !value.is_finite())
            || cost.currency.len() != 3
            || !cost.currency.bytes().all(|byte| byte.is_ascii_uppercase())
        {
            return Err(PluginError::InvalidSnapshot(
                "cost values or currency are invalid".to_string(),
            ));
        }
        let mut mapped = CostSnapshot::new(cost.used, cost.currency, cost.period);
        if let Some(limit) = cost.limit {
            mapped = mapped.with_limit(limit);
        }
        if let Some(balance) = cost.balance {
            mapped = mapped.with_balance(balance);
        }
        if let Some(resets_at) = cost.resets_at {
            mapped = mapped.with_resets_at(resets_at);
        }
        result = result.with_cost(mapped);
    }
    Ok(result)
}

fn bounded(value: Option<String>, label: &str, maximum: usize) -> PluginResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.len() > maximum {
        return Err(PluginError::InvalidSnapshot(format!(
            "{label} exceeds {maximum} bytes"
        )));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::plugins::approval::PluginApprovalBinding;
    use crate::plugins::loader::load_plugin;

    const SHARED_BASIC_TS: &str = include_str!("../../../../../shared/fixtures/plugins/basic.ts");
    const SHARED_BASIC_EXPECTED: &str =
        include_str!("../../../../../shared/fixtures/plugins/basic.expected.json");
    const SHARED_TIMEOUT: &str = include_str!("../../../../../shared/fixtures/plugins/timeout.js");

    fn fixture(source: &str) -> (tempfile::TempDir, LoadedPlugin) {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("fixture.js");
        fs::write(&path, source).unwrap();
        let plugin = load_plugin(&path).unwrap();
        (temporary, plugin)
    }

    #[test]
    fn executes_async_plugin_in_quickjs() {
        let (_temporary, plugin) = fixture(
            r#"defineProvider({
              id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"], settings: [],
              async fetchUsage(ctx) {
                await Promise.resolve();
                return { primary: { usedPercent: ctx.pct(2, 8), windowMinutes: 300 }, identity: { loginMethod: "Fixture" } };
              }
            });"#,
        );
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let result = execute_sync(plugin, context, binding).unwrap();
        assert_eq!(result.usage.primary.used_percent, 25.0);
        assert_eq!(result.usage.login_method.as_deref(), Some("Fixture"));
    }

    #[test]
    fn accepts_cost_only_snapshot_like_shared_billing_plugins() {
        let (_temporary, plugin) = fixture(
            r#"defineProvider({
              id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"], settings: [],
              async fetchUsage() {
                return { cost: { used: 12.5, currency: "USD", period: "Today" }, details: [{ rows: [{ label: "Requests", value: "42" }] }] };
              }
            });"#,
        );
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let result = execute_sync(plugin, context, binding).unwrap();
        assert!(result.usage.primary.is_informational);
        assert_eq!(result.cost.as_ref().unwrap().used, 12.5);
    }

    #[test]
    fn accepts_nested_and_inline_extra_windows() {
        let (_temporary, plugin) = fixture(
            r#"defineProvider({
              id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"], settings: [],
              async fetchUsage() {
                return { extraWindows: [
                  { id: "inline", title: "Inline", usedPercent: 25 },
                  { id: "nested", title: "Nested", window: { usedPercent: 50 } }
                ] };
              }
            });"#,
        );
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let result = execute_sync(plugin, context, binding).unwrap();
        assert_eq!(result.usage.primary.used_percent, 25.0);
        assert_eq!(result.usage.extra_rate_windows.len(), 2);
        assert_eq!(result.usage.extra_rate_windows[1].window.used_percent, 50.0);
    }

    #[test]
    fn shared_typescript_golden_fixture_matches_native_snapshot() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("basic.ts");
        fs::write(&path, SHARED_BASIC_TS).unwrap();
        let plugin = load_plugin(&path).unwrap();
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let result = execute_sync(plugin.clone(), context, binding).unwrap();
        let expected: JsonValue = serde_json::from_str(SHARED_BASIC_EXPECTED).unwrap();
        assert_eq!(plugin.manifest.id, expected["providerId"]);
        assert_eq!(
            result.usage.primary.used_percent,
            expected["primaryUsedPercent"]
        );
        assert_eq!(
            result.usage.secondary.as_ref().unwrap().used_percent,
            expected["secondaryUsedPercent"]
        );
        assert_eq!(
            result.usage.login_method.as_deref(),
            expected["loginMethod"].as_str()
        );
        let cost = result.cost.as_ref().unwrap();
        assert_eq!(cost.used, expected["cost"]["used"]);
        assert_eq!(cost.limit, expected["cost"]["limit"].as_f64());
        assert_eq!(cost.currency_code, expected["cost"]["currency"]);
        assert_eq!(cost.balance, expected["cost"]["balance"].as_f64());
    }

    #[test]
    fn shared_timeout_fixture_is_interrupted() {
        let (_temporary, plugin) = fixture(SHARED_TIMEOUT);
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let started = Instant::now();
        let error = execute_sync(plugin, context, binding).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(matches!(
            error,
            PluginError::TimedOut | PluginError::Script(_)
        ));
    }

    #[test]
    fn undeclared_origin_fails_closed() {
        let (_temporary, plugin) = fixture(
            r#"defineProvider({
              id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"], settings: [],
              async fetchUsage(ctx) {
                await ctx.http.getJSON("https://evil.example/v1/usage");
                return { primary: { usedPercent: 1 } };
              }
            });"#,
        );
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let error = execute_sync(plugin, context, binding).unwrap_err();
        assert!(error.to_string().contains("not declared"));
    }

    #[test]
    fn browser_cookie_access_requires_broker_value() {
        let (_temporary, plugin) = fixture(
            r#"defineProvider({
              id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"], settings: [],
              capabilities: ["browser-cookies"], cookieDomains: ["example.com"],
              async fetchUsage(ctx) {
                await ctx.browser.cookieHeader("example.com");
                return { primary: { usedPercent: 1 } };
              }
            });"#,
        );
        let context = PluginExecutionContext::default();
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let error = execute_sync(plugin, context, binding).unwrap_err();
        assert!(error.to_string().contains("interactive authorization"));
    }

    #[test]
    fn redacts_secret_from_plugin_error() {
        let (_temporary, plugin) = fixture(
            r#"defineProvider({
              id: "fixture-provider", name: "Fixture", endpoints: ["https://api.example.com"],
              auth: { type: "bearer", secret: "API_KEY" },
              settings: [{ key: "API_KEY", title: "API key", type: "secure" }],
              async fetchUsage(ctx) { throw new Error(`failed ${ctx.settings.getSecret("API_KEY")}`); }
            });"#,
        );
        let mut context = PluginExecutionContext::default();
        context
            .secrets
            .insert("API_KEY".into(), "super-secret".into());
        let binding = PluginApprovalBinding::new(&plugin, &context.settings).unwrap();
        let error = execute_sync(plugin, context, binding).unwrap_err();
        assert!(!error.to_string().contains("super-secret"));
    }

    #[test]
    fn daily_reset_uses_iana_timezone_without_javascript_intl() {
        let reset = next_daily_reset("America/Chicago", 0).unwrap();
        assert!(reset > Utc::now().timestamp_millis());
    }
}
