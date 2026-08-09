import {
  mockConvertFileSrc,
  mockIPC,
  mockWindows,
} from "@tauri-apps/api/mocks";
import { TOKENCUE_PROVIDER_MANIFEST } from "./generated/providerManifest";
import { ALL_LOCALE_KEYS } from "./i18n/keys";
import { ONBOARDING_STORAGE_KEY } from "./surfaces/Onboarding";
import zhCnFtl from "../../../rust/src/locale/zh-CN.ftl?raw";
import type {
  BootstrapState,
  ProviderChartData,
  ProviderDetail,
  ProviderUsageSnapshot,
  SettingsSnapshot,
} from "./types/bridge";

const params = new URLSearchParams(window.location.search);
const preview = params.get("preview") ?? "tray";
const previewProvider = params.get("provider");
const label = preview === "settings" || preview === "spend" ? "settings" : "flyout";

const displayOverrides: Record<string, string> = {
  ActionRefresh: "刷新",
  ActionStatusPage: "服务状态",
  ActionUsageDashboard: "用量面板",
  BootstrapFailed: "TokenCue 启动失败",
  DetailWindowModelSpecific: "模型额度",
  DetailWindowPrimary: "当前会话",
  DetailWindowSecondary: "每周额度",
  DetailWindowTertiary: "附加额度",
  MenuAbout: "关于 TokenCue",
  MenuQuit: "退出",
  MenuSettings: "设置",
  PanelAllProviders: "所有供应商",
  PanelAllProvidersShort: "全部",
  PanelCopied: "已复制",
  PanelMenu: "TokenCue 菜单",
  PanelShowAllProviders: "显示全部供应商",
  PanelShowFewerProviders: "收起供应商",
  PanelZoom: "缩放",
  ProviderPlanClaudeAi: "Claude Pro",
  ProviderWeeklyLabel: "每周额度",
  SettingsWindowTitle: "TokenCue 设置",
  TabAbout: "关于",
  TabAdvanced: "高级",
  TabGeneral: "通用",
  TabMenu: "菜单",
  TabMenuBar: "托盘",
  TabNotifications: "通知",
  TabProviders: "供应商",
  TabUsageSpend: "用量与花费",
  TooltipPopOut: "弹出仪表盘",
  UsageSpendCaption: "本机估算，按原生币种分别展示，不进行隐式汇率换算。",
  UsageSpendCol30d: "30 天",
  UsageSpendCol7d: "7 天",
  UsageSpendColCurrency: "币种",
  UsageSpendColProvider: "供应商",
  UsageSpendColSource: "来源",
  UsageSpendEmpty: "暂无花费数据",
  UsageSpendLoading: "正在加载…",
  UsageSpendRefresh: "刷新",
  UsageSpendShare: "导出分享图",
  UsageSpendTitle: "用量与花费",
  WindowClose: "关闭",
  WindowMinimize: "最小化",
};

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function parseFluentPreview(source: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/.exec(line);
    if (match) {
      entries[match[1]] = match[2].split('{ "{}" }').join("{}");
    }
  }
  return entries;
}

const chineseEntries = parseFluentPreview(zhCnFtl);
const localeEntries = Object.fromEntries(
  ALL_LOCALE_KEYS.map((key) => [
    key,
    displayOverrides[key] ?? chineseEntries[key] ?? humanize(key),
  ]),
);

const providerCatalog = TOKENCUE_PROVIDER_MANIFEST.map((provider) => ({
  id: provider.id,
  displayName: provider.name,
  cookieDomain: null,
}));

const emptySoundPaths = {
  predictiveWarning: null,
  highUsage: null,
  criticalUsage: null,
  exhausted: null,
  statusIssue: null,
  sessionDepleted: null,
  sessionRestored: null,
};

let settings: SettingsSnapshot = {
  enabledProviders: ["codex", "claude", "cursor", "gemini", "alibabatokenplan", "moonshot", "copilot"],
  providerOrder: ["codex", "claude", "cursor", "gemini", "alibabatokenplan", "moonshot", "copilot"],
  refreshIntervalSecs: 300,
  adaptiveRefresh: true,
  refreshAllProvidersOnMenuOpen: false,
  lowPowerMode: false,
  startAtLogin: true,
  startMinimized: true,
  showNotifications: true,
  soundEnabled: true,
  notificationSoundTheme: "tokenCue",
  notificationSoundPaths: emptySoundPaths,
  highUsageThreshold: 70,
  criticalUsageThreshold: 95,
  predictivePaceWarningEnabled: true,
  trayIconMode: "single",
  switcherShowsIcons: true,
  menuBarShowsHighestUsage: true,
  menuBarShowsPercent: true,
  showAsUsed: true,
  showAllTokenAccountsInMenu: false,
  enableAnimations: true,
  resetTimeRelative: true,
  showResetWhenExhausted: true,
  menuBarDisplayMode: "detailed",
  hidePersonalInfo: false,
  globalShortcut: "Ctrl+Shift+U",
  codexCustomSessionsDirs: [],
  agentSessionsEnabled: false,
  agentSessionSshHosts: [],
  hooksEnabled: false,
  httpProxyEnabled: false,
  httpProxyUrl: "",
  httpProxyUsername: "",
  httpProxyPassword: "",
  uiLanguage: "chinese",
  theme: params.get("theme") === "light" ? "light" : "dark",
  windowScalePercent: 100,
  trayScalePercent: 100,
  powertoysStatusPipeEnabled: false,
  claudeAvoidKeychainPrompts: true,
  codexSparkUsageVisible: true,
  disableKeychainAccess: false,
  providerMetrics: {},
  floatBarEnabled: false,
  floatBarOpacity: 82,
  floatBarScale: 100,
  floatBarOrientation: "horizontal",
  floatBarStyle: "floating",
  floatBarClickThrough: false,
  floatBarProviderIds: [],
  floatBarDarkText: false,
  floatBarShowResetInline: true,
  floatBarShowCost: true,
  promoteTrayIcon: true,
  claudeDailyRoutinesUsageVisible: true,
  alibabaTokenPlanRegion: "cn",
  weeklyProgressWorkDays: 5,
};

function windowSnapshot(usedPercent: number, hoursToReset: number, label: string) {
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowMinutes: hoursToReset * 60,
    resetsAt: new Date(Date.now() + hoursToReset * 3_600_000).toISOString(),
    resetDescription: label,
    isExhausted: usedPercent >= 100,
    reservePercent: null,
    reserveDescription: null,
  };
}

function provider(
  providerId: string,
  displayName: string,
  usedPercent: number,
  options: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerId,
    displayName,
    primary: windowSnapshot(usedPercent, 2.4, "2 小时 24 分后重置"),
    primaryLabel: "当前会话",
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    planName: null,
    accountEmail: null,
    sourceLabel: "本机",
    updatedAt: new Date(Date.now() - 36_000).toISOString(),
    error: null,
    pace: null,
    accountOrganization: null,
    trayStatusLabel: null,
    fetchDurationMs: 184,
    ...options,
  };
}

const providers: ProviderUsageSnapshot[] = [
  provider("codex", "Codex", 64, {
    accountEmail: "alex@tokencue.dev",
    planName: "Plus",
    primary: {
      ...windowSnapshot(64, 3.2, "3 时 12 分后重置"),
      resetsAt: null,
      resetDescription: "3 时 12 分后重置",
    },
    secondary: windowSnapshot(42, 86, "3 天 14 小时后重置"),
    secondaryLabel: "每周额度",
    cost: {
      used: 18.42,
      limit: 50,
      remaining: 31.58,
      currencyCode: "USD",
      period: "month",
      resetsAt: null,
      formattedUsed: "$18.42",
      formattedLimit: "$50.00",
      balance: null,
      formattedBalance: null,
    },
    pace: {
      stage: "slightly_ahead",
      deltaPercent: 6,
      willLastToReset: true,
      etaSeconds: null,
      expectedUsedPercent: 58,
      actualUsedPercent: 64,
    },
  }),
  provider("claude", "Claude", 87, {
    accountEmail: "team@tokencue.dev",
    planName: "Max",
    primary: {
      ...windowSnapshot(87, 0.8, "48 分后重置"),
      resetsAt: null,
      resetDescription: "48 分后重置",
    },
    secondary: {
      ...windowSnapshot(41, 92, "3 天 20 时"),
      resetsAt: null,
      resetDescription: "3 天 20 时",
    },
    secondaryLabel: "周额度",
    extraRateWindows: [
      {
        id: "sonnet",
        title: "Sonnet",
        window: {
          ...windowSnapshot(12, 22, "22 小时后重置"),
          resetsAt: null,
          resetDescription: null,
        },
      },
    ],
    cost: {
      used: 0.04,
      limit: 254.24,
      remaining: 254.2,
      currencyCode: "USD",
      period: "今日 / 30 天",
      resetsAt: null,
      formattedUsed: "$0.04",
      formattedLimit: "$254.24",
      balance: null,
      formattedBalance: null,
    },
    pace: {
      stage: "far_ahead",
      deltaPercent: 31,
      willLastToReset: false,
      etaSeconds: 1_200,
      expectedUsedPercent: 56,
      actualUsedPercent: 87,
    },
  }),
  provider("cursor", "Cursor", 33, {
    planName: "Pro",
    primary: {
      ...windowSnapshot(33, 300, "8 月 21 日重置"),
      resetsAt: null,
      resetDescription: "8 月 21 日重置",
    },
  }),
  provider("gemini", "Gemini", 19, {
    planName: "Ultra",
    primary: {
      ...windowSnapshot(19, 14, "明日 00:00 重置"),
      resetsAt: null,
      resetDescription: "明日 00:00 重置",
    },
  }),
  provider("alibabatokenplan", "通义 Qwen", 52, {
    primary: {
      ...windowSnapshot(52, 1.1, "1 时 05 分后重置"),
      resetsAt: null,
      resetDescription: "1 时 05 分后重置",
    },
  }),
  provider("moonshot", "Kimi", 71, {
    primary: {
      ...windowSnapshot(71, 72, "周三重置"),
      resetsAt: null,
      resetDescription: "周三重置",
    },
  }),
  provider("copilot", "GitHub Copilot", 0, {
    error: "授权已过期；其余供应商仍使用最后一次成功快照。",
    updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
  }),
];

/** `YYYY-MM-DD` for `daysAgo` days before today, in local time. */
function previewDay(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 14 days of merged spend ending today. Dates are generated relative to the
 * current day so the preview charts always end on "today" rather than drifting
 * away from a hard-coded month.
 */
function previewDailySpend(): { date: string; value: number }[] {
  const shape = [1.42, 2.05, 1.18, 2.86, 1.9, 3.4, 2.47, 1.7, 3.98, 3.05, 2.3, 3.76, 4.68, 2.14];
  return shape.map((value, index) => ({
    date: previewDay(shape.length - 1 - index),
    value,
  }));
}

function chart(providerId: string): ProviderChartData {
  return {
    providerId,
    costHistory: [2.2, 3.6, 1.9, 4.1, 2.8, 3.3, 2.5].map((value, index) => ({
      date: previewDay(6 - index),
      value,
    })),
    creditsHistory: [],
    usageBreakdown: [],
    localUsage: {
      todayCost: 2.5,
      thirtyDayCost: 18.42,
      thirtyDayTokens: 3_482_100,
      latestTokens: 184_200,
      topModel: "gpt-5",
      estimateNote: "本机日志估算",
      tokenCostUpdatedAtMs: Date.now(),
    },
  };
}

function providerDetail(providerId: string): ProviderDetail {
  const snapshot = providers.find((entry) => entry.providerId === providerId);
  const catalog = providerCatalog.find((entry) => entry.id === providerId);
  return {
    id: providerId,
    displayName: snapshot?.displayName ?? catalog?.displayName ?? providerId,
    enabled: settings.enabledProviders.includes(providerId),
    email: snapshot?.accountEmail ?? (providerId === "codex" ? "alex@tokencue.dev" : null),
    plan: snapshot?.planName ?? (providerId === "codex" ? "Plus" : null),
    authType: providerId === "codex" ? "OAuth · Codex CLI" : "自动检测",
    sourceLabel: snapshot?.sourceLabel ?? "本机",
    organization: snapshot?.accountOrganization ?? null,
    lastUpdated: snapshot?.updatedAt ?? null,
    session: snapshot?.primary ?? null,
    weekly: snapshot?.secondary ?? null,
    modelSpecific: snapshot?.modelSpecific ?? null,
    tertiary: snapshot?.tertiary ?? null,
    extraRateWindows: snapshot?.extraRateWindows ?? [],
    cost: snapshot?.cost ?? null,
    pace: snapshot?.pace ?? null,
    lastError: snapshot?.error ?? null,
    dashboardUrl: "https://example.invalid/dashboard",
    statusPageUrl: "https://example.invalid/status",
    buyCreditsUrl: null,
    hasSnapshot: Boolean(snapshot),
    cookieSource: providerId === "codex" ? "auto" : null,
    region: null,
  };
}

function navigateToSettings(tab = "general") {
  const next = new URL(window.location.href);
  next.searchParams.set("preview", tab === "usageSpend" ? "spend" : "settings");
  next.searchParams.set("tab", tab);
  window.setTimeout(() => window.location.assign(next), 0);
}

function windowCommand(command: string) {
  if (command.endsWith("|scale_factor")) return 1;
  if (command.endsWith("|inner_size") || command.endsWith("|outer_size")) {
    return label === "settings" ? { width: 880, height: 620 } : { width: 380, height: 680 };
  }
  if (command.endsWith("|inner_position") || command.endsWith("|outer_position")) {
    return { x: 0, y: 0 };
  }
  if (command.endsWith("|is_focused") || command.endsWith("|is_visible")) return true;
  if (command.endsWith("|is_minimized") || command.endsWith("|is_maximized") || command.endsWith("|is_fullscreen")) return false;
  return undefined;
}

export function installPreviewBackend() {
  if (preview === "onboarding") {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } else {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  }

  mockWindows(label, "main", "flyout", "settings", "floatbar");
  mockConvertFileSrc("windows");
  mockIPC((command, payload = {}) => {
    const args = payload as Record<string, unknown>;
    if (command.startsWith("plugin:window|") || command.startsWith("plugin:webview|")) {
      return windowCommand(command);
    }

    switch (command) {
      case "get_bootstrap_state": {
        const state: BootstrapState = {
          contractVersion: "tokencue.v1",
          providers: providerCatalog,
          settings: preview === "onboarding" ? { ...settings, enabledProviders: [] } : settings,
        };
        return state;
      }
      case "get_provider_catalog":
        return providerCatalog;
      case "get_settings_snapshot":
        return settings;
      case "update_settings": {
        const patch = (args.patch ?? {}) as Partial<SettingsSnapshot>;
        settings = { ...settings, ...patch };
        return settings;
      }
      case "get_cached_providers":
        return providers;
      case "get_current_surface_state":
        return previewProvider
          ? {
              mode: "trayPanel",
              target: { kind: "provider", providerId: previewProvider },
            }
          : { mode: "trayPanel", target: { kind: "summary" } };
      case "get_locale_strings":
        return { language: "chinese", entries: localeEntries };
      case "get_available_languages":
        return [
          { value: "english", display: "English" },
          { value: "chinese", display: "中文" },
          { value: "chinesetraditional", display: "繁體中文" },
          { value: "japanese", display: "日本語" },
          { value: "korean", display: "한국어" },
          { value: "spanish", display: "Español" },
        ];
      case "get_work_area_rect":
        return { x: 0, y: 0, width: 1440, height: 900 };
      case "get_provider_chart_data":
        return chart(String(args.providerId ?? "codex"));
      case "get_provider_detail":
        return providerDetail(String(args.providerId ?? "codex"));
      case "get_provider_cookie_source_options":
        return String(args.providerId ?? "") === "codex"
          ? [
              { value: "auto", label: "自动", description: "优先使用本机 CLI 登录" },
              { value: "manual", label: "手动", description: "仅使用明确保存的凭据" },
            ]
          : [];
      case "get_provider_region_options":
        return [];
      case "get_provider_local_usage_summary":
        return chart(String(args.providerId ?? "codex")).localUsage;
      case "get_usage_spend_summary": {
        const daily = previewDailySpend();
        return {
          rows: [
            { providerId: "codex", displayName: "Codex", sevenDay: 12.84, thirtyDay: 41.26, currency: "USD", source: "本机日志" },
            { providerId: "claude", displayName: "Claude", sevenDay: 18, thirtyDay: 72, currency: "USD", source: "供应商账单" },
            { providerId: "alibabatokenplan", displayName: "Qwen Code", sevenDay: 36.5, thirtyDay: 128.2, currency: "CNY", source: "供应商账单" },
          ],
          today: daily[daily.length - 1]?.value ?? null,
          daily,
        };
      }
      case "list_detected_browsers":
        return [
          { browserType: "chrome", displayName: "Google Chrome", profileCount: 2 },
          { browserType: "edge", displayName: "Microsoft Edge", profileCount: 1 },
          { browserType: "firefox", displayName: "Mozilla Firefox", profileCount: 1 },
        ];
      case "get_credential_storage_status":
        return { manualCookies: "DPAPI", apiKeys: "Windows Credential Manager", tokenAccounts: "DPAPI" };
      case "get_app_info":
        return { name: "TokenCue", version: "0.1.0-dev", buildNumber: "preview", tagline: "AI usage, at a glance" };
      case "get_api_keys":
      case "get_manual_cookies":
      case "codex_accounts_list":
        return [];
      case "get_codex_accounts_state":
        return { accounts: [], snapshots: {} };
      case "get_api_key_providers":
        return providerCatalog.map((entry) => ({ id: entry.id, displayName: entry.displayName, envVar: null, help: null, dashboardUrl: null }));
      case "get_token_account_providers":
        return [];
      case "list_agent_sessions":
        return { status: "disabled" };
      case "tray_visibility_status":
        return { support: "supported", state: "promoted" };
      case "flyout_stored_size":
        return null;
      case "open_settings_window":
        navigateToSettings(String(args.tab ?? "general"));
        return undefined;
      case "open_external_url":
      case "open_provider_dashboard":
      case "open_provider_status_page":
        return undefined;
      case "reorder_providers": {
        settings = { ...settings, providerOrder: args.ids as string[] };
        return settings.enabledProviders.map((id, order) => ({
          id,
          displayName: providerCatalog.find((entry) => entry.id === id)?.displayName ?? id,
          enabled: true,
          order,
        }));
      }
      case "refresh_providers":
      case "refresh_providers_if_stale":
      case "set_surface_mode":
      case "dismiss_tray_panel":
      case "begin_flyout_gesture":
      case "end_flyout_gesture":
      case "close_settings_window":
      case "set_flyout_size":
      case "reanchor_tray_panel":
      case "reveal_tray_panel_window":
      case "register_global_shortcut":
      case "unregister_global_shortcut":
      case "play_notification_sound":
      case "set_ui_language":
      case "import_browser_cookies":
      case "quit_app":
        return undefined;
      default:
        // Secondary settings panels are still usable in preview: commands
        // without fixture data fail closed to an empty value rather than
        // attempting any credential or filesystem access.
        return null;
    }
  }, { shouldMockEvents: true });
}
