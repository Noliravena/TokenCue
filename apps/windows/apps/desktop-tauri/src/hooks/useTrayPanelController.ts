import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BootstrapState } from "../types/bridge";
import {
  beginFlyoutGesture,
  dismissTrayPanel,
  endFlyoutGesture,
  openSettingsWindow,
  quitApp as quitApplication,
  reorderProviders,
  updateSettings,
} from "../lib/tauri";
import { useProviders } from "./useProviders";
import { useSettings } from "./useSettings";
import { useLocale } from "./useLocale";
import { useSurfaceTarget } from "./useSurfaceMode";
import { useTrayPanelLayout } from "./useTrayPanelLayout";
import { orderProviderSnapshots } from "../lib/providerOrder";
import {
  hydrateProviderSlots,
  orderedEnabledProviderSlots,
} from "../lib/trayProviders";

const TRAY_INITIAL_REFRESH_DELAY_MS = 250;
const DENSE_OVERVIEW_THRESHOLD = 32;

// ── Tray flyout zoom (footer slider, above Refresh) ───────────────────
// The tray flyout scale is applied via CSS `zoom` on the panel root.
export const TRAY_SCALE_MIN = 100;
export const TRAY_SCALE_MAX = 200;
export const TRAY_SCALE_STEP = 5;
const TRAY_SCALE_COMMIT_DEBOUNCE_MS = 250;

function clampTrayScalePercent(value: number): number {
  return Math.min(
    TRAY_SCALE_MAX,
    Math.max(TRAY_SCALE_MIN, Number.isFinite(value) ? value : 100),
  );
}

/**
 * Controller for the tray flyout surface — state, memos, effects, and
 * handlers. JSX stays in `TrayPanel`.
 */
export function useTrayPanelController(state: BootstrapState) {
  const { settings, update: updatePanelSettings } = useSettings(state.settings);
  const {
    providers,
    isRefreshing,
    refreshingProviderIds,
    refresh,
    lastRefresh,
    hasCachedData,
    hasLoadedCache,
  } = useProviders({
    initialRefreshDelayMs: TRAY_INITIAL_REFRESH_DELAY_MS,
    forceRefreshOnMount: settings.refreshAllProvidersOnMenuOpen,
  });
  const { t, language } = useLocale();
  const surfaceTarget = useSurfaceTarget("trayPanel");

  // Zoom slider: LOCAL draft state drives both the thumb and the live CSS
  // zoom preview while dragging; persistence trails behind a ~250ms debounce
  // (fire-and-forget updateSettings). The settings_changed echo — from our
  // own commit round-trip or another window — only re-syncs the draft when
  // no debounce is pending, so it can't fight the thumb mid-drag.
  const settingsTrayScalePercent = clampTrayScalePercent(
    settings.trayScalePercent,
  );
  const [trayScaleDraft, setTrayScaleDraft] = useState(
    settingsTrayScalePercent,
  );
  const trayScaleCommitTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (trayScaleCommitTimerRef.current === undefined) {
      setTrayScaleDraft(settingsTrayScalePercent);
    }
  }, [settingsTrayScalePercent]);
  useEffect(
    () => () => {
      if (trayScaleCommitTimerRef.current !== undefined) {
        window.clearTimeout(trayScaleCommitTimerRef.current);
      }
    },
    [],
  );
  const handleTrayScaleChange = useCallback((value: number) => {
    const next = clampTrayScalePercent(value);
    setTrayScaleDraft(next);
    if (trayScaleCommitTimerRef.current !== undefined) {
      window.clearTimeout(trayScaleCommitTimerRef.current);
    }
    trayScaleCommitTimerRef.current = window.setTimeout(() => {
      trayScaleCommitTimerRef.current = undefined;
      void updateSettings({ trayScalePercent: next }).catch(() => {});
    }, TRAY_SCALE_COMMIT_DEBOUNCE_MS);
  }, []);
  const trayScale = trayScaleDraft / 100;
  const trayScaleFillPercent =
    ((trayScaleDraft - TRAY_SCALE_MIN) / (TRAY_SCALE_MAX - TRAY_SCALE_MIN)) *
    100;

  const sorted = useMemo(
    () =>
      orderProviderSnapshots(
        providers,
        state.providers,
        settings.enabledProviders,
        settings.providerOrder,
      ),
    [providers, settings.enabledProviders, settings.providerOrder, state.providers],
  );
  const denseProviderSlots = useMemo(
    () =>
      orderedEnabledProviderSlots(
        state.providers,
        settings.enabledProviders,
        sorted,
        settings.providerOrder,
      ),
    [settings.enabledProviders, settings.providerOrder, sorted, state.providers],
  );
  const providersById = useMemo(
    () => new Map(sorted.map((provider) => [provider.providerId, provider])),
    [sorted],
  );
  const initialProviderId =
    surfaceTarget?.kind === "provider" ? surfaceTarget.providerId : null;

  // null = overview (all providers), string = single provider detail
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    initialProviderId,
  );
  const [gridExpanded, setGridExpanded] = useState(false);
  const expectsDenseOverview =
    selectedProviderId === null &&
    !gridExpanded &&
    settings.enabledProviders.length + 1 > DENSE_OVERVIEW_THRESHOLD;
  const denseTrayProviders = useMemo(() => {
    if (!expectsDenseOverview) return sorted;
    return hydrateProviderSlots(denseProviderSlots, providersById);
  }, [denseProviderSlots, expectsDenseOverview, providersById, sorted]);

  useEffect(() => {
    setSelectedProviderId(initialProviderId);
  }, [initialProviderId]);

  // Cards to display based on mode
  // Overview: all providers in the grid — non-error first, then errors
  // Detail: only the selected provider's card (macOS shows single provider)
  const visibleProviders = useMemo(() => {
    if (selectedProviderId === null) {
      // Overview: show providers in the same Settings/catalog order as the grid.
      if (sorted.length + 1 > DENSE_OVERVIEW_THRESHOLD && !gridExpanded) {
        return denseTrayProviders.slice(0, 4);
      }
      return sorted;
    }
    // Detail: show ONLY the selected provider (macOS behavior — no appended errors)
    const match = sorted.find((p) => p.providerId === selectedProviderId);
    if (!match) {
      return sorted;
    }
    return [match];
  }, [denseTrayProviders, sorted, selectedProviderId, gridExpanded]);

  // The dedicated tray window now has one fixed height for every tab. The
  // hook applies the native size once and leaves subsequent tab changes to
  // scroll inside the content region.
  const { layoutReady, requestLayout } = useTrayPanelLayout({
    canMeasure: hasLoadedCache || sorted.length > 0,
  });

  const openSettings = useCallback(() => {
    void openSettingsWindow("general").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const openProviderSettings = useCallback(() => {
    void openSettingsWindow("providers").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const closeFlyout = useCallback(() => {
    void dismissTrayPanel().catch(() => {});
  }, []);
  const openAbout = useCallback(() => {
    void openSettingsWindow("about").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const openUsageSpend = useCallback(() => {
    void openSettingsWindow("usageSpend").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const openMenuBarSettings = useCallback(() => {
    void openSettingsWindow("menuBar").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  // The float bar controls live at the bottom of the Menu (panel) tab.
  const openFloatBarSettings = useCallback(() => {
    void openSettingsWindow("menu").finally(() => {
      void getCurrentWindow().close();
    });
  }, []);
  const quitApp = useCallback(() => {
    void quitApplication();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        void dismissTrayPanel().catch(() => {});
        return;
      }
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case "r":
          e.preventDefault();
          refresh();
          break;
        case ",":
          e.preventDefault();
          openSettings();
          break;
        case "q":
          e.preventDefault();
          quitApp();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refresh, openSettings, quitApp]);

  const handleGridClick = useCallback(
    (providerId: string | null) => {
      setSelectedProviderId(providerId);
    },
    [],
  );
  const handleReorder = useCallback((orderedIds: string[]) => {
    void reorderProviders(orderedIds).catch(() => {});
  }, []);
  const handleGestureStart = useCallback(() => {
    void beginFlyoutGesture().catch(() => {});
  }, []);
  const handleGestureEnd = useCallback(() => {
    void endFlyoutGesture().catch(() => {});
  }, []);

  const revealClassName = `tray-panel-reveal${layoutReady ? " tray-panel-reveal--ready" : ""}${expectsDenseOverview ? " tray-panel-reveal--dense" : ""}`;

  return {
    t,
    language,
    settings,
    updatePanelSettings,
    isRefreshing,
    refreshingProviderIds,
    refresh,
    lastRefresh,
    hasCachedData,
    trayScaleDraft,
    trayScale,
    trayScaleFillPercent,
    handleTrayScaleChange,
    sorted,
    denseTrayProviders,
    expectsDenseOverview,
    selectedProviderId,
    gridExpanded,
    setGridExpanded,
    visibleProviders,
    layoutReady,
    requestLayout,
    openSettings,
    openProviderSettings,
    openUsageSpend,
    openMenuBarSettings,
    openFloatBarSettings,
    openAbout,
    closeFlyout,
    quitApp,
    handleGridClick,
    handleReorder,
    handleGestureStart,
    handleGestureEnd,
    revealClassName,
  };
}
