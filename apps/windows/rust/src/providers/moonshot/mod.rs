//! Moonshot / Kimi Open Platform balance provider.
//!
//! MoonshotUsageFetcher implementation.

use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use crate::core::{
    CostSnapshot, FetchContext, Provider, ProviderError, ProviderFetchResult, ProviderId,
    ProviderMetadata, RateWindow, SourceMode, UsageSnapshot,
};

const CREDENTIAL_TARGET: &str = "tokencue-moonshot";
const ENV_KEYS: &[&str] = &["MOONSHOT_API_KEY", "KIMI_API_KEY"];

#[derive(Debug, Deserialize)]
struct BalanceResponse {
    code: i64,
    status: bool,
    #[serde(default)]
    scode: String,
    data: BalanceData,
}

#[derive(Debug, Deserialize, PartialEq)]
struct BalanceData {
    available_balance: f64,
    voucher_balance: f64,
    cash_balance: f64,
}

pub struct MoonshotProvider {
    metadata: ProviderMetadata,
    client: Client,
}

impl MoonshotProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::Moonshot,
                display_name: "Moonshot / Kimi Open Platform",
                session_label: "Balance",
                weekly_label: "Balance",
                supports_opus: false,
                supports_credits: false,
                default_enabled: false,
                is_primary: false,
                dashboard_url: Some("https://platform.moonshot.ai/console/account"),
                status_page_url: None,
            },
            client: crate::core::credentialed_http_client_builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    fn balance_url(ctx: &FetchContext) -> &'static str {
        match ctx.api_region.as_deref().map(str::trim) {
            Some("china") | Some("cn") => "https://api.moonshot.cn/v1/users/me/balance",
            _ => "https://api.moonshot.ai/v1/users/me/balance",
        }
    }

    fn parse(body: &str) -> Result<BalanceData, ProviderError> {
        let response: BalanceResponse = serde_json::from_str(body).map_err(|error| {
            ProviderError::Parse(format!("Failed to parse Moonshot balance: {error}"))
        })?;
        if response.code != 0 || !response.status {
            return Err(ProviderError::Other(format!(
                "Moonshot API error: code {}, scode {}",
                response.code, response.scode
            )));
        }
        Ok(response.data)
    }

    fn snapshot(data: &BalanceData) -> ProviderFetchResult {
        let balance = data.available_balance.max(0.0);
        let detail = if data.cash_balance < 0.0 {
            format!(
                "Balance: ${balance:.2} · ${:.2} in deficit",
                data.cash_balance.abs()
            )
        } else {
            format!("Balance: ${balance:.2}")
        };
        ProviderFetchResult::new(
            UsageSnapshot::new(RateWindow::informational(detail.clone())).with_login_method(detail),
            "api",
        )
        .with_cost(CostSnapshot::new(0.0, "USD", "Balance").with_balance(balance))
    }
}

impl Default for MoonshotProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for MoonshotProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Moonshot
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
            .get(Self::balance_url(ctx))
            .bearer_auth(key.trim())
            .header("Accept", "application/json")
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(ProviderError::AuthRequired);
        }
        if !status.is_success() {
            return Err(ProviderError::Other(format!(
                "Moonshot API error: HTTP {status}"
            )));
        }
        let body = response.text().await?;
        Ok(Self::snapshot(&Self::parse(&body)?))
    }

    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::OAuth]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_balance_and_preserves_deficit() {
        let data = MoonshotProvider::parse(r#"{"code":0,"status":true,"scode":"0","data":{"available_balance":18.5,"voucher_balance":4.0,"cash_balance":-1.25}}"#).unwrap();
        assert_eq!(data.available_balance, 18.5);
        let result = MoonshotProvider::snapshot(&data);
        assert_eq!(result.cost.unwrap().balance, Some(18.5));
        assert!(result.usage.login_method.unwrap().contains("in deficit"));
    }

    #[test]
    fn rejects_api_level_error() {
        let error = MoonshotProvider::parse(r#"{"code":7,"status":false,"scode":"invalid","data":{"available_balance":0,"voucher_balance":0,"cash_balance":0}}"#).unwrap_err();
        assert!(error.to_string().contains("scode invalid"));
    }
}
