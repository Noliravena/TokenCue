import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// App.tsx routes by `getCurrentWebviewWindow().label` before falling through
// to the shared-window SurfaceRouter (which reads the surface-mode snapshot
// instead). These tests focus on that routing decision — which top-level
// surface App mounts for a given window label — not on any individual
// surface's internal behavior (those have their own dedicated test files).

const webviewWindowMocks = vi.hoisted(() => ({
  label: "main",
  hide: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: webviewWindowMocks.label,
    hide: webviewWindowMocks.hide,
  }),
}));

const tauriMocks = vi.hoisted(() => ({
  getBootstrapState: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  openFlyoutWindow: vi.fn(),
  getLocaleStrings: vi.fn(),
  setUiLanguage: vi.fn(),
  getCurrentSurfaceState: vi.fn(),
}));

vi.mock("./lib/tauri", () => tauriMocks);

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => eventMocks);

const surfaceMocks = vi.hoisted(() => ({
  mode: "hidden",
  target: { kind: "summary" },
}));

// Stand-in surfaces: assert routing, not each surface's own rendering.
vi.mock("./surfaces/TrayPanel", () => ({
  default: () => <div data-testid="surface-tray-panel" />,
}));
vi.mock("./surfaces/Settings", () => ({
  default: () => <div data-testid="surface-settings" />,
}));
vi.mock("./surfaces/Onboarding", () => ({
  default: () => <div data-testid="surface-onboarding" />,
  isOnboardingComplete: () => false,
}));
vi.mock("./floatbar/FloatBar", () => ({
  default: () => <div data-testid="surface-float-bar" />,
}));

vi.mock("./hooks/useSurfaceSnapshot", () => ({
  useSurfaceSnapshot: () => surfaceMocks,
}));

import App from "./App";
import { buildBundle } from "./test/localeHarness";
import type { BootstrapState, SettingsSnapshot } from "./types/bridge";

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
    criticalUsageThreshold: 90,
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
    // "dark" (not "auto") so useTheme's effect short-circuits before ever
    // touching window.matchMedia, which jsdom doesn't implement here.
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
): BootstrapState {
  return {
    contractVersion: "v1",
    providers: [],
    settings: settings(settingsOverrides),
  };
}

describe("App window-label routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventMocks.handlers.clear();
    webviewWindowMocks.label = "main";
    webviewWindowMocks.hide.mockResolvedValue(undefined);
    surfaceMocks.mode = "hidden";
    surfaceMocks.target = { kind: "summary" };
    tauriMocks.getBootstrapState.mockResolvedValue(bootstrap());
    tauriMocks.getSettingsSnapshot.mockResolvedValue(settings());
    tauriMocks.getLocaleStrings.mockResolvedValue(buildBundle());
    tauriMocks.getCurrentSurfaceState.mockResolvedValue({
      mode: "hidden",
      target: { kind: "summary" },
    });
    tauriMocks.openFlyoutWindow.mockResolvedValue(undefined);
    eventMocks.listen.mockImplementation(
      (event: string, handler: (event: { payload: unknown }) => void) => {
        eventMocks.handlers.set(event, handler);
        return Promise.resolve(() => {});
      },
    );
  });

  it("routes the dedicated flyout window to TrayPanel", async () => {
    webviewWindowMocks.label = "flyout";

    const { queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(queryByTestId("surface-tray-panel")).not.toBeNull();
    });
    expect(queryByTestId("surface-settings")).toBeNull();
    expect(queryByTestId("surface-float-bar")).toBeNull();
  });

  it("routes the detached settings window to Settings, not TrayPanel", async () => {
    webviewWindowMocks.label = "settings";

    const { queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(queryByTestId("surface-settings")).not.toBeNull();
    });
    expect(queryByTestId("surface-tray-panel")).toBeNull();
  });

  it("does not render tray-width onboarding inside the detached settings window", async () => {
    webviewWindowMocks.label = "settings";
    tauriMocks.getBootstrapState.mockResolvedValue(
      bootstrap({ enabledProviders: [] }),
    );

    const { queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(queryByTestId("surface-settings")).not.toBeNull();
    });
    expect(queryByTestId("surface-onboarding")).toBeNull();
  });

  it("routes the detached floatbar window to FloatBar, not TrayPanel", async () => {
    webviewWindowMocks.label = "floatbar";

    const { queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(queryByTestId("surface-float-bar")).not.toBeNull();
    });
    expect(queryByTestId("surface-tray-panel")).toBeNull();
  });

  it("keeps first-run onboarding on the tray-sized flyout", async () => {
    webviewWindowMocks.label = "flyout";
    tauriMocks.getBootstrapState.mockResolvedValue(
      bootstrap({ enabledProviders: [] }),
    );

    const { queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(queryByTestId("surface-onboarding")).not.toBeNull();
    });
    expect(queryByTestId("surface-tray-panel")).toBeNull();
    expect(queryByTestId("surface-settings")).toBeNull();
  });

  it("does not render tray-width onboarding in the shared main Settings surface", async () => {
    webviewWindowMocks.label = "main";
    surfaceMocks.mode = "settings";
    tauriMocks.getBootstrapState.mockResolvedValue(
      bootstrap({ enabledProviders: [] }),
    );

    const { queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(queryByTestId("surface-settings")).not.toBeNull();
    });
    expect(queryByTestId("surface-onboarding")).toBeNull();
  });

  it("does not route the shared main window to TrayPanel while hidden", async () => {
    // main's surface-mode machine only ever holds Hidden/PopOut/Settings
    // post-refactor — it can never report "trayPanel" — so the
    // isFlyoutWindow()/isSettingsWindow()/isFloatBarWindow() checks all miss
    // and control falls through to SurfaceRouter, which renders nothing for
    // "hidden".
    webviewWindowMocks.label = "main";

    const { container, queryByTestId } = render(<App />);

    // Wait for BOTH the bootstrap state AND the locale bundle to resolve —
    // AppInner only reaches the isFlyoutWindow()/SurfaceRouter branch after
    // `state` is set, and LocaleProvider only renders children after its own
    // bundle loads. Waiting for both pushes past every loading-placeholder
    // return path, so a null firstChild here reflects the settled "hidden"
    // SurfaceRouter branch, not an earlier loading state.
    await waitFor(() => {
      expect(tauriMocks.getBootstrapState).toHaveBeenCalled();
      expect(tauriMocks.getLocaleStrings).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.querySelector("main.shell")).toBeNull();
    });
    expect(queryByTestId("surface-tray-panel")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("redirects a stale legacy PopOut snapshot to the fixed flyout", async () => {
    surfaceMocks.mode = "popOut";
    surfaceMocks.target = { kind: "dashboard" };

    const { container, queryByTestId } = render(<App />);

    await waitFor(() => {
      expect(webviewWindowMocks.hide).toHaveBeenCalledTimes(1);
      expect(tauriMocks.openFlyoutWindow).toHaveBeenCalledTimes(1);
    });
    expect(queryByTestId("surface-tray-panel")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("routes the global shortcut fallback to the fixed flyout", async () => {
    render(<App />);

    await waitFor(() => {
      expect(eventMocks.handlers.has("global-shortcut-triggered")).toBe(true);
    });
    act(() => {
      eventMocks.handlers.get("global-shortcut-triggered")?.({
        payload: "Ctrl+Shift+U",
      });
    });

    await waitFor(() => {
      expect(tauriMocks.openFlyoutWindow).toHaveBeenCalledTimes(1);
    });
  });
});
