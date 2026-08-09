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
const DAILY_HISTORY_PROVIDERS: [&str; 2] = ["codex", "claude"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSpendRow {
    pub provider_id: String,
    pub display_name: String,
    pub seven_day: Option<f64>,
    pub thirty_day: Option<f64>,
    pub currency: String,
    pub source: String,
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

    // Local JSONL scanners for Codex / Claude (primary spend sources). Do not
    // manufacture zero-dollar rows when the corresponding logs do not exist.
    for (provider_id, history) in &local_daily {
        if !history.has_data {
            continue;
        }
        let display_name = match *provider_id {
            "codex" => "Codex",
            "claude" => "Claude",
            _ => continue,
        };
        rows.push(UsageSpendRow {
            provider_id: (*provider_id).into(),
            display_name: display_name.into(),
            seven_day: Some(period_total(history, 7)),
            thirty_day: Some(period_total(history, LOCAL_SUMMARY_DAYS as usize)),
            currency: "USD".into(),
            source: "local logs".into(),
        });
    }

    // Surface any other provider cost snapshots from the last refresh (period
    // costs, not calendar 7d/30d — shown under thirty_day only).
    for snapshot in cached {
        if snapshot.provider_id == "codex" || snapshot.provider_id == "claude" {
            continue;
        }
        let Some(cost) = &snapshot.cost else {
            continue;
        };
        rows.push(UsageSpendRow {
            provider_id: snapshot.provider_id.clone(),
            display_name: if snapshot.display_name.is_empty() {
                snapshot.provider_id.clone()
            } else {
                snapshot.display_name.clone()
            },
            seven_day: None,
            thirty_day: Some(cost.used),
            currency: cost.currency_code.clone(),
            source: format!("period ({})", cost.period),
        });
    }

    let daily = merge_daily_histories(&local_daily);
    // Available histories are seeded through today, so the last point is
    // today's measured value. With no observed records, the series is empty.
    let today = daily.last().map(|point| point.value);

    UsageSpendSummary { rows, today, daily }
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
}
