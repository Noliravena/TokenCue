import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  getBootstrapState,
  getSettingsSnapshot,
  openFlyoutWindow,
} from "./lib/tauri";
import { useSurfaceSnapshot } from "./hooks/useSurfaceSnapshot";
import { useTheme } from "./hooks/useTheme";
import { useLocale } from "./hooks/useLocale";
import TrayPanel from "./surfaces/TrayPanel";
import Onboarding, {
  isOnboardingComplete,
} from "./surfaces/Onboarding";
import { FLOATBAR_WINDOW_LABEL } from "./floatbar/api";
import { LocaleProvider } from "./i18n/LocaleProvider";
import type { BootstrapState, ThemePreference } from "./types/bridge";
import type { SurfaceSnapshot } from "./hooks/useSurfaceSnapshot";

const Settings = lazy(() => import("./surfaces/Settings"));
const FloatBar = lazy(() => import("./floatbar/FloatBar"));

function SurfaceFallback() {
  return null;
}

/** True when running inside the detached Settings window. */
function isSettingsWindow(): boolean {
  return getCurrentWebviewWindow().label === "settings";
}

/** True when running inside the detached FloatBar window. */
function isFloatBarWindow(): boolean {
  return getCurrentWebviewWindow().label === FLOATBAR_WINDOW_LABEL;
}

/** True when running inside the detached flyout ("Pop Out Dashboard") window. */
function isFlyoutWindow(): boolean {
  return getCurrentWebviewWindow().label === "flyout";
}

/** Parse the initial Settings tab from the URL query string. */
function initialSettingsTab(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("tab") || "general";
}

export default function App() {
  return (
    <LocaleProvider>
      <AppInner />
    </LocaleProvider>
  );
}

function AppInner() {
  const { t } = useLocale();
  const surface = useSurfaceSnapshot();
  const [state, setState] = useState<BootstrapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>("dark");
  const [onboardingComplete, setOnboardingComplete] = useState(
    isOnboardingComplete,
  );

  useTheme(themePreference);

  const reloadBootstrapState = useCallback(
    () => getBootstrapState(),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    reloadBootstrapState()
      .then((bootstrap) => {
        if (cancelled) {
          return;
        }
        setState(bootstrap);
        setThemePreference(bootstrap.settings.theme);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });

    // Listen for user-registered global shortcut events from the
    // `register_global_shortcut` command. The persistent shortcut already
    // opens the fixed flyout natively; this listener is the fallback for
    // ad-hoc capture-mode registrations and must use the same window.
    const unlistenPromise = listen<string>("global-shortcut-triggered", () => {
      void openFlyoutWindow().catch(() => {});
    });

    const unlistenSettingsChangePromise = isSettingsWindow()
      ? listen<string>("settings-change-tab", () => {
          void reloadBootstrapState()
            .then((bootstrap) => {
              setState(bootstrap);
              setThemePreference(bootstrap.settings.theme);
              setError(null);
            })
            .catch(() => {});
        })
      : Promise.resolve(null);

    // Keep the theme in sync when mutations happen inside other surfaces
    // (e.g., Settings → Appearance). `useSettings` dispatches this event
    // after every successful `updateSettings` call.
    const onSettingsUpdated = (evt: Event) => {
      const detail = (evt as CustomEvent<BootstrapState["settings"]>).detail;
      if (detail) {
        setThemePreference(detail.theme);
      } else {
        getSettingsSnapshot()
          .then((fresh) => setThemePreference(fresh.theme))
          .catch(() => {});
      }
    };
    window.addEventListener("tokencue:settings-updated", onSettingsUpdated);

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      void unlistenSettingsChangePromise
        .then((unlisten) => unlisten?.())
        .catch(() => {});
      window.removeEventListener("tokencue:settings-updated", onSettingsUpdated);
    };
  }, [reloadBootstrapState]);

  if (error) {
    return (
      <main className="shell">
        <section className="panel error">
          <h2>{t("BootstrapFailed")}</h2>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="shell">
        <section className="panel">
          <h2>{t("LoadingShellContract")}</h2>
          <p>{t("LoadingShellContractHint")}</p>
        </section>
      </main>
    );
  }

  // Detached utility windows always render their own surface. In particular,
  // Settings is wider than the 380px tray flyout, so letting the global
  // onboarding gate render there would center a tray-width panel inside the
  // Settings canvas and leave large empty bands on both sides.
  if (isSettingsWindow()) {
    return <DetachedSettingsApp state={state} />;
  }

  // Detached floating-bar window — render the FloatBar surface directly.
  if (isFloatBarWindow()) {
    return (
      <Suspense fallback={<SurfaceFallback />}>
        <FloatBar state={state} />
      </Suspense>
    );
  }

  // First-run onboarding belongs only to a tray-sized application surface.
  // The shared `main` window can still host Settings, so checking detached
  // window labels alone is not sufficient: a wide main-window surface must
  // not inherit the tray panel's 380px width constraint either.
  const isTraySizedSurface =
    isFlyoutWindow() || surface.mode === "trayPanel";
  if (
    isTraySizedSurface &&
    !onboardingComplete &&
    state.settings.enabledProviders.length === 0
  ) {
    return (
      <Onboarding
        state={state}
        onComplete={(nextState) => {
          setState(nextState);
          setThemePreference(nextState.settings.theme);
          setOnboardingComplete(true);
        }}
      />
    );
  }

  // Detached flyout ("Pop Out Dashboard") window — render TrayPanel directly.
  // TrayPanel is statically imported (not lazy), so no Suspense boundary is
  // needed here, unlike the other detached-window branches above.
  if (isFlyoutWindow()) {
    return <TrayPanel state={state} />;
  }

  return <SurfaceRouter surface={surface} state={state} />;
}

/**
 * A stale on-disk surface snapshot from an older build may still say PopOut.
 * Never mount the retired dashboard: hide that shared window and converge on
 * the one fixed-height flyout used by every current entry point.
 */
function LegacyPopOutRedirect() {
  useEffect(() => {
    void getCurrentWebviewWindow()
      .hide()
      .finally(() => openFlyoutWindow().catch(() => {}));
  }, []);

  return null;
}

function SurfaceRouter({
  surface,
  state,
}: {
  surface: SurfaceSnapshot;
  state: BootstrapState;
}) {
  switch (surface.mode) {
    case "hidden":
      return null;
    case "trayPanel":
      return <TrayPanel state={state} />;
    case "popOut":
      return <LegacyPopOutRedirect />;
    case "settings":
      return (
        <Suspense fallback={<SurfaceFallback />}>
          <SettingsLayout state={state} />
        </Suspense>
      );
    default:
      return <TrayPanel state={state} />;
  }
}

function SettingsLayout({ state }: { state: BootstrapState }) {
  return (
    <main className="settings-surface settings-surface--full">
      <Settings state={state} />
    </main>
  );
}

function DetachedSettingsApp({ state }: { state: BootstrapState }) {
  const [tab, setTab] = useState(initialSettingsTab);

  useEffect(() => {
    // Listen for tab-change events from Rust (when the window is re-focused
    // with a different tab request).
    const unlisten = listen<string>("settings-change-tab", (event) => {
      setTab(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <Suspense fallback={<SurfaceFallback />}>
      <main className="settings-surface settings-surface--full">
        <Settings state={state} initialTab={tab} />
      </main>
    </Suspense>
  );
}
