# Upstream import policy

TokenCue pins historical MIT **import snapshots** (tag and commit only) for license and contract review. This document describes process only. Pin values live in [`shared/upstream-lock.json`](../shared/upstream-lock.json); license text and human-readable notices live in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Documentation index: [README.md](README.md).

## Policy summary

| Rule | Detail |
| --- | --- |
| Pin format | Tags and commits only in `shared/upstream-lock.json` |
| Clone URLs | **Not** stored in the lock file |
| External product sync | **Disabled** (`policy.externalProductSync: false`) |
| Rolling branches | **Not** followed (`policy.followRollingBranches: false`) |
| Human review | Required before accepting any pin update |

[`scripts/sync-upstream.ps1`](../scripts/sync-upstream.ps1) is disabled. It exits immediately with a clear error and will not clone remote product trees or rewrite application source.

## Current pins

Pins are defined in `shared/upstream-lock.json`. As of the public developer preview:

| Platform | Role | Identifiers |
| --- | --- | --- |
| macOS | Import snapshot | tag `v0.48.0`, commit `5bd58785061136505c2ad8b5dbaa73c50e7bc191` |
| Windows | Stable baseline | tag `v0.33.2`, commit `6e51128e235c490857ca35f381463c8a5427e9ab` |
| Windows | Audited implementation snapshot | commit `02971a7952ab45f9fde50808f28004a7239db320` |

Full license notices: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Accepting a pin update

An import-pin update is accepted only after human review plus:

1. `pnpm run check`
2. Windows test / build suite (see root [README.md](../README.md))
3. macOS build / test suite when a Mac is available
4. Plugin golden fixtures
5. Visual comparison against the design system and local handoff ([design-system.md](design-system.md))

Do not re-enable external product repository cloning without an explicit project decision that updates both this policy document and `policy.externalProductSync` in the lock file.

## Generated reports

Local review artifacts under `docs/upstream/` are **gitignored** and regenerated as needed.

| Command | Output |
| --- | --- |
| `pnpm run upstream:report` | `docs/upstream/provider-parity.md` — provider matrix vs current monorepo trees |

```bash
pnpm run upstream:report
```

## See also

- [architecture.md](architecture.md) — shared contracts and platform shells
- [plugin-protocol.md](plugin-protocol.md) — sandboxed plugin host
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) — MIT notices and copyright holders
