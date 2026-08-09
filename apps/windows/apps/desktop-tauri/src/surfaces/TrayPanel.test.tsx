import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  getCachedProviders: vi.fn(),
  refreshProviders: vi.fn(),
  refreshProvidersIfStale: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  updateSettings: vi.fn(),
  dismissTrayPanel: vi.fn(),
  beginFlyoutGesture: vi.fn(),
  endFlyoutGesture: vi.fn(),
  openSettingsWindow: vi.fn(),
  quitApp: vi.fn(),
  getWorkAreaRect: vi.fn(),
  reanchorTrayPanel: vi.fn(),
  revealTrayPanelWindow: vi.fn(),
  flyoutStoredSize: vi.fn(),
  setFlyoutSize: vi.fn(),
  reorderProviders: vi.fn(),
  getCurrentSurfaceState: vi.fn(),
  getLocaleStrings: vi.fn(),
  setUiLanguage: vi.fn(),
  getUsageSpendSummary: vi.fn(),
  getProviderChartData: vi.fn(),
  getAppInfo: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  listeners: new Map<string, Array<(event: { payload: unknown }) => void>>(),
}));

const currentWindowMocks = vi.hoisted(() => ({
  setSize: vi.fn(),
  close: vi.fn(),
  scaleFactor: vi.fn(),
  onResized: vi.fn(),
  innerSize: vi.fn(),
  startResizeDragging: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(() => currentWindowMocks),
  LogicalSize: vi.fn((width: number, height: number) => ({ width, height })),
  PhysicalSize: vi.fn((width: number, height: number) => ({ width, height })),
}));

vi.mock("../lib/tauri", () => tauriMocks);
vi.mock("@tauri-apps/api/event", () => eventMocks);
vi.mock("@tauri-apps/api/window", () => windowMocks);

import TrayPanel from "./TrayPanel";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { TEST_PROVIDER_CATALOG } from "../test/providerCatalog";
import { buildBundle } from "../test/localeHarness";
import type {
  BootstrapState,
  ProviderCatalogEntry,
  ProviderUsageSnapshot,
  RateWindowSnapshot,
  SettingsSnapshot,
} from "../types/bridge";

function rateWindow(
  usedPercent: number,
  overrides: Partial<RateWindowSnapshot> = {},
): RateWindowSnapshot {
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowMinutes: null,
    resetsAt: null,
    resetDescription: null,
    isExhausted: false,
    reservePercent: null,
    reserveDescription: null,
    ...overrides,
  };
}

function provider(
  id: string,
  displayName: string,
  usedPercent = 20,
  overrides: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerId: id,
    displayName,
    primary: rateWindow(usedPercent),
    primaryLabel: "Session",
    secondary: null,
    modelSpecific: null,
    tertiary: null,
    extraRateWindows: [],
    cost: null,
    planName: null,
    accountEmail: null,
    sourceLabel: "auto",
    updatedAt: "2099-08-08T00:00:00Z",
    error: null,
    pace: null,
    accountOrganization: null,
    trayStatusLabel: null,
    fetchDurationMs: null,
    ...overrides,
  };
}

function settings(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    enabledProviders: ["codex", "claude"],
    refreshIntervalSecs: 300,
    adaptiveRefresh: false,
    refreshAllProvidersOnMenuOpen: false,
    lowPowerMode: false,
    startAtLogin: false,
    startMinimized: false,
    showNotifications: true,
    soundEnabled: true,
    notificationSoundTheme: "windows",
    notificationSoundPaths: {
      predictiveWarning: null,
      highUsage: null,
      criticalUsage: null,
      exhausted: null,
      statusIssue: null,
      sessionDepleted: null,
      sessionRestored: null,
    },
    highUsageThreshold: 70,
    criticalUsageThreshold: 95,
    predictivePaceWarningEnabled: false,
    trayIconMode: "single",
    switcherShowsIcons: true,
    menuBarShowsHighestUsage: false,
    menuBarShowsPercent: false,
    showAsUsed: true,
    showAllTokenAccountsInMenu: false,
    enableAnimations: true,
    resetTimeRelative: true,
    showResetWhenExhausted: false,
    menuBarDisplayMode: "detailed",
    hidePersonalInfo: false,
    globalShortcut: "Ctrl+Shift+U",
    codexCustomSessionsDirs: [],
    uiLanguage: "english",
    theme: "dark",
    windowScalePercent: 125,
    trayScalePercent: 100,
    powertoysStatusPipeEnabled: false,
    claudeAvoidKeychainPrompts: false,
    codexSparkUsageVisible: true,
    disableKeychainAccess: false,
    providerMetrics: {},
    floatBarEnabled: false,
    floatBarOpacity: 80,
    floatBarScale: 100,
    floatBarOrientation: "horizontal",
    floatBarStyle: "floating",
    floatBarClickThrough: false,
    floatBarProviderIds: [],
    floatBarDarkText: false,
    floatBarShowResetInline: false,
    floatBarShowCost: false,
    claudeDailyRoutinesUsageVisible: true,
    alibabaTokenPlanRegion: "cn",
    weeklyProgressWorkDays: null,
    ...overrides,
  };
}

function bootstrap(
  settingsOverrides: Partial<SettingsSnapshot> = {},
  catalog: ProviderCatalogEntry[] = [],
): BootstrapState {
  return {
    contractVersion: "v1",
    providers: catalog,
    settings: settings(settingsOverrides),
  };
}

function renderTrayPanel(
  providers: ProviderUsageSnapshot[],
  settingsOverrides: Partial<SettingsSnapshot> = {},
  catalog: ProviderCatalogEntry[] = [],
) {
  tauriMocks.getCachedProviders.mockResolvedValue(providers);
  tauriMocks.getSettingsSnapshot.mockResolvedValue(settings(settingsOverrides));
  return render(
    <LocaleProvider>
      <TrayPanel state={bootstrap(settingsOverrides, catalog)} />
    </LocaleProvider>,
  );
}

function emitEvent(event: string, payload: unknown) {
  for (const listener of eventMocks.listeners.get(event) ?? []) {
    listener({ payload });
  }
}

describe("TokenCue handoff tray panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventMocks.listeners.clear();
    localStorage.removeItem("tokencue.tray-history.v1");

    currentWindowMocks.setSize.mockResolvedValue(undefined);
    currentWindowMocks.close.mockResolvedValue(undefined);
    currentWindowMocks.scaleFactor.mockResolvedValue(1);
    currentWindowMocks.onResized.mockResolvedValue(() => {});
    currentWindowMocks.innerSize.mockResolvedValue({ width: 380, height: 200 });
    currentWindowMocks.startResizeDragging.mockResolvedValue(undefined);

    tauriMocks.flyoutStoredSize.mockResolvedValue(null);
    tauriMocks.setFlyoutSize.mockResolvedValue(undefined);
    tauriMocks.refreshProviders.mockResolvedValue(undefined);
    tauriMocks.refreshProvidersIfStale.mockResolvedValue(undefined);
    tauriMocks.dismissTrayPanel.mockResolvedValue(undefined);
    tauriMocks.beginFlyoutGesture.mockResolvedValue(undefined);
    tauriMocks.endFlyoutGesture.mockResolvedValue(undefined);
    tauriMocks.openSettingsWindow.mockResolvedValue(undefined);
    tauriMocks.quitApp.mockResolvedValue(undefined);
    tauriMocks.reanchorTrayPanel.mockResolvedValue(undefined);
    tauriMocks.revealTrayPanelWindow.mockResolvedValue(undefined);
    tauriMocks.getWorkAreaRect.mockResolvedValue({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });
    tauriMocks.getCurrentSurfaceState.mockResolvedValue({
      mode: "trayPanel",
      target: { kind: "summary" },
    });
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());
    tauriMocks.updateSettings.mockImplementation(
      async (patch: Partial<SettingsSnapshot>) => settings(patch),
    );
    tauriMocks.getUsageSpendSummary.mockResolvedValue({
      rows: [],
      today: null,
      daily: [],
    });
    tauriMocks.getProviderChartData.mockResolvedValue({
      providerId: "codex",
      costHistory: [],
      creditsHistory: [],
      usageBreakdown: [],
      localUsage: null,
    });
    tauriMocks.getAppInfo.mockResolvedValue({
      name: "TokenCue",
      version: "1.4.2",
      buildNumber: "1042",
      tagline: "Local quota tracking",
    });
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle({
        ActionRefresh: "Refresh",
        MenuQuit: "Quit TokenCue",
        MenuSettings: "Settings...",
        UsageSpendTitle: "Usage & Spend",
        DetailWindowSecondary: "Weekly",
        DetailWindowModelSpecific: "Model",
        DetailWindowTertiary: "Monthly",
        DetailPaceWillLastToReset: "On pace to last until reset",
        PredictivePaceWarningBody: "May run out in {}",
        TrayTabQuota: "Quota",
        TrayTabSpend: "Spend",
        TrayTabHistory: "History",
        TrayTabSettings: "Settings",
        TrayEmptyTitle: "No providers connected",
        TrayEmptyDescription: "Connect an account and its quota, reset time, and spend will appear here together.",
        TrayEmptyConnect: "Connect a provider →",
        TrayLocalPrivacy: "Processed locally · no credentials uploaded",
        TrayCurrentAlerts: "Current alerts",
        TrayNoCurrentAlerts: "No current alerts.",
        TrayOpenFullSettings: "Open full settings",
        TrayTodayLabel: "Today",
        TrayLast30DaysLabel: "Last 30 days",
        TrayUpdatedAgo: "Updated",
        TrayFixProvider: "Fix",
        TraySpendDisclaimer: "Amounts are local estimates.",
        PanelUsedSuffix: "used",
        PanelLeftSuffix: "left",
        UsageSpendLoading: "Loading…",
        UsageSpendEmpty: "No spend data yet.",
        TraySpendAxisStart: "{} days ago",
        TrayHistoryRangeDays: "{} days",
        TrayHistoryRangeLabel: "Time range",
        TrayHistoryProviderLabel: "History provider",
        TrayHistoryCumulative: "{}% used",
        TrayProvidersEnabled: "{} enabled",
        TabProviders: "Providers",
        TabMenuBar: "Menu bar",
        TabAbout: "About",
        FloatBarSectionTitle: "Floating bar",
        ProviderEnabled: "Enabled",
        ProviderDisabled: "Disabled",
        ProviderInfo: "Provider info",
        ProviderSettingsTitle: "Provider settings",
        DisplayModeDetailed: "Detailed",
        ShowNotifications: "Show notifications",
        ShowNotificationsHelper: "Notify when usage crosses a threshold.",
        ShowUsageAsUsed: "Show usage as used",
        ShowUsageAsUsedHelper: "Show used percentage instead of remaining.",
        RefreshIntervalLabel: "Refresh interval",
        RefreshIntervalHelper: "How often providers refresh.",
        WindowClose: "Close",
      }),
    );
    eventMocks.listen.mockImplementation(
      (event: string, handler: (event: { payload: unknown }) => void) => {
        const listeners = eventMocks.listeners.get(event) ?? [];
        listeners.push(handler);
        eventMocks.listeners.set(event, listeners);
        return Promise.resolve(() => {});
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reveals in its dedicated flyout at the fixed 380x600 size", async () => {
    tauriMocks.getCurrentSurfaceState.mockResolvedValue({
      mode: "popOut",
      target: { kind: "dashboard" },
    });

    const { container } = renderTrayPanel([provider("claude", "Claude", 35)]);

    await waitFor(() => {
      expect(container.querySelector(".tray-panel-reveal--ready")).not.toBeNull();
      expect(currentWindowMocks.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 380, height: 600 }),
      );
      expect(tauriMocks.revealTrayPanelWindow).toHaveBeenCalled();
    });

    const resizeCalls = currentWindowMocks.setSize.mock.calls.length;
    fireEvent.click(screen.getByRole("tab", { name: "Spend" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Spend" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(currentWindowMocks.setSize).toHaveBeenCalledTimes(resizeCalls);
    expect(container.querySelector(".tray-resize")).toBeNull();
  });

  it("dismisses only on an unmodified Escape", async () => {
    const { container } = renderTrayPanel([provider("claude", "Claude", 35)]);
    await waitFor(() => {
      expect(container.querySelector(".tray-panel-reveal--ready")).not.toBeNull();
    });

    fireEvent.keyDown(window, { key: "Escape", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape", shiftKey: true });
    expect(tauriMocks.dismissTrayPanel).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(tauriMocks.dismissTrayPanel).toHaveBeenCalledTimes(1);
    });
  });

  it("closes from both the titlebar control and footer without opening the retired PopOut surface", async () => {
    renderTrayPanel([provider("claude", "Claude", 35)]);

    const closeButtons = await screen.findAllByRole("button", { name: "Close" });
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[0]);
    fireEvent.click(closeButtons[1]);

    await waitFor(() => {
      expect(tauriMocks.dismissTrayPanel).toHaveBeenCalledTimes(2);
    });
  });

  it("refreshes from the header and Ctrl+R", async () => {
    renderTrayPanel([provider("claude", "Claude", 35)]);
    const refresh = await screen.findByRole("button", { name: "Refresh" });
    tauriMocks.refreshProviders.mockClear();

    fireEvent.click(refresh);
    await waitFor(() => {
      expect(tauriMocks.refreshProviders).toHaveBeenCalledTimes(1);
    });
    act(() => {
      emitEvent("refresh-complete", {});
    });
    tauriMocks.refreshProviders.mockClear();
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });

    await waitFor(() => {
      expect(tauriMocks.refreshProviders).toHaveBeenCalledTimes(1);
    });
  });

  it("localizes the handoff tray tabs and refresh control", async () => {
    tauriMocks.getLocaleStrings.mockResolvedValue(
      buildBundle(
        {
          ActionRefresh: "更新",
          TrayTabQuota: "额度",
          TrayTabSpend: "花费",
          TrayTabHistory: "历史",
          TrayTabSettings: "设置",
          MenuQuit: "TokenCue を終了",
          UpdatedDaysAgo: "{}日前",
        },
        "japanese",
      ),
    );

    renderTrayPanel([provider("codex", "Codex", 35)]);

    expect(await screen.findByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /额度/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /花费/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /历史/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /设置/ })).toBeInTheDocument();
  });

  it("renders providers in the shared catalog order as warm cards", async () => {
    const catalog: ProviderCatalogEntry[] = [
      { id: "codex", displayName: "Codex", cookieDomain: null },
      { id: "claude", displayName: "Claude", cookieDomain: null },
      { id: "cursor", displayName: "Cursor", cookieDomain: null },
      { id: "gemini", displayName: "Gemini", cookieDomain: null },
    ];
    const snapshots = [
      provider("gemini", "Gemini", 10),
      provider("cursor", "Cursor", 20),
      provider("codex", "Codex", 80),
      provider("claude", "Claude", 40),
    ];

    const { container } = renderTrayPanel(
      snapshots,
      { enabledProviders: catalog.map((entry) => entry.id) },
      catalog,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".tokencue-tray__card-name")).toHaveLength(4);
    });
    expect(
      Array.from(container.querySelectorAll(".tokencue-tray__card-name")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["Codex", "Claude", "Cursor", "Gemini"]);
  });

  it("applies the 70 and 95 percent threshold levels", async () => {
    const snapshots = [
      provider("codex", "Codex", 69),
      provider("claude", "Claude", 70),
      provider("cursor", "Cursor", 94),
      provider("gemini", "Gemini", 95),
    ];
    const { container } = renderTrayPanel(snapshots, {
      enabledProviders: snapshots.map((snapshot) => snapshot.providerId),
      highUsageThreshold: 70,
      criticalUsageThreshold: 95,
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".tokencue-tray__fill")).toHaveLength(4);
    });
    expect(
      Array.from(container.querySelectorAll(".tokencue-tray__fill")).map((fill) =>
        fill.getAttribute("data-level"),
      ),
    ).toEqual(["normal", "warning", "warning", "critical"]);
  });

  it("shows pace chips and plan badges on quota cards", async () => {
    const claude = provider("claude", "Claude", 87, {
      planName: "Max",
      secondary: rateWindow(41, { resetDescription: "3d 20h" }),
      secondaryLabel: "Weekly",
      pace: {
        stage: "ahead",
        deltaPercent: 18,
        willLastToReset: false,
        etaSeconds: 2_880,
        expectedUsedPercent: 69,
        actualUsedPercent: 87,
      },
    });
    const { container } = renderTrayPanel([
      provider("codex", "Codex", 64),
      claude,
      provider("cursor", "Cursor", 33),
    ]);

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(container.querySelectorAll(".tokencue-tray__card")).toHaveLength(3);
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("May run out in 48m")).toBeInTheDocument();
  });

  it("keeps a failed provider isolated while preserving healthy usage", async () => {
    const { container } = renderTrayPanel([
      provider("codex", "Codex", 64),
      provider("copilot", "GitHub Copilot", 0, {
        error: "Authentication required",
      }),
      provider("gemini", "Gemini", 19),
    ]);

    expect(await screen.findByText("Authentication required")).toBeInTheDocument();
    expect(container.querySelectorAll(".tokencue-tray__card--error")).toHaveLength(1);
    expect(container.querySelectorAll(".tokencue-tray__fill")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Fix" })).toBeInTheDocument();
  });

  it("switches tray tabs between quota and settings", async () => {
    renderTrayPanel([provider("codex", "Codex", 40)]);
    expect(await screen.findByText("Codex")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Settings/i }));
    expect(await screen.findByText("Open full settings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Quota/i }));
    expect(await screen.findByText("Codex")).toBeInTheDocument();
  });

  it("keeps spend, history, and app data cached across tab switches", async () => {
    tauriMocks.getUsageSpendSummary.mockResolvedValue({
      rows: [
        {
          providerId: "codex",
          displayName: "Codex",
          sevenDay: 4,
          thirtyDay: 12,
          currency: "USD",
          source: "local logs",
        },
      ],
      today: 1,
      daily: [{ date: "2026-08-10", value: 1 }],
    });
    renderTrayPanel([provider("codex", "Codex", 40)]);

    await waitFor(() => {
      expect(tauriMocks.getUsageSpendSummary).toHaveBeenCalledTimes(1);
      expect(tauriMocks.getProviderChartData).toHaveBeenCalledTimes(1);
      expect(tauriMocks.getAppInfo).toHaveBeenCalledTimes(1);
    });

    for (const name of [/Spend/i, /Quota/i, /History/i, /Quota/i, /Settings/i, /Quota/i]) {
      fireEvent.click(screen.getByRole("tab", { name }));
    }

    expect(tauriMocks.getUsageSpendSummary).toHaveBeenCalledTimes(1);
    expect(tauriMocks.getProviderChartData).toHaveBeenCalledTimes(1);
    expect(tauriMocks.getAppInfo).toHaveBeenCalledTimes(1);
  });

  it("retains the previous spend view while a background refresh is pending", async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined;
    tauriMocks.getUsageSpendSummary
      .mockResolvedValueOnce({
        rows: [
          {
            providerId: "codex",
            displayName: "Codex",
            sevenDay: 4,
            thirtyDay: 12,
            currency: "USD",
            source: "local logs",
          },
        ],
        today: 1,
        daily: [],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    renderTrayPanel([provider("codex", "Codex", 40)]);

    fireEvent.click(await screen.findByRole("tab", { name: /Spend/i }));
    expect(await screen.findByText("$1.00")).toBeInTheDocument();

    act(() => {
      emitEvent("refresh-complete", { providerCount: 1, errorCount: 0 });
    });
    await waitFor(() => {
      expect(tauriMocks.getUsageSpendSummary).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("$1.00")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.({
        rows: [
          {
            providerId: "codex",
            displayName: "Codex",
            sevenDay: 5,
            thirtyDay: 15,
            currency: "USD",
            source: "local logs",
          },
        ],
        today: 2,
        daily: [],
      });
    });
    expect(await screen.findByText("$2.00")).toBeInTheDocument();
  });

  it("routes provider repair and provider shortcuts to provider settings", async () => {
    renderTrayPanel([
      provider("copilot", "GitHub Copilot", 0, {
        error: "Authentication required",
      }),
    ]);

    fireEvent.click(await screen.findByRole("button", { name: "Fix" }));
    await waitFor(() => {
      expect(tauriMocks.openSettingsWindow).toHaveBeenCalledWith("providers");
    });

    tauriMocks.openSettingsWindow.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /Settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Providers/i }));
    await waitFor(() => {
      expect(tauriMocks.openSettingsWindow).toHaveBeenCalledWith("providers");
    });
  });

  it("expands a quota card with complete windows, cost, local usage, and account data", async () => {
    tauriMocks.getProviderChartData.mockResolvedValue({
      providerId: "codex",
      costHistory: [],
      creditsHistory: [],
      usageBreakdown: [],
      localUsage: {
        todayCost: 2.14,
        thirtyDayCost: 31.2,
        thirtyDayTokens: 4_700_000_000,
        latestTokens: 75_300_000,
        topModel: "gpt-5.6-sol",
        estimateNote: "Estimated from local logs",
        tokenCostUpdatedAtMs: 0,
      },
    });
    renderTrayPanel([
      provider("codex", "Codex", 40, {
        primaryLabel: "Session",
        secondary: rateWindow(55),
        secondaryLabel: "Weekly",
        modelSpecific: rateWindow(22),
        tertiary: rateWindow(18),
        extraRateWindows: [
          { id: "review", title: "Code review", window: rateWindow(7) },
        ],
        cost: {
          used: 12,
          limit: 100,
          remaining: 88,
          currencyCode: "USD",
          period: "Monthly",
          resetsAt: null,
          formattedUsed: "$12.00",
          formattedLimit: "$100.00",
        },
        accountEmail: "developer@example.com",
        accountOrganization: "Example Org",
        sourceLabel: "Codex CLI",
      }),
    ]);

    fireEvent.click(await screen.findByRole("button", { name: /Codex.*info/i }));

    expect(await screen.findByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Code review")).toBeInTheDocument();
    expect(screen.getByText("developer@example.com · Example Org")).toBeInTheDocument();
    expect(await screen.findByText("gpt-5.6-sol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Provider settings/i })).toBeInTheDocument();
  });

  it("applies quick settings without remounting the settings tab", async () => {
    renderTrayPanel([provider("codex", "Codex", 40)]);
    fireEvent.click(await screen.findByRole("tab", { name: /Settings/i }));
    const notifications = await screen.findByRole("checkbox", {
      name: "Show notifications",
    });
    fireEvent.click(notifications);

    await waitFor(() => {
      expect(tauriMocks.updateSettings).toHaveBeenCalledWith({
        showNotifications: false,
      });
      expect(notifications).not.toBeChecked();
    });
  });

  it("marks snapshots stale while retaining their last successful data", async () => {
    const { container } = renderTrayPanel([
      provider("codex", "Codex", 64, { updatedAt: "2020-01-01T00:00:00Z" }),
    ]);

    await waitFor(() => {
      expect(container.querySelector(".tokencue-tray__card--stale")).not.toBeNull();
    });
    expect(container.querySelector(".tokencue-tray__card-pct-num")?.textContent).toContain("64");
  });

  it("opens Settings from the redesigned footer and keeps Ctrl+Q quit", async () => {
    renderTrayPanel([provider("codex", "Codex", 64)]);

    fireEvent.click(await screen.findByRole("tab", { name: /Settings/i }));
    fireEvent.click(await screen.findByText("Open full settings"));
    await waitFor(() => {
      expect(tauriMocks.openSettingsWindow).toHaveBeenCalledWith("general");
    });

    const settingsButtons = screen.getAllByRole("button", { name: "Open full settings" });
    fireEvent.click(settingsButtons[settingsButtons.length - 1]);
    await waitFor(() => {
      expect(tauriMocks.openSettingsWindow).toHaveBeenCalledTimes(2);
    });

    fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    expect(tauriMocks.quitApp).toHaveBeenCalledTimes(1);
  });

  it("plots the daily spend series and totals each currency separately", async () => {
    tauriMocks.getUsageSpendSummary.mockResolvedValue({
      rows: [
        { providerId: "codex", displayName: "Codex", sevenDay: 8.4, thirtyDay: 31.2, currency: "USD", source: "local logs" },
        { providerId: "qwen", displayName: "Qwen", sevenDay: 36.5, thirtyDay: 128.2, currency: "CNY", source: "period" },
      ],
      today: 2.14,
      daily: [
        { date: "2026-08-07", value: 1 },
        { date: "2026-08-08", value: 4 },
        { date: "2026-08-09", value: 2 },
      ],
    });
    const { container } = renderTrayPanel([provider("codex", "Codex", 40)]);

    fireEvent.click(await screen.findByRole("tab", { name: /Spend/i }));

    await waitFor(() => {
      expect(container.querySelectorAll(".tokencue-tray__bar")).toHaveLength(3);
    });
    // Tallest bar is full height; the rest scale against it.
    expect(
      Array.from(container.querySelectorAll(".tokencue-tray__bar")).map(
        (bar) => (bar as HTMLElement).style.height,
      ),
    ).toEqual(["25%", "100%", "50%"]);
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
    // USD and CNY are listed side by side rather than summed together.
    const thirtyDay = container.querySelector(
      ".tokencue-tray__display-num--sm",
    );
    expect(thirtyDay?.textContent).toContain("31.20");
    expect(thirtyDay?.textContent).toContain("128.20");
  });

  it("labels snapshot-derived history rows as current alerts", async () => {
    renderTrayPanel([provider("codex", "Codex", 40)]);

    fireEvent.click(await screen.findByRole("tab", { name: /History/i }));

    expect(await screen.findByText("Current alerts")).toBeInTheDocument();
    expect(screen.getByText("No current alerts.")).toBeInTheDocument();
    expect(screen.queryByText("No spend data yet.")).not.toBeInTheDocument();
  });

  it("keeps the shortcut chip wired to refresh", async () => {
    renderTrayPanel([provider("codex", "Codex", 40)]);
    const refresh = await screen.findByRole("button", { name: "Refresh" });
    expect(refresh).toHaveTextContent("Ctrl R");
  });

  it("jumps to a provider card from the footer switcher", async () => {
    const snapshots = [provider("codex", "Codex", 40), provider("claude", "Claude", 55)];
    const { container } = renderTrayPanel(snapshots, {
      enabledProviders: ["codex", "claude"],
      switcherShowsIcons: true,
    });

    fireEvent.click(await screen.findByRole("tab", { name: /Settings/i }));
    expect(await screen.findByText("Open full settings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Claude" }));

    await waitFor(() => {
      expect(container.querySelector("#tokencue-quota-claude")).not.toBeNull();
    });
  });

  it("opens Settings from the empty state", async () => {
    renderTrayPanel([], { enabledProviders: [] });

    expect(await screen.findByText("No providers connected")).toBeInTheDocument();
    expect(screen.getByText("Processed locally · no credentials uploaded")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Connect a provider →"));
    await waitFor(() => {
      expect(tauriMocks.openSettingsWindow).toHaveBeenCalledWith("providers");
    });
  });

  it("updates usage in place without resizing the native window", async () => {
    const { container } = renderTrayPanel([provider("claude", "Claude", 35)]);
    await waitFor(() => {
      expect(container.querySelector(".tray-panel-reveal--ready")).not.toBeNull();
    });
    currentWindowMocks.setSize.mockClear();
    tauriMocks.reanchorTrayPanel.mockClear();

    act(() => {
      emitEvent("provider-updated", provider("claude", "Claude", 52));
    });
    await waitFor(() => {
      expect(container.querySelector(".tokencue-tray__card-pct-num")?.textContent).toContain("52");
    });

    expect(currentWindowMocks.setSize).not.toHaveBeenCalled();
    expect(tauriMocks.reanchorTrayPanel).not.toHaveBeenCalled();
  });

  it("keeps a dense catalog inside the same fixed tray height", async () => {
    const denseProviders = TEST_PROVIDER_CATALOG.slice(0, 36).map(
      ([id, displayName]) => provider(id, displayName),
    );

    renderTrayPanel(denseProviders, {
      enabledProviders: denseProviders.map((snapshot) => snapshot.providerId),
    });

    await waitFor(() => {
      expect(currentWindowMocks.setSize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 380, height: 600 }),
      );
    });
  });
});
