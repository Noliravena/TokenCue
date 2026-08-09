# Windows 11 acceptance record

**Status:** verified development build.

Related docs:

- Architecture: [../architecture.md](../architecture.md)
- Design system: [../design-system.md](../design-system.md)
- Platform entry: [../../apps/windows/README.md](../../apps/windows/README.md)
- Documentation index: [../README.md](../README.md)

## Scope

This record documents a Windows 11 development build that was compiled, tested, and exercised on a native Windows desktop. It is **not** a signed production release.

## Commands run

From the repository root:

```powershell
pnpm run check
pnpm --dir apps/windows/apps/desktop-tauri run test
pnpm --dir apps/windows/apps/desktop-tauri run build
cargo fmt --manifest-path apps/windows/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/windows/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path apps/windows/Cargo.toml --workspace --quiet
pnpm --dir apps/windows/apps/desktop-tauri run tauri:build:debug
```

The recorded run completed **37** frontend test files / **215** tests and **1,302** Rust workspace tests.

## Binary note

Debug executable path after a local build:

```text
apps/windows/target/debug/tokencue-desktop.exe
```

The `apps/windows/target/` tree is build output and is not committed. Rebuild with the commands above when the directory is missing.

Historical proof checksum (2026-08-08 debug binary, 49,187,840 bytes):

```text
SHA-256 99CE8880A0CD2330E9323103C74D9AB4BDDEBFD5252477047402DFEE9B1555E1
```

## Native interaction proof

The renamed binary was launched with `TOKENCUE_PROOF_MODE=settings:about`. Windows exposed the main window as `TokenCue` and the hidden single-instance window as `com.tokencue.desktop-siw`. Automated CUA was not installed on the workstation, so proof used Win32 window enumeration plus `PrintWindow` capture.

Checks covered:

- 380-pixel tray and 880-pixel settings window (see [design-system.md](../design-system.md) for geometry tokens)
- Tray → settings transition
- Providers → General navigation
- Start-at-login toggle and restoration
- First-run onboarding
- 150% DPI and three-monitor geometry

Only the Synthetic provider was enabled; no online account or real credential was used.

Local screenshot and native proof filenames may appear under `docs/design/qa/` (gitignored) after a design/QA session.

## Checklist summary

| Area | Result |
| --- | --- |
| Contract / secret checks (`pnpm run check`) | Pass (recorded run) |
| Frontend tests | Pass (215) |
| Rust workspace tests | Pass (1,302) |
| Debug `tokencue-desktop` build | Pass |
| Native tray / settings geometry | Pass (local proof) |
| Signed installer / notarization | Not in scope for developer preview |
