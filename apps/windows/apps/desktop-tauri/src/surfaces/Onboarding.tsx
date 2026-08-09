import { useEffect, useMemo, useState } from "react";
import { TOKENCUE_PROVIDER_MANIFEST } from "../generated/providerManifest";
import {
  importBrowserCookies,
  listDetectedBrowsers,
  updateSettings,
} from "../lib/tauri";
import type {
  BootstrapState,
  DetectedBrowserBridge,
  ProviderCatalogEntry,
} from "../types/bridge";
import { ProviderIcon } from "../components/providers/ProviderIcon";
import { BrandMark } from "../components/BrandMark";

export const ONBOARDING_STORAGE_KEY = "tokencue.onboarding.completed.v1";

type AuthMethod = "cli" | "oauth" | "browserCookie" | "apiKey" | string;

interface OnboardingProps {
  state: BootstrapState;
  onComplete: (state: BootstrapState) => void;
}

const FEATURED_PROVIDER_IDS = [
  "codex",
  "claude",
  "cursor",
  "gemini",
  "copilot",
  "openrouter",
  "moonshot",
  "synthetic",
] as const;

const AUTH_LABELS: Record<string, string> = {
  cli: "本机 CLI 登录",
  oauth: "OAuth 登录",
  browserCookie: "浏览器会话",
  apiKey: "API Key",
  localFile: "本机应用登录",
  endpoint: "服务地址与密钥",
  serviceAccount: "服务账号",
  applicationDefaultCredentials: "应用默认凭据",
  awsCredentials: "AWS 凭据",
};

function manifestEntry(id: string) {
  return TOKENCUE_PROVIDER_MANIFEST.find((provider) => provider.id === id);
}

function orderedCatalog(providers: ProviderCatalogEntry[]) {
  const rank = new Map<string, number>(
    FEATURED_PROVIDER_IDS.map((id, index) => [id, index]),
  );
  return [...providers].sort((a, b) => {
    const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank || a.displayName.localeCompare(b.displayName);
  });
}

export function isOnboardingComplete(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Onboarding({ state, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [authMethods, setAuthMethods] = useState<Record<string, AuthMethod>>({});
  const [browsers, setBrowsers] = useState<DetectedBrowserBridge[]>([]);
  const [browserType, setBrowserType] = useState("");
  const [browserConsent, setBrowserConsent] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listDetectedBrowsers()
      .then((detected) => {
        if (!active) return;
        setBrowsers(detected);
        setBrowserType(detected[0]?.browserType ?? "");
      })
      .catch(() => {
        if (active) setBrowsers([]);
      })
      .finally(() => {
        if (active) setDetecting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const providers = useMemo(() => orderedCatalog(state.providers), [state.providers]);
  const visibleProviders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return providers;
    return providers.filter(
      (provider) =>
        provider.displayName.toLocaleLowerCase().includes(query) ||
        provider.id.toLocaleLowerCase().includes(query),
    );
  }, [providers, search]);
  const selectedProviders = providers.filter((provider) => selected.has(provider.id));
  const browserProviders = selectedProviders.filter(
    (provider) => authMethods[provider.id] === "browserCookie",
  );
  const allAuthChosen = selectedProviders.every((provider) => authMethods[provider.id]);
  const browserReady =
    browserProviders.length === 0 ||
    (Boolean(browserType) && browserConsent && !detecting);

  const toggleProvider = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        setAuthMethods((methods) => {
          const copy = { ...methods };
          delete copy[id];
          return copy;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const finish = async () => {
    if (!allAuthChosen || !browserReady || selectedProviders.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Cookie access only occurs here, after the user selected a provider,
      // chose “browser session”, selected a browser, and checked consent.
      for (const provider of browserProviders) {
        await importBrowserCookies(provider.id, browserType);
      }
      const settings = await updateSettings({
        enabledProviders: selectedProviders.map((provider) => provider.id),
      });
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
      onComplete({ ...state, settings });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <section className="onboarding-window" aria-labelledby="onboarding-title">
        <header className="onboarding-titlebar">
          <span className="onboarding-wordmark">TokenCue</span>
          <span className="onboarding-step-label">{step + 1} / 3</span>
        </header>

        {step === 0 ? (
          <div className="onboarding-page onboarding-welcome">
            <BrandMark className="onboarding-hero-mark" size={64} />
            <p className="onboarding-eyebrow">WINDOWS 11 · PRIVATE BY DEFAULT</p>
            <h1 id="onboarding-title">所有 AI 额度，一眼掌握</h1>
            <p className="onboarding-lead">
              TokenCue 将供应商额度、余额、花费与服务状态集中到系统托盘，并在数据接近上限时提醒你。
            </p>
            <div className="onboarding-promise-grid">
              <article>
                <strong>本机处理</strong>
                <span>快照与历史保存在本机，不依赖 TokenCue 服务端。</span>
              </article>
              <article>
                <strong>明确授权</strong>
                <span>现在只检测浏览器是否存在；不会读取 Cookie。</span>
              </article>
              <article>
                <strong>随时可撤销</strong>
                <span>每个供应商均可独立停用或清除凭据。</span>
              </article>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="onboarding-page onboarding-picker">
            <div className="onboarding-heading-row">
              <div>
                <p className="onboarding-eyebrow">选择供应商</p>
                <h1 id="onboarding-title">你想在托盘中看到什么？</h1>
              </div>
              <span className="selection-count">已选 {selected.size}</span>
            </div>
            <label className="provider-search">
              <span>搜索</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="名称或 ID"
                autoFocus
              />
            </label>
            <div className="onboarding-provider-grid" role="list">
              {visibleProviders.map((provider) => {
                const checked = selected.has(provider.id);
                return (
                  <label
                    key={provider.id}
                    className={`onboarding-provider${checked ? " is-selected" : ""}`}
                  >
                    <input
                      className="provider-checkbox"
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProvider(provider.id)}
                    />
                    <ProviderIcon providerId={provider.id} size={28} />
                    <span>
                      <strong>{provider.displayName}</strong>
                      <small>{provider.id}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="onboarding-page onboarding-auth">
            <div className="onboarding-heading-row">
              <div>
                <p className="onboarding-eyebrow">选择授权方式</p>
                <h1 id="onboarding-title">由你决定 TokenCue 读取什么</h1>
              </div>
            </div>
            <p className="onboarding-inline-note">
              CLI 与 API Key 方式只在启用后读取对应来源；浏览器 Cookie 必须在本页再次明确授权。
            </p>
            <div className="onboarding-auth-list">
              {selectedProviders.map((provider) => {
                const manifest = manifestEntry(provider.id);
                const auth = manifest?.auth ?? ["apiKey"];
                return (
                  <article className="onboarding-auth-card" key={provider.id}>
                    <div className="auth-provider-title">
                      <ProviderIcon providerId={provider.id} size={26} />
                      <strong>{provider.displayName}</strong>
                    </div>
                    <div className="auth-methods">
                      {auth.map((method) => (
                        <label key={method}>
                          <input
                            type="radio"
                            name={`auth-${provider.id}`}
                            value={method}
                            checked={authMethods[provider.id] === method}
                            onChange={() =>
                              setAuthMethods((current) => ({ ...current, [provider.id]: method }))
                            }
                          />
                          <span>{AUTH_LABELS[method] ?? method}</span>
                        </label>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            {browserProviders.length > 0 ? (
              <section className="browser-consent-card">
                <div>
                  <strong>浏览器会话授权</strong>
                  <p>
                    {detecting
                      ? "正在检测已安装浏览器（不读取 Cookie）…"
                      : browsers.length > 0
                        ? `检测到 ${browsers.length} 个可用浏览器。`
                        : "未检测到受支持的浏览器，请返回选择其他授权方式。"}
                  </p>
                </div>
                {browsers.length > 0 ? (
                  <>
                    <select value={browserType} onChange={(event) => setBrowserType(event.currentTarget.value)}>
                      {browsers.map((browser) => (
                        <option key={browser.browserType} value={browser.browserType}>
                          {browser.displayName} · {browser.profileCount} 个配置文件
                        </option>
                      ))}
                    </select>
                    <label className="browser-consent-check">
                      <input
                        type="checkbox"
                        checked={browserConsent}
                        onChange={(event) => setBrowserConsent(event.currentTarget.checked)}
                      />
                      <span>
                        我授权 TokenCue 在点击“授权并完成”后，从所选浏览器读取上述供应商的会话 Cookie。
                      </span>
                    </label>
                  </>
                ) : null}
              </section>
            ) : null}
            {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
          </div>
        ) : null}

        <footer className="onboarding-footer">
          <button
            type="button"
            className="onboarding-button secondary"
            disabled={step === 0 || saving}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            返回
          </button>
          {step < 2 ? (
            <button
              type="button"
              className="onboarding-button primary"
              disabled={(step === 1 && selected.size === 0) || saving}
              onClick={() => setStep((current) => current + 1)}
            >
              {step === 0 ? "开始设置" : "继续"}
            </button>
          ) : (
            <button
              type="button"
              className="onboarding-button primary"
              disabled={!allAuthChosen || !browserReady || saving}
              onClick={() => void finish()}
            >
              {saving ? "正在保存…" : browserProviders.length ? "授权并完成" : "完成设置"}
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}
