//! Usage & Spend settings tab: 7-day / 30-day local cost aggregates.

use serde::Serialize;
use tauri::State;
use tokencue::cost_scanner::{DailyCostHistory, get_daily_cost_history_with_availability};

use super::ProviderUsageSnapshot;
use crate::state::AppState;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Days of per-day history returned alongside the aggregates. The warm tray
/// "Spend" tab plots exactly this many bars.
const DAILY_HISTORY_DAYS: u32 = 14;
const LOCAL_SUMMARY_DAYS: u32 = 30;

/// Providers with a real per-day local breakdown (JSONL transcript scanners).
/// Everything else only reports a billing-period total, which cannot be
/// spread across calendar days without inventing numbers.
const DAILY_HISTORY_PROVIDERS: [&str; 3] = ["codex", "claude", "grok"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSpendRow {
    pub provider_id: String,
    pub display_name: String,
    pub seven_day: Option<f64>,
    pub thirty_day: Option<f64>,
    pub currency: String,
    pub source: String,
    /// Remaining provider balance when available. This must not be added to
    /// spend totals.
    pub balance: Option<f64>,
    /// Current provider billing-quota usage when the upstream service exposes
    /// a percentage but no monetary amount.
    pub usage_percent: Option<f64>,
    pub resets_at: Option<String>,
}

/// One calendar day of merged local spend, oldest first.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSpendDailyPoint {
    /// Local calendar day as `YYYY-MM-DD`.
    pub date: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSpendSummary {
    pub rows: Vec<UsageSpendRow>,
    /// Today's merged spend across the local scanners, or `None` when no
    /// provider has observed day-level data in the summary window.
    pub today: Option<f64>,
    /// Merged daily spend for the last `DAILY_HISTORY_DAYS` days, oldest
    /// first. Empty when no provider has observed day-level data in the
    /// summary window.
    pub daily: Vec<UsageSpendDailyPoint>,
}

#[tauri::command]
pub async fn get_usage_spend_summary(
    state: State<'_, Mutex<AppState>>,
) -> Result<UsageSpendSummary, String> {
    let cached = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.provider_cache.clone()
    };

    tauri::async_runtime::spawn_blocking(move || build_usage_spend_summary(&cached))
        .await
        .map_err(|e| format!("usage spend worker failed: {e}"))
}

fn build_usage_spend_summary(cached: &[ProviderUsageSnapshot]) -> UsageSpendSummary {
    let mut rows = Vec::new();
    let local_daily = load_daily_histories();

    // Local JSONL scanners for Codex / Claude / Grok (primary spend sources). Do not
    // manufacture zero-dollar rows when the corresponding logs do not exist.
    for (provider_id, history) in &local_daily {
        if !history.has_data {
            continue;
        }
        let display_name = match *provider_id {
            "codex" => "Codex",
            "claude" => "Claude",
            "grok" => "Grok",
            _ => continue,
        };
        rows.push(UsageSpendRow {
            provider_id: (*provider_id).into(),
            display_name: display_name.into(),
            seven_day: Some(period_total(history, 7)),
            thirty_day: Some(period_total(history, LOCAL_SUMMARY_DAYS as usize)),
            currency: "USD".into(),
            source: if *provider_id == "grok" {
                "local Grok CLI logs (estimated)".into()
            } else {
                "local logs".into()
            },
            balance: None,
            usage_percent: None,
            resets_at: None,
        });
    }

    // Surface every live provider snapshot not already covered by a real local
    // daily scanner. Period spend, balances, and quota percentages retain
    // distinct semantics in the row model.
    for snapshot in cached {
        // Prefer real day-level local logs, but fall back to a live provider
        // snapshot when those logs are unavailable (for example a fresh
        // install or an API-only Claude account).
        if local_daily
            .iter()
            .any(|(provider_id, history)| history.has_data && *provider_id == snapshot.provider_id)
        {
            continue;
        }
        if let Some(cost) = &snapshot.cost {
            rows.push(cost_snapshot_row(snapshot, cost));
        } else if let Some(row) = quota_snapshot_row(snapshot) {
            rows.push(row);
        }
    }

    let daily = merge_daily_histories(&local_daily);
    // Available histories are seeded through today, so the last point is
    // today's measured value. With no observed records, the series is empty.
    let today = daily.last().map(|point| point.value);

    UsageSpendSummary { rows, today, daily }
}

fn display_name(snapshot: &ProviderUsageSnapshot) -> String {
    if snapshot.display_name.is_empty() {
        snapshot.provider_id.clone()
    } else {
        snapshot.display_name.clone()
    }
}

/// Several providers expose a wallet/credit balance through the shared cost
/// bridge. Older implementations encoded that value in `used` or `limit`, so
/// recognize the period label and keep balances out of 7/30-day spend totals.
fn cost_snapshot_row(
    snapshot: &ProviderUsageSnapshot,
    cost: &super::CostSnapshotBridge,
) -> UsageSpendRow {
    let is_balance_only = cost.period.to_ascii_lowercase().contains("balance")
        || (cost.balance.is_some() && cost.used == 0.0 && cost.limit.is_none());
    let balance = if is_balance_only {
        cost.balance
            .or_else(|| (cost.used == 0.0).then_some(cost.limit).flatten())
            .or(Some(cost.used))
    } else {
        cost.balance
    }
    .filter(|value| value.is_finite() && *value >= 0.0);

    UsageSpendRow {
        provider_id: snapshot.provider_id.clone(),
        display_name: display_name(snapshot),
        seven_day: None,
        thirty_day: (!is_balance_only).then_some(cost.used),
        currency: cost.currency_code.clone(),
        source: if is_balance_only {
            format!("balance ({})", cost.period)
        } else {
            format!("period ({})", cost.period)
        },
        balance,
        usage_percent: None,
        resets_at: cost.resets_at.clone(),
    }
}

/// Providers without a monetary snapshot may still expose a genuine quota
/// percentage (for example Grok/SuperGrok). Include every numeric quota rather
/// than maintaining a provider allow-list, while excluding informational rows
/// whose 0% value is only a presentation placeholder.
fn quota_snapshot_row(snapshot: &ProviderUsageSnapshot) -> Option<UsageSpendRow> {
    // Grok's web RPC percentage is a consumer quota signal, not USD spend.
    // The Spend tab uses the Grok CLI token-log estimate above and must never
    // relabel the quota percentage as money.
    if snapshot.provider_id == "grok"
        || snapshot.error.is_some()
        || snapshot.primary.is_informational
        || !snapshot.primary.used_percent.is_finite()
    {
        return None;
    }

    Some(UsageSpendRow {
        provider_id: snapshot.provider_id.clone(),
        display_name: display_name(snapshot),
        seven_day: None,
        thirty_day: None,
        currency: String::new(),
        source: "provider quota".into(),
        balance: None,
        usage_percent: Some(snapshot.primary.used_percent.clamp(0.0, 100.0)),
        resets_at: snapshot.primary.resets_at.clone(),
    })
}

fn load_daily_histories() -> Vec<(&'static str, DailyCostHistory)> {
    DAILY_HISTORY_PROVIDERS
        .into_iter()
        .map(|provider| {
            (
                provider,
                get_daily_cost_history_with_availability(provider, LOCAL_SUMMARY_DAYS),
            )
        })
        .collect()
}

/// Merge only available per-provider scanners into one series, oldest first.
fn merge_daily_histories(histories: &[(&str, DailyCostHistory)]) -> Vec<UsageSpendDailyPoint> {
    let mut merged: BTreeMap<String, f64> = BTreeMap::new();
    for (_, history) in histories.iter().filter(|(_, history)| history.has_data) {
        let first = history
            .points
            .len()
            .saturating_sub(DAILY_HISTORY_DAYS as usize);
        for (date, cost) in &history.points[first..] {
            *merged.entry(date.clone()).or_insert(0.0) += cost;
        }
    }
    merged
        .into_iter()
        .map(|(date, value)| UsageSpendDailyPoint { date, value })
        .collect()
}

fn period_total(history: &DailyCostHistory, days: usize) -> f64 {
    history
        .points
        .iter()
        .rev()
        .take(days)
        .map(|(_, value)| value)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokencue::core::{
        ProviderFetchResult, ProviderId, ProviderMetadata, RateWindow, UsageSnapshot,
    };

    fn history(has_data: bool, values: &[(&str, f64)]) -> DailyCostHistory {
        DailyCostHistory {
            has_data,
            points: values
                .iter()
                .map(|(date, value)| ((*date).to_string(), *value))
                .collect(),
        }
    }

    #[test]
    fn unavailable_histories_do_not_turn_missing_data_into_zero_spend() {
        let histories = [(
            "codex",
            history(false, &[("2026-08-09", 0.0), ("2026-08-10", 0.0)]),
        )];

        assert!(merge_daily_histories(&histories).is_empty());
    }

    #[test]
    fn available_histories_merge_by_calendar_day_and_ignore_unavailable_series() {
        let histories = [
            (
                "codex",
                history(true, &[("2026-08-09", 1.25), ("2026-08-10", 2.0)]),
            ),
            (
                "claude",
                history(true, &[("2026-08-09", 0.75), ("2026-08-10", 3.0)]),
            ),
            (
                "missing",
                history(false, &[("2026-08-09", 100.0), ("2026-08-10", 100.0)]),
            ),
        ];

        assert_eq!(
            merge_daily_histories(&histories),
            vec![
                UsageSpendDailyPoint {
                    date: "2026-08-09".into(),
                    value: 2.0,
                },
                UsageSpendDailyPoint {
                    date: "2026-08-10".into(),
                    value: 5.0,
                },
            ]
        );
    }

    #[test]
    fn period_totals_use_the_requested_trailing_window() {
        let history = history(
            true,
            &[
                ("2026-08-07", 10.0),
                ("2026-08-08", 2.0),
                ("2026-08-09", 3.0),
            ],
        );

        assert_eq!(period_total(&history, 2), 5.0);
        assert_eq!(period_total(&history, 30), 15.0);
    }

    #[test]
    fn quota_without_cost_is_exposed_without_fabricating_currency_spend() {
        let resets = chrono::Utc::now() + chrono::Duration::days(12);
        let metadata = ProviderMetadata {
            id: ProviderId::Copilot,
            display_name: "GitHub Copilot",
            session_label: "Premium requests",
            weekly_label: "Chat",
            supports_opus: false,
            supports_credits: false,
            default_enabled: false,
            is_primary: false,
            dashboard_url: None,
            status_page_url: None,
        };
        let result = ProviderFetchResult::new(
            UsageSnapshot::new(RateWindow::with_details(37.5, None, Some(resets), None)),
            "api",
        );
        let snapshot =
            ProviderUsageSnapshot::from_fetch_result(ProviderId::Copilot, &metadata, &result);

        let row = quota_snapshot_row(&snapshot).expect("quota row");
        assert_eq!(row.provider_id, "copilot");
        assert_eq!(row.source, "provider quota");
        assert_eq!(row.usage_percent, Some(37.5));
        assert_eq!(row.seven_day, None);
        assert_eq!(row.thirty_day, None);
        assert_eq!(row.balance, None);
        assert!(row.currency.is_empty());
        assert_eq!(row.resets_at, Some(resets.to_rfc3339()));
    }

    #[test]
    fn grok_web_quota_is_not_exposed_as_spend() {
        let metadata = ProviderMetadata {
            id: ProviderId::Grok,
            display_name: "Grok",
            session_label: "Monthly",
            weekly_label: "On-demand",
            supports_opus: false,
            supports_credits: false,
            default_enabled: false,
            is_primary: false,
            dashboard_url: None,
            status_page_url: None,
        };
        let result =
            ProviderFetchResult::new(UsageSnapshot::new(RateWindow::new(37.5)), "grok-browser");
        let snapshot =
            ProviderUsageSnapshot::from_fetch_result(ProviderId::Grok, &metadata, &result);

        assert!(quota_snapshot_row(&snapshot).is_none());
    }

    #[test]
    fn balance_snapshot_is_not_counted_as_period_spend() {
        let metadata = ProviderMetadata {
            id: ProviderId::Moonshot,
            display_name: "Moonshot",
            session_label: "Balance",
            weekly_label: "",
            supports_opus: false,
            supports_credits: false,
            default_enabled: false,
            is_primary: false,
            dashboard_url: None,
            status_page_url: None,
        };
        let result = ProviderFetchResult::new(
            UsageSnapshot::new(RateWindow::informational("$12.50 remaining")),
            "api",
        )
        .with_cost(tokencue::core::CostSnapshot::new(0.0, "USD", "Credits").with_balance(12.5));
        let snapshot =
            ProviderUsageSnapshot::from_fetch_result(ProviderId::Moonshot, &metadata, &result);

        let row = cost_snapshot_row(&snapshot, snapshot.cost.as_ref().expect("cost"));
        assert_eq!(row.thirty_day, None);
        assert_eq!(row.balance, Some(12.5));
        assert_eq!(row.currency, "USD");
    }

    #[test]
    fn legacy_balance_encoded_in_used_is_normalized() {
        let metadata = ProviderMetadata {
            id: ProviderId::Devin,
            display_name: "Devin",
            session_label: "ACUs",
            weekly_label: "",
            supports_opus: false,
            supports_credits: true,
            default_enabled: false,
            is_primary: false,
            dashboard_url: None,
            status_page_url: None,
        };
        let result =
            ProviderFetchResult::new(UsageSnapshot::new(RateWindow::new(20.0)), "api").with_cost(
                tokencue::core::CostSnapshot::new(8.75, "USD", "Extra usage balance"),
            );
        let snapshot =
            ProviderUsageSnapshot::from_fetch_result(ProviderId::Devin, &metadata, &result);

        let row = cost_snapshot_row(&snapshot, snapshot.cost.as_ref().expect("cost"));
        assert_eq!(row.thirty_day, None);
        assert_eq!(row.balance, Some(8.75));
    }
}
