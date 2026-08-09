# TokenCue design system

TokenCue shares one design token source and platform-specific UI shells. This document is the public **single source of truth** for colors, radii, spacing, tray geometry, and usage thresholds. Acceptance checklists reference this page rather than duplicating token tables.

Documentation index: [README.md](README.md).

## Source of truth

| Priority | Location | Role |
| --- | --- | --- |
| 1 — Tokens | [`shared/design/tokens.json`](../shared/design/tokens.json) | Authoritative colors, radii, spacing, tray geometry, thresholds |
| 2 — Warm handoff | `docs/design/handoff/tokencue-warm-ui/` (local, gitignored) | Visual target HTML / exports used during design work |

### Generated outputs (do not edit by hand)

| Output | Consumer |
| --- | --- |
| `shared/design/generated/tokencue.css` | Windows / shared CSS (copied into the Tauri app) |
| `apps/macos/Sources/TokenCue/Generated/TokenCueDesignTokens.swift` | macOS Swift constants |

Regenerate after token edits:

```bash
pnpm run generate
```

## Palette and thresholds

Values below match `shared/design/tokens.json` (warm redesign snapshot).

### Accent and status colors

| Token | Hex | Role |
| --- | --- | --- |
| Accent (terracotta) | `#c2673a` | Primary brand accent |
| Normal | `#6e8f5a` | Healthy / normal usage |
| Warning | `#c78f2a` | Elevated usage |
| Critical | `#bb4a3d` | Near or at limit |
| Stale | `#a2988a` | Stale snapshot indicator |

### Surfaces

| Mode | Surface | Raised |
| --- | --- | --- |
| Light | `#faf4e6` | `#fffcf5` |
| Dark | `#1c1913` | `#242019` |

Canvas values (full-window backdrop): light `#efe7d5`, dark `#14110d`.

### Usage thresholds

| Level | Rule |
| --- | --- |
| Normal | usage &lt; 70% |
| Warning | 70% ≤ usage &lt; 95% |
| Critical | usage ≥ 95% |

Tokens encode this as `normalMaxExclusive: 70`, `warningMaxExclusive: 95`, `criticalMinInclusive: 95`.

## Geometry

| Token | Value | Notes |
| --- | --- | --- |
| Tray width | 380 px / pt | Tray panel width |
| Settings width | 880 px / pt | Settings / Preferences window |
| Settings height | 620 px / pt | Default settings height |
| Tray radius | 22 | Panel corner radius |
| Card radius | 16 | Provider / content cards |
| Control radius | 12 | Controls and smaller surfaces |
| Border width | 1 | Hairline borders |

## Typography

| Role | Stack (summary) |
| --- | --- |
| UI (Windows) | DM Sans, Segoe UI Variable, system-ui |
| UI (macOS) | DM Sans, -apple-system, system-ui |
| Display | Newsreader, Georgia, serif |
| Mono | JetBrains Mono, ui-monospace, Consolas |

Windows ships self-hosted woff2 fonts (no Google Fonts CDN at runtime). See `apps/windows/apps/desktop-tauri/src/assets/fonts/README.md`.

## Warm redesign snapshot

| Surface | Status |
| --- | --- |
| Shared tokens (terracotta accent, warm light/dark, radii 22/16) | Done |
| Windows tray 4-tab cards | Done (+ unit tests) |
| Windows settings top tabs + grouped cards | Done |
| Windows Usage & Spend hero + warm share PNG | Done |
| Windows FloatBar / Onboarding warm skin | Done |
| Self-hosted woff2 fonts | Done |
| macOS TokenCuePanel 4-tab warm cards | Done (compile on Mac) |
| macOS Preferences top-tab IA | Done (Providers keeps list + detail split) |
| Windows native release smoke | Local evidence under `docs/design/qa/` |
| macOS native visual proof | Pending — see [acceptance/macos.md](acceptance/macos.md) |

## Implementation map

| Surface | Windows | macOS |
| --- | --- | --- |
| Tray panel | `apps/windows/apps/desktop-tauri/src/surfaces/TrayPanel.tsx` | `apps/macos/Sources/TokenCue/TokenCuePanel.swift` |
| Settings | `Settings.tsx` + `tokencue.css` | Preferences top tabs + Providers split |
| Float bar | `floatbar/FloatBar.css` | n/a (menu-bar status item) |
| Usage & Spend | `settings/tabs/UsageSpendTab.tsx` | Preferences usage/spend views |
| Tray icon glyph | `apps/windows/rust/src/tray/icon.rs` | Status-item rendering in the macOS app |

## Local QA evidence

Screenshot comparisons and native Win32/PrintWindow captures live in `docs/design/qa/` (gitignored). Working notes may appear in `docs/design/qa/README.md` after a local design session.

Typical warm-preview filenames:

- `qa/warm-tray-preview.png`
- `qa/warm-settings-preview.png`
- `qa/tray-comparison.png`
- `qa/settings-comparison-final.png`
- `qa/windows-native-*.png`

## Platform notes

- Windows visual and native interaction QA for the warm redesign is recorded in local QA logs and the [Windows acceptance record](acceptance/windows.md).
- macOS consumes the same generated tokens but still needs a Mac pass of [acceptance/macos.md](acceptance/macos.md).
- Use the local warm handoff under `docs/design/handoff/tokencue-warm-ui/` as the design reference during UI work; do not commit handoff HTML into the public tree if it remains gitignored.
