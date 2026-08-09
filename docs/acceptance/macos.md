# macOS 15 validation checklist

**Status in the current handoff:** source complete, **unverified** on a Mac.

Related docs:

- Architecture: [../architecture.md](../architecture.md)
- Design system: [../design-system.md](../design-system.md)
- Platform entry: [../../apps/macos/README.md](../../apps/macos/README.md)
- Documentation index: [../README.md](../README.md)

## Scope

macOS application sources (SwiftUI / AppKit, provider engine, CLI, plugin runtime, tests) are included in the public developer preview. They have not been compiled or exercised on a Mac during the Windows-authored development cycle. Mark this document **verified** only after every item below is completed on a real Mac running **macOS 15**.

## Build and automated checks

On Apple Silicon and, when available, Intel Macs:

```bash
cd apps/macos
swift build
make test
make check
```

Launch a freshly built TokenCue bundle with test-only provider fixtures:

```bash
make start
```

## Manual checklist

### Shell and windowing

- [ ] Status-item panel is **380** points wide, anchors to the correct menu-bar item on each display, and remains reachable across Spaces and full-screen apps.
- [ ] Escape, click-away, and the global shortcut close or toggle the panel without leaving an orphaned window.
- [ ] **880**-point settings window, onboarding, notification settings, and usage/spend views match the warm design in light and dark appearance (see [design-system.md](../design-system.md)).

### Visual design

- [ ] Warm tray cards (four tabs) and Preferences top-tab information architecture match [design-system.md](../design-system.md).
- [ ] Accent terracotta, warm surfaces, card radii (22 / 16), and usage thresholds (70% / 95%) match generated design tokens.

### Privacy and identity

- [ ] Chrome, Edge, Brave, and Firefox are offered; no Safari-only import, WidgetKit, iCloud, CloudKit, or third-party updater UI is visible as part of TokenCue branding.
- [ ] Fresh launch leaves every provider disabled, detects available login sources without a Keychain or browser-cookie prompt, and reads a browser session only after explicit onboarding consent.
- [ ] Credentials use the TokenCue Keychain service; no raw secret appears in preferences, configuration exports, diagnostics, or logs.

### Provider behavior

- [ ] Currency groups remain separate; stale provider snapshots retain last successful values and show the stale state.
- [ ] All **67** provider IDs are registered; one provider failure does not block others.

## Sign-off

| Field | Value |
| --- | --- |
| macOS version | |
| Machine (Apple Silicon / Intel) | |
| Commit | |
| Tester | |
| Date | |
| Result | ☐ verified · ☐ failed · ☐ blocked |

Mark this document **verified** only after every checklist item is completed on a real Mac.
