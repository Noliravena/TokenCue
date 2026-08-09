import type { ProviderUsageSnapshot } from "../types/bridge";

const STORAGE_KEY = "tokencue.tray-history.v1";
const MAX_EVENTS = 80;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export type TrayHistoryEventKind =
  | "connected"
  | "warning"
  | "critical"
  | "reset"
  | "error"
  | "recovered";

export interface TrayHistoryEvent {
  id: string;
  providerId: string;
  displayName: string;
  kind: TrayHistoryEventKind;
  usedPercent: number | null;
  at: number;
}

interface ProviderBaseline {
  displayName: string;
  usedPercent: number;
  error: boolean;
  updatedAt: string;
}

interface TrayHistoryStore {
  events: TrayHistoryEvent[];
  baselines: Record<string, ProviderBaseline>;
}

function emptyStore(): TrayHistoryStore {
  return { events: [], baselines: {} };
}

function isHistoryEvent(value: unknown): value is TrayHistoryEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<TrayHistoryEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.providerId === "string" &&
    typeof event.displayName === "string" &&
    typeof event.at === "number" &&
    Number.isFinite(event.at) &&
    ["connected", "warning", "critical", "reset", "error", "recovered"].includes(
      String(event.kind),
    )
  );
}

function readStore(storage: Storage): TrayHistoryStore {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<TrayHistoryStore>;
    return {
      events: Array.isArray(parsed.events)
        ? parsed.events.filter(isHistoryEvent)
        : [],
      baselines:
        parsed.baselines && typeof parsed.baselines === "object"
          ? parsed.baselines
          : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(storage: Storage, store: TrayHistoryStore) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // History is an enhancement; quota rendering must survive a denied or
    // exhausted webview storage area.
  }
}

function eventTime(provider: ProviderUsageSnapshot, now: number) {
  const parsed = Date.parse(provider.updatedAt);
  return Number.isFinite(parsed) ? parsed : now;
}

function makeEvent(
  provider: ProviderUsageSnapshot,
  kind: TrayHistoryEventKind,
  now: number,
): TrayHistoryEvent {
  const at = eventTime(provider, now);
  return {
    id: `${provider.providerId}:${kind}:${at}`,
    providerId: provider.providerId,
    displayName: provider.displayName,
    kind,
    usedPercent: provider.error ? null : provider.primary.usedPercent,
    at,
  };
}

export function readTrayHistory(
  storage: Storage = window.localStorage,
): TrayHistoryEvent[] {
  return readStore(storage).events;
}

/**
 * Compare the latest provider snapshots with the last persisted baseline and
 * append only meaningful state transitions. The first observed snapshot set
 * establishes a baseline, so upgrading TokenCue never fabricates a page of
 * "new provider" events.
 */
export function updateTrayHistory(
  providers: ProviderUsageSnapshot[],
  highThreshold: number,
  criticalThreshold: number,
  storage: Storage = window.localStorage,
  now = Date.now(),
): TrayHistoryEvent[] {
  const store = readStore(storage);
  const hasBaseline = Object.keys(store.baselines).length > 0;
  const appended: TrayHistoryEvent[] = [];

  for (const provider of providers) {
    const previous = store.baselines[provider.providerId];
    const current: ProviderBaseline = {
      displayName: provider.displayName,
      usedPercent: provider.primary.usedPercent,
      error: Boolean(provider.error),
      updatedAt: provider.updatedAt,
    };

    if (!previous) {
      if (hasBaseline) appended.push(makeEvent(provider, "connected", now));
      store.baselines[provider.providerId] = current;
      continue;
    }

    if (previous.updatedAt === current.updatedAt) continue;

    if (!previous.error && current.error) {
      appended.push(makeEvent(provider, "error", now));
    } else if (previous.error && !current.error) {
      appended.push(makeEvent(provider, "recovered", now));
    }

    if (!current.error && !previous.error) {
      const used = current.usedPercent;
      const previousUsed = previous.usedPercent;
      if (previousUsed - used >= 10) {
        appended.push(makeEvent(provider, "reset", now));
      } else if (previousUsed < criticalThreshold && used >= criticalThreshold) {
        appended.push(makeEvent(provider, "critical", now));
      } else if (previousUsed < highThreshold && used >= highThreshold) {
        appended.push(makeEvent(provider, "warning", now));
      }
    }

    store.baselines[provider.providerId] = current;
  }

  const cutoff = now - MAX_AGE_MS;
  const byId = new Map<string, TrayHistoryEvent>();
  for (const event of [...appended, ...store.events]) {
    if (event.at >= cutoff && !byId.has(event.id)) byId.set(event.id, event);
  }
  store.events = [...byId.values()]
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_EVENTS);
  writeStore(storage, store);
  return store.events;
}

export const TRAY_HISTORY_STORAGE_KEY = STORAGE_KEY;
