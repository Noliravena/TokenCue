//! Grok CLI local-log cost estimation.
//!
//! Grok's consumer billing RPC exposes quota percentage, not a dollar total.
//! Grok CLI 1.0 writes one `shell.turn.inference_done` record per inference to
//! `~/.grok/logs/unified.jsonl`, including prompt, cached-prompt, and completion
//! token counts. Price those records with the public Grok 4.5 rate card so the
//! Spend and History surfaces can show a USD estimate without converting the
//! consumer quota percentage into money.

use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::cost_scanner::{CostSummary, ModelTokenCounts};

const GROK_MODEL: &str = "grok-4.5";
const LONG_CONTEXT_THRESHOLD: u64 = 200_000;
const TOKENS_PER_MILLION: f64 = 1_000_000.0;

#[derive(Debug, Deserialize)]
struct GrokLogRecord {
    ts: DateTime<Utc>,
    #[serde(default)]
    src: String,
    #[serde(default)]
    msg: String,
    #[serde(default)]
    sid: Option<String>,
    #[serde(default)]
    ctx: Option<GrokUsageContext>,
}

#[derive(Debug, Default, Deserialize)]
struct GrokUsageContext {
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    cached_prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
    // Grok reports reasoning as a subset of completion tokens. Keep the field
    // for schema compatibility but never add it a second time.
    #[serde(default, rename = "reasoning_tokens")]
    _reasoning_tokens: u64,
}

#[derive(Debug, Default)]
pub(crate) struct GrokCostScan {
    pub summary: CostSummary,
    pub daily_costs: HashMap<String, f64>,
    pub has_data: bool,
}

pub(crate) fn default_log_path() -> PathBuf {
    if let Ok(root) = std::env::var("GROK_HOME")
        && !root.trim().is_empty()
    {
        return PathBuf::from(root).join("logs").join("unified.jsonl");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".grok")
        .join("logs")
        .join("unified.jsonl")
}

pub(crate) fn scan_default_log(days: u32, cancel: Option<&AtomicBool>) -> GrokCostScan {
    scan_log(&default_log_path(), days, Local::now().date_naive(), cancel)
}

fn grok_45_cost_usd(prompt_tokens: u64, cached_prompt_tokens: u64, output_tokens: u64) -> f64 {
    let cached = cached_prompt_tokens.min(prompt_tokens);
    let uncached = prompt_tokens.saturating_sub(cached);
    let long_context = prompt_tokens >= LONG_CONTEXT_THRESHOLD;
    let (input_rate, cached_rate, output_rate) = if long_context {
        (4.0, 0.60, 12.0)
    } else {
        (2.0, 0.30, 6.0)
    };
    ((uncached as f64) * input_rate
        + (cached as f64) * cached_rate
        + (output_tokens as f64) * output_rate)
        / TOKENS_PER_MILLION
}

fn scan_log(path: &Path, days: u32, today: NaiveDate, cancel: Option<&AtomicBool>) -> GrokCostScan {
    let start = today - Duration::days(days.saturating_sub(1) as i64);
    let mut result = GrokCostScan::default();
    result.summary.period_start = Some(start);
    result.summary.period_end = Some(today);

    let Ok(file) = File::open(path) else {
        return result;
    };
    let mut sessions = HashSet::new();

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            break;
        }
        if !line.contains("shell.turn.inference_done") {
            continue;
        }
        let Ok(record) = serde_json::from_str::<GrokLogRecord>(&line) else {
            continue;
        };
        if record.src != "shell" || record.msg != "shell.turn.inference_done" {
            continue;
        }
        let Some(tokens) = record.ctx else {
            continue;
        };
        if tokens.prompt_tokens == 0 && tokens.completion_tokens == 0 {
            continue;
        }
        let day = record.ts.with_timezone(&Local).date_naive();
        if day < start || day > today {
            continue;
        }

        let cost = grok_45_cost_usd(
            tokens.prompt_tokens,
            tokens.cached_prompt_tokens,
            tokens.completion_tokens,
        );
        let day_key = day.format("%Y-%m-%d").to_string();
        *result.daily_costs.entry(day_key).or_insert(0.0) += cost;
        result.summary.total_cost_usd += cost;
        result.summary.input_tokens = result
            .summary
            .input_tokens
            .saturating_add(tokens.prompt_tokens);
        result.summary.cached_tokens = result
            .summary
            .cached_tokens
            .saturating_add(tokens.cached_prompt_tokens.min(tokens.prompt_tokens));
        result.summary.output_tokens = result
            .summary
            .output_tokens
            .saturating_add(tokens.completion_tokens);
        *result
            .summary
            .by_model
            .entry(GROK_MODEL.to_string())
            .or_insert(0.0) += cost;
        let model_tokens = result
            .summary
            .by_model_tokens
            .entry(GROK_MODEL.to_string())
            .or_insert_with(ModelTokenCounts::default);
        model_tokens.input_tokens = model_tokens
            .input_tokens
            .saturating_add(tokens.prompt_tokens);
        model_tokens.cached_tokens = model_tokens
            .cached_tokens
            .saturating_add(tokens.cached_prompt_tokens.min(tokens.prompt_tokens));
        model_tokens.output_tokens = model_tokens
            .output_tokens
            .saturating_add(tokens.completion_tokens);
        if let Some(session_id) = record.sid.filter(|value| !value.is_empty()) {
            sessions.insert(session_id);
        }
        result.has_data = true;
    }

    result.summary.sessions_count = sessions.len().min(u32::MAX as usize) as u32;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn prices_short_and_long_context_with_cached_input() {
        // 100k prompt (25k cached) + 10k output at short-context rates.
        let short = grok_45_cost_usd(100_000, 25_000, 10_000);
        assert!((short - 0.2175).abs() < 1e-9);

        // 200k prompt crosses the published long-context threshold.
        let long = grok_45_cost_usd(200_000, 50_000, 10_000);
        assert!((long - 0.75).abs() < 1e-9);
    }

    #[test]
    fn scans_inference_records_into_daily_usd_without_double_counting_reasoning() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("unified.jsonl");
        let mut file = File::create(&path).expect("create log");
        writeln!(
            file,
            r#"{{"ts":"2026-08-09T10:00:00Z","src":"shell","ver":"1.0.0","sid":"session-a","msg":"shell.turn.inference_done","ctx":{{"prompt_tokens":100000,"cached_prompt_tokens":25000,"completion_tokens":10000,"reasoning_tokens":9000}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":"2026-08-10T10:00:00Z","src":"shell","ver":"1.0.0","sid":"session-b","msg":"shell.turn.inference_done","ctx":{{"prompt_tokens":200000,"cached_prompt_tokens":50000,"completion_tokens":10000,"reasoning_tokens":9000}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":"2026-08-10T11:00:00Z","src":"shell","msg":"unrelated","ctx":{{"prompt_tokens":999999}}}}"#
        )
        .unwrap();

        let scan = scan_log(
            &path,
            30,
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
            None,
        );
        assert!(scan.has_data);
        assert_eq!(scan.summary.sessions_count, 2);
        assert_eq!(scan.summary.input_tokens, 300_000);
        assert_eq!(scan.summary.cached_tokens, 75_000);
        assert_eq!(scan.summary.output_tokens, 20_000);
        assert!((scan.summary.total_cost_usd - 0.9675).abs() < 1e-9);
        assert!((scan.daily_costs["2026-08-09"] - 0.2175).abs() < 1e-9);
        assert!((scan.daily_costs["2026-08-10"] - 0.75).abs() < 1e-9);
    }
}
