use super::*;

#[tauri::command]
pub fn get_app_info() -> AppInfoBridge {
    AppInfoBridge {
        name: "TokenCue".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_number: option_env!("BUILD_NUMBER").unwrap_or("dev").to_string(),
        tagline: "May your tokens never run out—keep agent limits in view.".to_string(),
    }
}

pub(super) fn open_url_in_browser(url: &str) -> Result<(), String> {
    let url = validate_external_url(url)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system_binary("rundll32.exe"))
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        std::process::Command::new(opener)
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
    }
    Ok(())
}

pub(crate) fn validate_external_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    if trimmed.len() > 2048 || trimmed.chars().any(char::is_control) {
        return Err("URL is invalid".to_string());
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http and https URLs can be opened".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    open_url_in_browser(&url)
}

#[cfg(target_os = "windows")]
fn windows_system_binary(name: &str) -> std::path::PathBuf {
    std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .map(|root| root.join("System32").join(name))
        .filter(|path| path.exists())
        .unwrap_or_else(|| std::path::PathBuf::from(name))
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Provider ordering, cookie source, region, credential detection,
// global shortcut capture, session/environment introspection, quick actions.
// ════════════════════════════════════════════════════════════════════════════════

/// Open a filesystem path in the OS file manager (Finder / Explorer /
/// xdg-open). Non-existent paths are rejected so the UI gets immediate
/// feedback instead of a silent no-op shell launch.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }
    let pb = std::path::PathBuf::from(trimmed);
    if !pb.is_absolute() {
        return Err("Path must be absolute".into());
    }
    if !pb.exists() {
        return Err(format!("Path not found: {trimmed}"));
    }
    // When given a file, open its parent directory so the file is highlighted
    // in a useful way across platforms without needing per-OS --select flags.
    let target = if pb.is_file() {
        pb.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| pb.clone())
    } else {
        pb.clone()
    };
    let target_str = target.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system_binary("explorer.exe"))
            .arg(&target_str)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        std::process::Command::new(opener)
            .arg(&target_str)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    Ok(())
}

// ── Session / environment ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAreaRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[tauri::command]
pub fn get_work_area_rect(app: tauri::AppHandle) -> Result<WorkAreaRect, String> {
    use tauri::Manager;

    // Prefer the OS-native probe on Windows because it reliably excludes the
    // taskbar; Tauri's monitor API forwards to the same APIs but we keep the
    // direct path to preserve parity with the egui build.
    if let Some(area) = tokencue::host::session::primary_work_area_pixels() {
        return Ok(WorkAreaRect {
            x: area.x,
            y: area.y,
            width: area.width,
            height: area.height,
        });
    }

    // Cross-platform fallback (macOS: NSScreen.visibleFrame; Linux: GTK /
    // X11 work-area) via Tauri's monitor wrapper. Require a window so tao's
    // screen backend is initialised.
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor detected".to_string())?;

    let work_area = monitor.work_area();
    Ok(WorkAreaRect {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width as i32,
        height: work_area.size.height as i32,
    })
}

// ── Misc UX ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn play_notification_sound(
    event: tokencue::sound::NotificationSoundEvent,
) -> Result<(), String> {
    // Preview through the same settings resolution path used by real notifications.
    let settings = Settings::load();
    tokencue::sound::play_alert(event, &settings).map_err(|error| error.to_string())
}

/// Reposition the flyout window so its bottom-right corner stays anchored to
/// the system-tray area. Called from the frontend after dynamic resize.
///
/// Retargeted from `main` to the dedicated `flyout` window — the flyout is no
/// longer a state of `main`'s surface-mode machine, so `reanchor_tray_panel`
/// (still exported under its historical name — the frontend command name is
/// unchanged) now anchors the flyout window directly. The anchor math itself
/// lives in `shell::flyout_window::reanchor`, which this delegates to.
#[tauri::command]
pub fn reanchor_tray_panel(app: tauri::AppHandle) -> Result<(), String> {
    crate::shell::flyout_window::reanchor(&app)
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn dashboard_url_for_provider(provider_id: &str) -> Option<String> {
    if provider_id == ProviderId::MiniMax.cli_name() {
        let settings = Settings::load();
        return Some(
            tokencue::providers::MiniMaxProvider::dashboard_url_for_region(Some(
                settings.api_region(ProviderId::MiniMax),
            )),
        );
    }

    if let Some(url) = tokencue::settings::get_api_key_providers()
        .into_iter()
        .find(|p| p.id.cli_name() == provider_id)
        .and_then(|p| p.dashboard_url.map(|s| s.to_string()))
    {
        return Some(url);
    }

    let id = ProviderId::from_cli_name(provider_id)?;
    let provider = instantiate_provider(id);
    provider.metadata().dashboard_url.map(|s| s.to_string())
}

fn status_page_url_for_provider(provider_id: &str) -> Option<String> {
    let id = ProviderId::from_cli_name(provider_id)?;
    let provider = instantiate_provider(id);
    provider.metadata().status_page_url.map(|s| s.to_string())
}

#[tauri::command]
pub fn open_provider_dashboard(provider_id: String) -> Result<(), String> {
    let provider_id = canonical_provider_arg(&provider_id)?;
    let url = dashboard_url_for_provider(&provider_id)
        .ok_or_else(|| format!("No dashboard URL registered for provider '{provider_id}'"))?;
    open_url_in_browser(&url)
}

#[tauri::command]
pub fn open_provider_status_page(provider_id: String) -> Result<(), String> {
    let provider_id = canonical_provider_arg(&provider_id)?;
    let url = status_page_url_for_provider(&provider_id)
        .ok_or_else(|| format!("No status page URL registered for provider '{provider_id}'"))?;
    open_url_in_browser(&url)
}

#[tauri::command]
pub async fn trigger_provider_login(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<(), String> {
    let id = parse_provider_arg(&provider_id)?;
    let provider_id = id.cli_name().to_string();

    if id == ProviderId::Copilot {
        return run_copilot_device_login(&app).await;
    }

    if matches!(
        id,
        ProviderId::Claude | ProviderId::Codex | ProviderId::Gemini
    ) {
        return run_cli_provider_login(&app, id).await;
    }

    // Providers without a first-party CLI/device runner authenticate on their
    // dashboard. Opening it is an explicit hand-off, not a silent no-op.
    if let Some(url) = dashboard_url_for_provider(&provider_id) {
        return open_url_in_browser(&url);
    }
    Err(format!(
        "'{provider_id}' does not provide an interactive login flow. Configure its API key, cookie, or local CLI credentials in Providers."
    ))
}

fn login_phase_emitter(
    app: tauri::AppHandle,
    provider_id: String,
) -> impl Fn(tokencue::login::LoginPhase) + Send + 'static {
    move |phase| {
        let phase = match phase {
            tokencue::login::LoginPhase::Idle => "idle",
            tokencue::login::LoginPhase::Requesting => "requesting",
            tokencue::login::LoginPhase::WaitingBrowser => "waitingBrowser",
            tokencue::login::LoginPhase::Complete => "complete",
        };
        let _ = app.emit(
            "provider-login-phase",
            serde_json::json!({ "providerId": provider_id, "phase": phase }),
        );
    }
}

async fn run_cli_provider_login(app: &tauri::AppHandle, id: ProviderId) -> Result<(), String> {
    const LOGIN_TIMEOUT_SECS: u64 = 5 * 60;
    let provider_id = id.cli_name().to_string();
    let result = match id {
        ProviderId::Claude => {
            tokencue::login::run_claude_login(
                LOGIN_TIMEOUT_SECS,
                login_phase_emitter(app.clone(), provider_id.clone()),
            )
            .await
        }
        ProviderId::Codex => {
            tokencue::login::run_codex_login(
                LOGIN_TIMEOUT_SECS,
                login_phase_emitter(app.clone(), provider_id.clone()),
            )
            .await
        }
        ProviderId::Gemini => {
            tokencue::login::run_gemini_login(
                LOGIN_TIMEOUT_SECS,
                login_phase_emitter(app.clone(), provider_id.clone()),
            )
            .await
        }
        _ => return Err(format!("No CLI login runner for '{provider_id}'")),
    };
    login_result_to_command_result(&provider_id, result)
}

fn login_result_to_command_result(
    provider_id: &str,
    result: tokencue::login::LoginResult,
) -> Result<(), String> {
    use tokencue::login::LoginOutcome;

    match result.outcome {
        LoginOutcome::Success => Ok(()),
        LoginOutcome::MissingBinary => Err(format!(
            "The {provider_id} login CLI is not installed or is not available in PATH."
        )),
        LoginOutcome::TimedOut => Err(format!("{provider_id} login timed out.")),
        LoginOutcome::Failed { status } => Err(format_login_error(
            provider_id,
            &format!("login process exited with status {status}"),
            &result.output,
        )),
        LoginOutcome::LaunchFailed(error) => {
            Err(format_login_error(provider_id, &error, &result.output))
        }
    }
}

fn format_login_error(provider_id: &str, reason: &str, output: &str) -> String {
    let sanitized = output
        .chars()
        .filter(|character| !character.is_control() || character.is_whitespace())
        .collect::<String>();
    let output = sanitized.trim();
    if output.is_empty() {
        format!("{provider_id} login failed: {reason}")
    } else {
        let tail = output.chars().rev().take(500).collect::<String>();
        let tail = tail.chars().rev().collect::<String>();
        format!("{provider_id} login failed: {reason}. {tail}")
    }
}

async fn run_copilot_device_login(app: &tauri::AppHandle) -> Result<(), String> {
    let flow = CopilotDeviceFlow::new();
    let device = flow
        .start_flow()
        .await
        .map_err(|e| format!("GitHub device login failed: {e}"))?;

    open_url_in_browser(device.verification_url_to_open())?;

    let token = flow
        .wait_for_token(&device.device_code, device.interval, device.expires_in)
        .await
        .map_err(|e| format!("GitHub device login failed: {e}"))?;

    let api = CopilotApi::new();
    let identity = api.fetch_identity_with_token(&token, None).await.ok();
    let plan = api
        .fetch_usage_with_token(&token, None)
        .await
        .ok()
        .and_then(|usage| usage.login_method);

    let login = identity.as_ref().map(|identity| identity.login.clone());
    let label = match (login.as_deref(), plan.as_deref()) {
        (Some(login), Some(plan)) => format!("{login} ({plan})"),
        (Some(login), None) => login.to_string(),
        (None, Some(plan)) => plan.to_string(),
        (None, None) => "GitHub Copilot".to_string(),
    };

    let store = TokenAccountStore::new();
    let mut data = store
        .load_provider(ProviderId::Copilot)
        .map_err(|e| e.to_string())?;
    let existing_index = login.as_deref().and_then(|login| {
        data.accounts.iter().position(|account| {
            account.label == login || account.label.starts_with(&format!("{login} ("))
        })
    });

    if let Some(index) = existing_index {
        data.accounts[index].token = token;
        data.accounts[index].label = label;
        data.set_active(index);
    } else {
        let mut account = TokenAccount::new(label, token);
        account.mark_used();
        data.add_account(account);
        data.set_active(data.accounts.len().saturating_sub(1));
    }

    store
        .save_provider(ProviderId::Copilot, &data)
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "provider-updated",
        serde_json::json!({ "providerId": "copilot" }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_url_resolves_from_codex_provider_metadata() {
        assert_eq!(
            dashboard_url_for_provider("codex").as_deref(),
            Some("https://chatgpt.com/codex/settings/usage")
        );
    }

    #[test]
    fn cli_login_outcomes_become_actionable_command_results() {
        assert!(
            login_result_to_command_result(
                "codex",
                tokencue::login::LoginResult {
                    outcome: tokencue::login::LoginOutcome::Success,
                    output: String::new(),
                    auth_link: None,
                },
            )
            .is_ok()
        );

        let error = login_result_to_command_result(
            "claude",
            tokencue::login::LoginResult {
                outcome: tokencue::login::LoginOutcome::MissingBinary,
                output: String::new(),
                auth_link: None,
            },
        )
        .expect_err("missing CLI must be reported");
        assert!(error.contains("not installed"));
    }

    #[test]
    fn login_error_removes_terminal_control_characters() {
        let message = format_login_error("codex", "failed", "\u{1b}[31mbad\u{7} output\n");
        assert!(!message.contains('\u{1b}'));
        assert!(!message.contains('\u{7}'));
        assert!(message.contains("[31mbad output"));
    }
}
