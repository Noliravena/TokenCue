//! Synthetic quota provider.
//!
//! Tolerant quota parsing for the three known lanes: rolling five-hour,
//! weekly token, and search hourly.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde_json::Value;

use crate::core::{
    CostSnapshot, FetchContext, Provider, ProviderError, ProviderFetchResult, ProviderId,
    ProviderMetadata, RateWindow, SourceMode, UsageSnapshot,
};

const API_URL: &str = "https://api.synthetic.new/v2/quotas";
const CREDENTIAL_TARGET: &str = "tokencue-synthetic";
const ENV_KEYS: &[&str] = &["SYNTHETIC_API_KEY"];

#[derive(Debug, Clone)]
struct Quota {
    label: String,
    used_percent: f64,
    window_minutes: Option<u32>,
    resets_at: Option<DateTime<Utc>>,
    cost: Option<(f64, f64)>,
}

pub struct SyntheticProvider {
    metadata: ProviderMetadata,
    client: Client,
}

impl SyntheticProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::Synthetic,
                display_name: "Synthetic",
                session_label: "5 hour limit",
                weekly_label: "Weekly limit",
                supports_opus: false,
                supports_credits: true,
                default_enabled: false,
                is_primary: false,
                dashboard_url: Some("https://synthetic.new/settings/usage"),
                status_page_url: None,
            },
            client: crate::core::credentialed_http_client_builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    fn number(value: Option<&Value>) -> Option<f64> {
        value.and_then(|value| {
            value.as_f64().or_else(|| {
                value
                    .as_str()?
                    .trim()
                    .trim_start_matches('$')
                    .replace(',', "")
                    .parse()
                    .ok()
            })
        })
    }

    fn first_number(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f64> {
        keys.iter().find_map(|key| Self::number(object.get(*key)))
    }

    fn first_string(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
        keys.iter().find_map(|key| {
            object
                .get(*key)?
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
    }

    fn timestamp(value: Option<&Value>) -> Option<DateTime<Utc>> {
        let value = value?;
        if let Some(number) = Self::number(Some(value)) {
            let seconds = if number > 1_000_000_000_000.0 {
                number / 1000.0
            } else {
                number
            };
            if seconds > 1_000_000_000.0 {
                return DateTime::from_timestamp(seconds as i64, 0);
            }
        }
        DateTime::parse_from_rfc3339(value.as_str()?)
            .ok()
            .map(|date| date.with_timezone(&Utc))
    }

    fn window_minutes(object: &serde_json::Map<String, Value>) -> Option<u32> {
        if let Some(minutes) = Self::first_number(
            object,
            &[
                "windowMinutes",
                "window_minutes",
                "periodMinutes",
                "period_minutes",
            ],
        ) {
            return Some(minutes.round().max(0.0) as u32);
        }
        if let Some(hours) = Self::first_number(
            object,
            &["windowHours", "window_hours", "periodHours", "period_hours"],
        ) {
            return Some((hours * 60.0).round().max(0.0) as u32);
        }
        if let Some(days) = Self::first_number(
            object,
            &["windowDays", "window_days", "periodDays", "period_days"],
        ) {
            return Some((days * 1440.0).round().max(0.0) as u32);
        }
        let text = Self::first_string(
            object,
            &[
                "window",
                "windowLabel",
                "window_label",
                "period",
                "periodLabel",
                "period_label",
            ],
        )?
        .to_ascii_lowercase()
        .replace(' ', "");
        for (suffix, multiplier) in [
            ("minutes", 1.0),
            ("minute", 1.0),
            ("mins", 1.0),
            ("min", 1.0),
            ("hours", 60.0),
            ("hour", 60.0),
            ("hrs", 60.0),
            ("hr", 60.0),
            ("days", 1440.0),
            ("day", 1440.0),
            ("m", 1.0),
            ("h", 60.0),
            ("d", 1440.0),
        ] {
            if let Some(raw) = text.strip_suffix(suffix)
                && let Ok(value) = raw.parse::<f64>()
            {
                return Some((value * multiplier).round().max(0.0) as u32);
            }
        }
        None
    }

    fn quota(value: &Value, fallback_label: &str) -> Option<Quota> {
        let object = value.as_object()?;
        let percent_used = Self::first_number(
            object,
            &[
                "percentUsed",
                "usedPercent",
                "usagePercent",
                "usage_percent",
                "used_percent",
                "percent_used",
                "percent",
            ],
        )
        .map(|value| if value <= 1.0 { value * 100.0 } else { value });
        let percent_remaining = Self::first_number(
            object,
            &[
                "percentRemaining",
                "remainingPercent",
                "remaining_percent",
                "percent_remaining",
            ],
        )
        .map(|value| if value <= 1.0 { value * 100.0 } else { value });
        let limit = Self::first_number(
            object,
            &[
                "limit",
                "messageLimit",
                "message_limit",
                "maxRequests",
                "max_requests",
                "quota",
                "max",
                "total",
                "capacity",
                "allowance",
            ],
        );
        let used = Self::first_number(
            object,
            &[
                "used",
                "usage",
                "usedMessages",
                "used_messages",
                "requests",
                "requestCount",
                "request_count",
                "consumed",
                "spent",
            ],
        );
        let remaining = Self::first_number(object, &["remaining", "left", "available", "balance"]);
        let used_percent = percent_used
            .or_else(|| percent_remaining.map(|remaining| 100.0 - remaining))
            .or_else(|| match (limit, used, remaining) {
                (Some(limit), Some(used), _) if limit > 0.0 => Some(used / limit * 100.0),
                (None, Some(used), Some(remaining)) if used + remaining > 0.0 => {
                    Some(used / (used + remaining) * 100.0)
                }
                _ => None,
            })?;
        let resets_at = [
            "resetAt",
            "reset_at",
            "resetsAt",
            "resets_at",
            "renewAt",
            "renew_at",
            "nextTickAt",
            "next_tick_at",
            "periodEnd",
            "period_end",
            "expiresAt",
            "expires_at",
        ]
        .iter()
        .find_map(|key| Self::timestamp(object.get(*key)));
        let cost_limit = Self::first_number(object, &["maxCredits", "max_credits"]);
        let cost_used =
            Self::first_number(object, &["usedCredits", "used_credits"]).or_else(|| {
                match (
                    cost_limit,
                    Self::first_number(object, &["remainingCredits", "remaining_credits"]),
                ) {
                    (Some(limit), Some(remaining)) => Some((limit - remaining).max(0.0)),
                    _ => None,
                }
            });
        Some(Quota {
            label: Self::first_string(
                object,
                &["name", "label", "type", "period", "scope", "title", "id"],
            )
            .unwrap_or_else(|| fallback_label.to_string()),
            used_percent: used_percent.clamp(0.0, 100.0),
            window_minutes: Self::window_minutes(object),
            resets_at,
            cost: cost_limit.zip(cost_used).map(|(limit, used)| (used, limit)),
        })
    }

    fn find_generic(value: &Value, output: &mut Vec<Quota>) {
        match value {
            Value::Array(values) => values
                .iter()
                .for_each(|value| Self::find_generic(value, output)),
            Value::Object(object) => {
                if let Some(quota) = Self::quota(value, "Quota") {
                    output.push(quota);
                } else {
                    object
                        .values()
                        .for_each(|value| Self::find_generic(value, output));
                }
            }
            _ => {}
        }
    }

    fn parse(body: &str) -> Result<ProviderFetchResult, ProviderError> {
        let root: Value = serde_json::from_str(body).map_err(|error| {
            ProviderError::Parse(format!("Failed to parse Synthetic response: {error}"))
        })?;
        let data = root.get("data").unwrap_or(&root);
        let known = [
            ("rollingFiveHourLimit", "Rolling five-hour limit"),
            ("weeklyTokenLimit", "Weekly token limit"),
            ("search.hourly", "Search hourly"),
        ];
        let mut slots: Vec<Option<Quota>> = known
            .iter()
            .map(|(path, label)| {
                let value = if *path == "search.hourly" {
                    data.get("search").and_then(|value| value.get("hourly"))
                } else {
                    data.get(*path)
                };
                value.and_then(|value| Self::quota(value, label))
            })
            .collect();
        if slots.iter().all(Option::is_none) {
            let mut generic = Vec::new();
            Self::find_generic(data, &mut generic);
            if generic.is_empty() {
                return Err(ProviderError::Parse(
                    "Missing Synthetic quota data".to_string(),
                ));
            }
            slots = generic.into_iter().take(3).map(Some).collect();
        }
        while slots.len() < 3 {
            slots.push(None);
        }
        let rate = |quota: &Quota| {
            RateWindow::with_details(
                quota.used_percent,
                quota.window_minutes,
                quota.resets_at,
                None,
            )
        };
        let primary_quota = slots[0]
            .as_ref()
            .or_else(|| slots.iter().flatten().next())
            .ok_or_else(|| ProviderError::Parse("Missing Synthetic primary quota".to_string()))?;
        let mut usage = UsageSnapshot::new(rate(primary_quota));
        if let Some(quota) = slots[1].as_ref() {
            usage = usage.with_secondary(rate(quota));
        }
        if let Some(quota) = slots[2].as_ref() {
            usage = usage.with_tertiary(rate(quota));
        }
        let plan = root
            .get("plan")
            .or_else(|| root.get("planName"))
            .or_else(|| data.get("plan"))
            .and_then(Value::as_str);
        if let Some(plan) = plan {
            usage = usage.with_login_method(plan);
        }
        let mut result = ProviderFetchResult::new(usage, "api");
        if let Some((used, limit)) = slots.iter().flatten().find_map(|quota| quota.cost) {
            let mut cost = CostSnapshot::new(used, "USD", "Weekly").with_limit(limit);
            if let Some(reset) = slots.iter().flatten().find_map(|quota| quota.resets_at) {
                cost = cost.with_resets_at(reset);
            }
            result = result.with_cost(cost);
        }
        Ok(result)
    }
}

impl Default for SyntheticProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for SyntheticProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Synthetic
    }
    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }
    async fn fetch_usage(&self, ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        if !matches!(ctx.source_mode, SourceMode::Auto | SourceMode::OAuth) {
            return Err(ProviderError::UnsupportedSource(ctx.source_mode));
        }
        let key =
            crate::providers::resolve_api_key(ctx.api_key.as_deref(), CREDENTIAL_TARGET, ENV_KEYS)?;
        let response = self
            .client
            .get(API_URL)
            .bearer_auth(key)
            .header("Accept", "application/json")
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(ProviderError::AuthRequired);
        }
        if !status.is_success() {
            return Err(ProviderError::Other(format!(
                "Synthetic API error: HTTP {status}"
            )));
        }
        Self::parse(&response.text().await?)
    }
    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::OAuth]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_lanes_without_shifting() {
        let result = SyntheticProvider::parse(r#"{
          "planName":"Standard",
          "rollingFiveHourLimit":{"used":25,"limit":100,"window":"5h","resetAt":"2026-08-08T10:00:00Z"},
          "weeklyTokenLimit":{"remainingPercent":0.4,"windowDays":7,"maxCredits":40,"usedCredits":24},
          "search":{"hourly":{"usedPercent":12,"windowHours":1}}
        }"#).unwrap();
        assert_eq!(result.usage.primary.used_percent, 25.0);
        assert_eq!(result.usage.secondary.as_ref().unwrap().used_percent, 60.0);
        assert_eq!(
            result.usage.tertiary.as_ref().unwrap().window_minutes,
            Some(60)
        );
        assert_eq!(result.cost.unwrap().used, 24.0);
    }

    #[test]
    fn parses_generic_quota_array() {
        let result =
            SyntheticProvider::parse(r#"[{"name":"Daily","used":2,"remaining":8,"window":"1d"}]"#)
                .unwrap();
        assert_eq!(result.usage.primary.used_percent, 20.0);
        assert_eq!(result.usage.primary.window_minutes, Some(1440));
    }
}
