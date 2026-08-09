import { useMemo, useRef, useState } from "react";
import type {
  BootstrapState,
  ProviderCatalogEntry,
  ProviderUsageSnapshot,
  SettingsUpdate,
} from "../../../types/bridge";
import { TOKENCUE_PROVIDER_MANIFEST } from "../../../generated/providerManifest";
import { useLocale } from "../../../hooks/useLocale";
import { useFormattedResetTime } from "../../../hooks/useFormattedResetTime";
import { useProviders } from "../../../hooks/useProviders";
import { reorderProviders } from "../../../lib/tauri";
import { ProviderDetailPane } from "../providers/ProviderDetailPane";

interface ProvidersTabProps {
  settings: BootstrapState["settings"];
  providers: ProviderCatalogEntry[];
  set: (patch: SettingsUpdate) => void;
  saving: boolean;
}

const AUTH_LABELS: Record<string, string> = {
  apiKey: "API Key",
  browserCookie: "Browser Cookie",
  cli: "CLI",
  endpoint: "Endpoint",
  localFile: "Local login",
  oauth: "OAuth",
  serviceAccount: "Service account",
};

function authSummary(providerId: string) {
  const entry = TOKENCUE_PROVIDER_MANIFEST.find((item) => item.id === providerId);
  if (!entry) return "Auto";
  return entry.auth
    .slice(0, 2)
    .map((auth) => AUTH_LABELS[auth] ?? auth)
    .join(" · ");
}

function statusLabel(enabled: boolean, snapshot: ProviderUsageSnapshot | null) {
  if (!enabled) return "未配置";
  if (!snapshot) return "等待数据";
  if (snapshot.error) return "需要处理";
  return "已连接";
}

function ProviderOverviewRow({
  provider,
  snapshot,
  enabled,
  resetTimeRelative,
  disabled,
  canMoveUp,
  canMoveDown,
  onOpen,
  onToggle,
  onMove,
}: {
  provider: ProviderCatalogEntry;
  snapshot: ProviderUsageSnapshot | null;
  enabled: boolean;
  resetTimeRelative: boolean;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const reset = useFormattedResetTime(
    snapshot?.primary.resetsAt ?? null,
    snapshot?.primary.resetDescription ?? null,
    resetTimeRelative,
  );
  const percent = snapshot && Number.isFinite(snapshot.primary.usedPercent)
    ? `${Math.round(Math.max(0, snapshot.primary.usedPercent))}%`
    : "—";
  const level = snapshot?.error
    ? "error"
    : (snapshot?.primary.usedPercent ?? 0) >= 95
      ? "critical"
      : (snapshot?.primary.usedPercent ?? 0) >= 70
        ? "warning"
        : "normal";

  return (
    <div className="provider-overview__row" data-level={level}>
      <button
        type="button"
        className="provider-overview__identity"
        onClick={onOpen}
      >
        <span>
          <strong>{provider.displayName}</strong>
          <small>{authSummary(provider.id)}</small>
        </span>
      </button>
      <span className="provider-overview__status">
        {statusLabel(enabled, snapshot)}
      </span>
      <span className="provider-overview__metric">
        {snapshot?.error ? snapshot.error : `${percent}${reset ? ` · ${reset}` : ""}`}
      </span>
      <span className="provider-overview__reorder">
        <button
          type="button"
          disabled={!canMoveUp || disabled}
          aria-label={`上移 ${provider.displayName}`}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          disabled={!canMoveDown || disabled}
          aria-label={`下移 ${provider.displayName}`}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
      </span>
      <label className="provider-overview__toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          aria-label={`${provider.displayName} 已启用`}
          onChange={(event) => onToggle(event.currentTarget.checked)}
        />
        <span aria-hidden />
      </label>
    </div>
  );
}

export default function ProvidersTab({
  settings,
  providers,
  set,
  saving,
}: ProvidersTabProps) {
  const { t } = useLocale();
  const { providers: snapshots } = useProviders();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [orderedProviders, setOrderedProviders] = useState(providers);
  const [previousProviders, setPreviousProviders] = useState(providers);
  const searchRef = useRef<HTMLInputElement | null>(null);

  if (providers !== previousProviders) {
    setPreviousProviders(providers);
    setOrderedProviders(providers);
  }

  const enabled = useMemo(
    () => new Set(settings.enabledProviders),
    [settings.enabledProviders],
  );
  const snapshotsById = useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.providerId, snapshot])),
    [snapshots],
  );
  const rankedProviders = useMemo(() => {
    const order = new Map(
      settings.providerOrder?.map((id, index) => [id, index]) ?? [],
    );
    return [...orderedProviders].sort((left, right) => {
      const leftEnabled = enabled.has(left.id) ? 0 : 1;
      const rightEnabled = enabled.has(right.id) ? 0 : 1;
      if (leftEnabled !== rightEnabled) return leftEnabled - rightEnabled;
      return (
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.displayName.localeCompare(right.displayName)
      );
    });
  }, [enabled, orderedProviders, settings.providerOrder]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleProviders = normalizedSearch
    ? rankedProviders.filter(
        (provider) =>
          provider.id.toLocaleLowerCase().includes(normalizedSearch) ||
          provider.displayName.toLocaleLowerCase().includes(normalizedSearch),
      )
    : rankedProviders;

  const selected = selectedId
    ? providers.find((provider) => provider.id === selectedId) ?? null
    : null;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    set({
      enabledProviders: orderedProviders
        .map((provider) => provider.id)
        .filter((providerId) => next.has(providerId)),
    });
  };

  const move = (id: string, delta: -1 | 1) => {
    const current = orderedProviders.map((provider) => provider.id);
    const from = current.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    const nextIds = [...current];
    nextIds.splice(from, 1);
    nextIds.splice(to, 0, id);
    const byId = new Map(orderedProviders.map((provider) => [provider.id, provider]));
    const next = nextIds
      .map((providerId) => byId.get(providerId))
      .filter((provider): provider is ProviderCatalogEntry => Boolean(provider));
    setOrderedProviders(next);
    void reorderProviders(nextIds).catch(() => setOrderedProviders(providers));
  };

  if (selected) {
    return (
      <div className="provider-detail-page">
        <button
          type="button"
          className="provider-detail-page__back"
          onClick={() => setSelectedId(null)}
        >
          ← {t("TabProviders")}
        </button>
        <ProviderDetailPane
          providerId={selected.id}
          cookieDomain={selected.cookieDomain}
          resetTimeRelative={settings.resetTimeRelative}
          providerMetrics={settings.providerMetrics}
          wayfinderGatewayUrl={settings.wayfinderGatewayUrl ?? "http://127.0.0.1:8088"}
          settingsDisabled={saving}
          onSettingsChange={set}
        />
      </div>
    );
  }

  return (
    <section className="provider-overview">
      <header className="provider-overview__header">
        <div>
          <h2>{t("TabProviders")}</h2>
          <p>已启用 {enabled.size} 个 · 共 {providers.length} 个</p>
        </div>
        <label className="provider-overview__search">
          <span className="sr-only">{t("ProviderSidebarSearch")}</span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            placeholder={`搜索 ${providers.length} 个供应商`}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="provider-overview__add"
          onClick={() => {
            setSearch("");
            searchRef.current?.focus();
          }}
        >
          添加供应商
        </button>
      </header>

      <div className="provider-overview__list">
        {visibleProviders.map((provider, index) => (
          <ProviderOverviewRow
            key={provider.id}
            provider={provider}
            snapshot={snapshotsById.get(provider.id) ?? null}
            enabled={enabled.has(provider.id)}
            resetTimeRelative={settings.resetTimeRelative}
            disabled={saving}
            canMoveUp={index > 0}
            canMoveDown={index < visibleProviders.length - 1}
            onOpen={() => setSelectedId(provider.id)}
            onToggle={(on) => toggle(provider.id, on)}
            onMove={(delta) => move(provider.id, delta)}
          />
        ))}
        {visibleProviders.length === 0 ? (
          <div className="provider-overview__empty">没有匹配的供应商</div>
        ) : null}
      </div>
    </section>
  );
}
