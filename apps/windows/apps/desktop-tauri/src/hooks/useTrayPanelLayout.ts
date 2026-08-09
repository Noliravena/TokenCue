import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  reanchorTrayPanel,
  revealTrayPanelWindow,
} from "../lib/tauri";

export const TRAY_FIXED_WIDTH = 380;
export const TRAY_FIXED_HEIGHT = 600;

export interface TrayPanelLayoutOptions {
  canMeasure: boolean;
}

export interface TrayPanelLayout {
  layoutReady: boolean;
  requestLayout: () => void;
}

/**
 * The tray is a fixed dialog, not a content-sized popover. Every tab shares
 * one native window height and scrolls inside its content area, so switching
 * tabs never moves the top edge or causes the flyout to jump above the taskbar.
 */
export function useTrayPanelLayout({
  canMeasure,
}: TrayPanelLayoutOptions): TrayPanelLayout {
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    if (!canMeasure) return;
    let cancelled = false;

    void (async () => {
      const window = getCurrentWindow();
      try {
        await window.setSize(
          new LogicalSize(TRAY_FIXED_WIDTH, TRAY_FIXED_HEIGHT),
        );
        await Promise.resolve(reanchorTrayPanel()).catch(() => {});
      } finally {
        if (cancelled) return;
        setLayoutReady(true);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        if (!cancelled) {
          await Promise.resolve(revealTrayPanelWindow()).catch(() => {});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canMeasure]);

  // Kept as a stable compatibility hook for callers that request a layout
  // after provider data changes. Fixed-height flyouts do not need to resize.
  const requestLayout = useCallback(() => {}, []);

  return { layoutReady, requestLayout };
}
