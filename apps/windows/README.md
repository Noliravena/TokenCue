# TokenCue for Windows

Windows 11 desktop application (`tokencue-desktop`) and Rust CLI (`tokencue`).

| Resource | Link |
| --- | --- |
| Monorepo overview & full dev commands | [../../README.md](../../README.md) |
| Documentation index | [../../docs/README.md](../../docs/README.md) |
| Acceptance record | [../../docs/acceptance/windows.md](../../docs/acceptance/windows.md) |
| Architecture | [../../docs/architecture.md](../../docs/architecture.md) |

## Components

| Path | Role |
| --- | --- |
| `apps/desktop-tauri` | Tauri 2 shell and React / TypeScript UI |
| `rust` | Provider adapters, domain models, secure storage, browser integration, plugin runtime, CLI |
| `scripts` | Local build, validation, smoke-test, and development helpers |

## Quick start

Detailed prerequisites and commands live in the root README. From the repository root:

```powershell
corepack enable
pnpm --dir apps/windows/apps/desktop-tauri install --frozen-lockfile
pnpm --dir apps/windows/apps/desktop-tauri run tauri:dev
```

Debug desktop binary:

```text
apps/windows/target/debug/tokencue-desktop.exe
```

CLI:

```powershell
cargo run --manifest-path apps/windows/Cargo.toml -p tokencue -- --help
```

Development builds are unsigned and are not public releases.
