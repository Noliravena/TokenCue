//! ClawRouter usage and monthly budget provider.
//!
//! ClawRouterUsageFetcher implementation.

use async_trait::async_trait;
use chrono::{TimeZone, Utc};
use reqwest::{Client, Url};
use serde::Deserialize;

use crate::core::{
    CostSnapshot, FetchContext, Provider, ProviderError, ProviderFetchResult, ProviderId,
    ProviderMetadata, RateWindow, SourceMode, UsageSnapshot,
};

const CREDENTIAL_TARGET: &str = "tokencue-clawrouter";
const ENV_KEYS: &[&str] = &["CLAWROUTER_API_KEY"];
const BASE_URL_ENV: &str = "CLAWROUTER_BASE_URL";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    budget: Budget,
    usage: Usage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Budget {
    configured: bool,
    ledger: String,
    window_key: Option<String>,
    limit_micros: Option<i64>,
    spent_micros: Option<i64>,
    remaining_micros: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct Usage {
    summary: Summary,
    #[serde(default)]
    providers: Vec<RoutedProvider>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    request_count: u64,
    success_count: u64,
    error_count: u64,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    actual_cost_micros: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoutedProvider {
    provider: String,
    request_count: u64,
    total_tokens: u64,
    actual_cost_micros: i64,
}

pub struct ClawRouterProvider {
    metadata: ProviderMetadata,
    client: Client,
}

impl ClawRouterProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::ClawRouter,
                display_name: "ClawRouter",
                session_label: "Monthly budget",
                weekly_label: "Monthly budget",
                supports_opus: false,
                supports_credits: true,
                default_enabled: false,
                is_primary: false,
                dashboard_url: None,
                status_page_url: None,
            },
            client: crate::core::credentialed_http_client_builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    fn endpoint(ctx: &FetchContext) -> Result<Url, ProviderError> {
        let raw = ctx
            .workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| std::env::var(BASE_URL_ENV).ok())
            .unwrap_or_else(|| "https://clawrouter.openclaw.ai".to_string());
        let mut url = crate::providers::validated_https_url(&raw, "ClawRouter")?;
        if !url.path().trim_matches('/').ends_with("v1") {
            url = url
                .join("v1/")
                .map_err(|error| ProviderError::Other(error.to_string()))?;
        }
        url.join("usage")
            .map_err(|error| ProviderError::Other(format!("Invalid ClawRouter usage URL: {error}")))
    }

    fn dollars(micros: i64) -> f64 {
        micros as f64 / 1_000_000.0
    }

    fn next_reset(window_key: Option<&str>) -> Option<chrono::DateTime<Utc>> {
        let suffix = window_key?.rsplit('/').next()?;
        let (year, month) = suffix.split_once('-')?;
        let year: i32 = year.parse().ok()?;
        let month: u32 = month.parse().ok()?;
        if !(1..=12).contains(&month) {
            return None;
        }
        let (next_year, next_month) = if month == 12 {
            (year + 1, 1)
        } else {
            (year, month + 1)
        };
        Utc.with_ymd_and_hms(next_year, next_month, 1, 0, 0, 0)
            .single()
    }

    fn parse(body: &str) -> Result<ProviderFetchResult, ProviderError> {
        let response: Response = serde_json::from_str(body).map_err(|error| {
            ProviderError::Parse(format!("Could not parse ClawRouter usage: {error}"))
        })?;
        let limit = response.budget.limit_micros.map(Self::dollars);
        let spent = response.budget.spent_micros.map(Self::dollars);
        let remaining = response.budget.remaining_micros.map(Self::dollars);
        let resets_at = Self::next_reset(response.budget.window_key.as_deref());
        let primary = match (spent, limit) {
            (Some(spent), Some(limit)) if limit > 0.0 => RateWindow::with_details(
                spent / limit * 100.0,
                RateWindow::monthly_window_minutes(resets_at),
                resets_at,
                Some(format!(
                    "${spent:.6} / ${limit:.2} · ${:.6} remaining",
                    remaining.unwrap_or_default()
                )),
            ),
            _ => RateWindow::informational(format!(
                "{} requests · {} tokens · ${:.6}",
                response.usage.summary.request_count,
                response.usage.summary.total_tokens,
                Self::dollars(response.usage.summary.actual_cost_micros)
            )),
        };
        let mut usage = UsageSnapshot::new(primary)
            .with_login_method(if response.budget.configured {
                "Managed monthly budget"
            } else {
                "Unmetered"
            })
            .with_organization(format!(
                "{} routed providers",
                response.usage.providers.len()
            ));
        usage = usage.with_extra_rate_window(
            "requests",
            "Requests",
            RateWindow::informational(format!(
                "{} succeeded · {} failed · {} input / {} output tokens",
                response.usage.summary.success_count,
                response.usage.summary.error_count,
                response.usage.summary.input_tokens,
                response.usage.summary.output_tokens
            )),
        );
        for routed in response.usage.providers.iter().take(20) {
            usage = usage.with_extra_rate_window(
                format!("provider-{}", routed.provider),
                routed.provider.clone(),
                RateWindow::informational(format!(
                    "{} requests · {} tokens · ${:.6}",
                    routed.request_count,
                    routed.total_tokens,
                    Self::dollars(routed.actual_cost_micros)
                )),
            );
        }
        let mut result = ProviderFetchResult::new(usage, "api");
        if let (Some(spent), Some(limit)) = (spent, limit) {
            let mut cost =
                CostSnapshot::new(spent, "USD", response.budget.ledger).with_limit(limit);
            if let Some(reset) = resets_at {
                cost = cost.with_resets_at(reset);
            }
            result = result.with_cost(cost);
        } else if response.usage.summary.actual_cost_micros > 0 {
            result = result.with_cost(CostSnapshot::new(
                Self::dollars(response.usage.summary.actual_cost_micros),
                "USD",
                "This month",
            ));
        }
        Ok(result)
    }
}

impl Default for ClawRouterProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for ClawRouterProvider {
    fn id(&self) -> ProviderId {
        ProviderId::ClawRouter
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
            .get(Self::endpoint(ctx)?)
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
                "ClawRouter API returned HTTP {status}"
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
    fn parses_budget_and_micros() {
        let result = ClawRouterProvider::parse(r#"{
          "budget":{"configured":true,"ledger":"2026-08","windowKey":"budget/2026-08","limitMicros":100000000,"spentMicros":25000000,"remainingMicros":75000000},
          "usage":{"summary":{"requestCount":10,"successCount":9,"errorCount":1,"inputTokens":1000,"outputTokens":500,"totalTokens":1500,"actualCostMicros":2400000},"providers":[{"provider":"anthropic","requestCount":6,"successCount":6,"errorCount":0,"totalTokens":900,"actualCostMicros":1800000}]}
        }"#).unwrap();
        assert!((result.usage.primary.used_percent - 25.0).abs() < f64::EPSILON);
        assert_eq!(result.cost.unwrap().used, 25.0);
    }

    #[test]
    fn rejects_malformed_payload() {
        assert!(ClawRouterProvider::parse("{}").is_err());
    }
}
