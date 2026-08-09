# TokenCue for macOS

macOS 15 SwiftUI / AppKit application, Swift provider engine, CLI, plugin runtime, tests, and build scripts.

| Resource | Link |
| --- | --- |
| Monorepo overview & full dev commands | [../../README.md](../../README.md) |
| Documentation index | [../../docs/README.md](../../docs/README.md) |
| Acceptance checklist | [../../docs/acceptance/macos.md](../../docs/acceptance/macos.md) |
| Architecture | [../../docs/architecture.md](../../docs/architecture.md) |

## Status

- Minimum deployment target: **macOS 15**
- Apple Silicon and Intel build settings are retained
- Chrome, Edge, Brave, and Firefox are supported browser-source families
- Sensitive values use the dedicated TokenCue Keychain namespace
- Source is included in the public developer preview; it has **not** been compiled or exercised on a Mac during the current Windows development cycle

## Quick start

On a Mac, from this directory:

```bash
swift build
make test
make check
swift run TokenCue
```

Complete [docs/acceptance/macos.md](../../docs/acceptance/macos.md) before describing a macOS build as verified. The checklist covers status-item placement, multiple displays, Spaces, full-screen applications, focus dismissal, Escape handling, shortcuts, Keychain prompts, notifications, light/dark appearance, and the warm design system.
