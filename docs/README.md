# TokenCue documentation

This directory is the public documentation root for the monorepo. Platform trees under `apps/macos` and `apps/windows` may still contain upstream-imported notes that are intentionally out of the published TokenCue source set (see repository `.gitignore`).

All public project documentation is **English only**.

## Start here

| Document | Purpose |
| --- | --- |
| [architecture.md](architecture.md) | Dual-native data flow, shared contracts, auth and plugin boundaries |
| [design-system.md](design-system.md) | Design tokens, palette, geometry, thresholds, surface map |
| [plugin-protocol.md](plugin-protocol.md) | Sandboxed provider plugin host protocol v1 |
| [upstream-policy.md](upstream-policy.md) | Import-pin policy (external product sync disabled) |
| [acceptance/windows.md](acceptance/windows.md) | Windows 11 development-build acceptance record |
| [acceptance/macos.md](acceptance/macos.md) | macOS 15 validation checklist (source complete, unverified) |

## Repository root guides

| Document | Purpose |
| --- | --- |
| [../README.md](../README.md) | Product overview and developer setup (Windows + macOS) |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute |
| [../SECURITY.md](../SECURITY.md) | Private vulnerability reporting |
| [../SUPPORT.md](../SUPPORT.md) | Where to ask for help |
| [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Community standards |
| [../CHANGELOG.md](../CHANGELOG.md) | Public release notes |
| [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | Upstream license notices and import pins |

## Platform entry points

| Path | Purpose |
| --- | --- |
| [../apps/windows/README.md](../apps/windows/README.md) | Short Windows app + CLI entry |
| [../apps/macos/README.md](../apps/macos/README.md) | Short macOS app + CLI entry |
| [../shared/contracts/README.md](../shared/contracts/README.md) | Contracts folder index (points to plugin protocol) |

## Local-only material

These paths are useful during design and parity work but are **not** part of the public distribution (gitignored):

```text
docs/design/handoff/   # Design handoff HTML / exports
docs/design/qa/        # Screenshot comparisons and native proof captures
docs/upstream/         # Generated parity tables and sync candidate reports
```

After a clean checkout, regenerate the provider parity matrix with:

```bash
pnpm run upstream:report
```

Output is written to `docs/upstream/provider-parity.md` (local, gitignored).

## Documentation map

```text
docs/
  README.md                 ← this index
  architecture.md           product architecture
  design-system.md          tokens, palette, geometry
  plugin-protocol.md        sandboxed plugin host protocol
  upstream-policy.md        import-pin process
  acceptance/
    windows.md              Windows acceptance record
    macos.md                macOS checklist
  design/                   (local) handoff + QA evidence
  upstream/                 (local) generated reports
```
