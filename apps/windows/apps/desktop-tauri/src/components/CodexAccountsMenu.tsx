import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  CodexAccount,
  CodexAccountsStateBridge,
  CodexAccountUsageSnapshot,
} from "../types/bridge";
import { useLocale } from "../hooks/useLocale";
import {
  codexAccountSwitch,
  getCodexAccountsState,
  refreshProviders,
} from "../lib/tauri";

function shrink(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 14)}…`;
}

export function maskAccountLabel(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) {
    const domain = value.slice(at + 1);
    return `${value[0]}***@${domain}`;
  }
  return value.length <= 2 ? "••" : `${value[0]}•••${value[value.length - 1]}`;
}

function accountLabel(account: CodexAccount): string {
  return account.nickname ?? account.emailHint ?? account.authSubject ?? shrink(account.id);
}

function usagePercent(snapshot: CodexAccountUsageSnapshot | undefined): number | null {
  const window = snapshot?.primaryWindow ?? snapshot?.secondaryWindow ?? null;
  return window && Number.isFinite(window.usedPercent)
    ? Math.max(0, Math.min(100, Math.round(window.usedPercent)))
    : null;
}

/** Multi-account switcher for the current fixed tray flyout. */
export default function CodexAccountsMenu({ hidePersonalInfo }: { hidePersonalInfo: boolean }) {
  const { t } = useLocale();
  const [state, setState] = useState<CodexAccountsStateBridge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await getCodexAccountsState());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    const unlisten = listen("codex-accounts-updated", () => {
      if (active) void load();
    });
    return () => {
      active = false;
      void unlisten.then((dispose) => dispose());
    };
  }, [load]);

  const switchAccount = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await codexAccountSwitch(id);
      await load();
      await refreshProviders();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <p className="tokencue-tray__accounts-error" role="alert">{error}</p>;
  }
  if (!state || state.accounts.length <= 1) return null;

  return (
    <section className="tokencue-tray__accounts" aria-busy={busy}>
      <header>
        <strong>{t("CodexAccountsTitle")}</strong>
        <span>{state.accounts.length}</span>
      </header>
      <ul>
        {state.accounts.map((account) => {
          const label = accountLabel(account);
          const shown = hidePersonalInfo ? maskAccountLabel(label) : label;
          const percent = usagePercent(state.snapshots[account.id]);
          const active = account.source === "ambient";
          return (
            <li key={account.id} data-active={active ? "true" : "false"}>
              <span className="tokencue-tray__accounts-meta">
                <span title={hidePersonalInfo ? undefined : label}>
                  {shown}
                  {active ? <small>{t("CodexAccountsSourceAmbient")}</small> : null}
                </span>
                {percent == null ? null : (
                  <span className="tokencue-tray__accounts-track" aria-label={`${percent}%`}>
                    <span style={{ width: `${percent}%` }} />
                  </span>
                )}
              </span>
              <button
                type="button"
                className="tokencue-tray__pill-btn"
                disabled={busy || active}
                onClick={() => void switchAccount(account.id)}
              >
                {t("CodexAccountsSwitchButton")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
