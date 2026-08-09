# TokenCue architecture

TokenCue is a dual-native desktop product with shared product and data contracts. Windows and macOS use different system shells while keeping provider semantics, CLI payloads, plugin behavior, and visual tokens aligned.

Documentation index: [README.md](README.md).

## Goals

- **Local-first privacy** — usage and credentials stay on the user's machine; there is no TokenCue cloud relay for provider data.
- **Isolated providers** — one adapter failure must not block others; temporary failures preserve last-good snapshots with an explicit stale marker.
- **Shared contracts** — provider IDs, schemas, CLI fields, and design tokens are defined once under `shared/` and consumed by both platforms.
- **Fail-closed plugins** — sandboxed JavaScript/TypeScript plugins with manifest permissions, timeouts, and redaction.

## Data flow

```text
Provider adapters
      |
      v
Normalized usage and cost snapshots
      |
      +--> in-memory cache and local history
      +--> tray icon and dashboard
      +--> notifications and pace warnings
      +--> settings and spend views
      +--> CLI and local HTTP endpoints
```

Every provider refresh is isolated. A timeout, authentication failure, damaged response, or network error from one provider must not block updates from other providers. Temporary failures preserve the last successful snapshot with an explicit stale marker.

## Shared contracts

The `shared/` directory owns:

| Area | Location (examples) |
| --- | --- |
| Provider catalog and capabilities | `shared/contracts/provider-manifest.json` |
| Versioned JSON schemas | `shared/contracts/*.schema.json` (usage, CLI, plugins, lock file) |
| Design tokens | `shared/design/tokens.json` → generated CSS / Swift |
| Locale metadata | `shared/locales/` |
| Plugin fixtures and golden outputs | `shared/fixtures/plugins/` |
| Import snapshot pins | `shared/upstream-lock.json` |

Generated Swift constants and CSS variables must be updated from these sources rather than edited independently:

```bash
pnpm run generate
pnpm run check
```

Plugin host protocol (full text): [plugin-protocol.md](plugin-protocol.md).

## Windows application

Stack:

- **Tauri 2** — native windows, tray integration, notifications, shortcuts, startup behavior, WebView2 hosting
- **React + TypeScript** — onboarding, tray panel, settings, usage, spend, floating surfaces
- **Rust** — provider adapters, browser integration, normalization, caching, CLI (`tokencue`), redaction, plugin execution (`rquickjs`)

Desktop binary name: `tokencue-desktop`. Sensitive values use user-scoped Windows protection (DPAPI) and Credential Manager integration. Ordinary settings files contain only non-sensitive preferences and secure-storage references.

Acceptance record: [acceptance/windows.md](acceptance/windows.md).

## macOS application

Stack:

- **SwiftUI + AppKit** — menu-bar status item, panels, settings windows, global shortcuts, multi-display, Spaces, full-screen behavior
- **Swift provider engine** — parsing, refresh orchestration, CLI output, Keychain access, plugin execution (JavaScriptCore)

Minimum deployment target: **macOS 15**. Apple Silicon and Intel build settings are retained. Source is included in the public developer preview; native validation must still be completed on a Mac.

Acceptance checklist: [acceptance/macos.md](acceptance/macos.md).

## Authentication boundary

First launch may detect that a supported browser or CLI exists, but it must **not** read cookies or credentials until the user chooses a provider and authorization source. Provider adapters receive only the minimum credential material required for that provider.

Supported browser-source families include Chrome, Edge, Brave, and Firefox (platform-specific details may vary). Logs and diagnostics operate on redacted structures. Tests use synthetic fixtures and must not trigger browser or native credential prompts.

## Plugin boundary

Plugins receive a narrow host API. They cannot access arbitrary files, subprocesses, Node.js globals, browser globals, or undeclared network domains. Network and cookie permissions require an approved manifest. Redirects, timeouts, permission prompts in non-interactive sessions, and oversized responses fail closed.

Details: [plugin-protocol.md](plugin-protocol.md) · Security reporting: [../SECURITY.md](../SECURITY.md).

## Currency and history

Cost entries retain their original currency. The UI and CLI group totals by currency and never imply a conversion rate. Local history is derived from normalized snapshots and is not synchronized through a TokenCue server.

## Status thresholds

Usage level colors and thresholds are defined in design tokens (warning at ≥ 70%, critical at ≥ 95%). See [design-system.md](design-system.md).

## Import pins

Historical MIT import snapshots are recorded as tag/commit pins only in `shared/upstream-lock.json`. External product repository clone/sync is disabled. Process: [upstream-policy.md](upstream-policy.md) · Notices: [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
