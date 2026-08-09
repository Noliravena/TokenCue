import { useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { BootstrapState } from "../types/bridge";
import { openSettingsWindow } from "../lib/tauri";
import { EmptyProviderPanel } from "../components/EmptyProviderPanel";

export const ONBOARDING_STORAGE_KEY = "tokencue.onboarding.completed.v1";

interface OnboardingProps {
  state: BootstrapState;
  onComplete: (state: BootstrapState) => void;
}

export function isOnboardingComplete(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The warm redesign folds first-run onboarding into the empty tray state.
 * Provider selection and credential consent remain in the full Providers
 * settings surface instead of duplicating a second, visually unrelated flow.
 */
export default function Onboarding({ state, onComplete }: OnboardingProps) {
  useEffect(() => {
    void getCurrentWindow().setSize(new LogicalSize(380, 560)).catch(() => {});
  }, []);

  const connectProvider = () => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    } catch {
      // A locked-down webview can reject storage; opening Settings still works.
    }
    onComplete(state);
    void openSettingsWindow("providers");
  };

  return (
    <main className="onboarding-shell">
      <EmptyProviderPanel onConnect={connectProvider} />
    </main>
  );
}
