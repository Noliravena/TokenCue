# Third-party notices

TokenCue retains complete copies of the applicable MIT licenses at `apps/macos/LICENSE` and `apps/windows/LICENSE`.

Import snapshot pins (tag and commit only) are recorded in [`shared/upstream-lock.json`](shared/upstream-lock.json). That lock file does **not** store external product repository clone URLs. External product repository sync is disabled (`policy.externalProductSync: false`). Process details: [docs/upstream-policy.md](docs/upstream-policy.md).

## macOS application sources (MIT)

| Field | Value |
| --- | --- |
| Imported tag | `v0.48.0` |
| Imported commit | `5bd58785061136505c2ad8b5dbaa73c50e7bc191` |
| License | MIT; copyright Peter Steinberger and contributors |
| Full text | `apps/macos/LICENSE` |

The macOS provider engine, CLI foundations, parsers, fixtures, and portions of the native application include material derived from this MIT-licensed snapshot.

## Windows application sources (MIT)

| Field | Value |
| --- | --- |
| Stable baseline | `v0.33.2` / `6e51128e235c490857ca35f381463c8a5427e9ab` |
| Audited implementation snapshot | `02971a7952ab45f9fde50808f28004a7239db320` |
| License | MIT; see `apps/windows/LICENSE` and `apps/windows/NOTICE` |

The Windows Rust provider engine, CLI foundations, browser integration, tray integration, and Tauri shell include material derived from these MIT-licensed snapshots. The audited snapshot is pinned and is not a rolling dependency on any external default branch.

## Additional third-party components

See `apps/windows/NOTICE` for other MIT-licensed components incorporated into the Windows tree (including copyright holder names required by those licenses).

## Product identity

TokenCue uses its own product identity. Updater feed (none in source-only scope), signing identity, CloudKit container, bundle identifier, application user model ID, and credential namespace are TokenCue-specific and are not shared with any prior product branding.
