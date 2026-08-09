# Contributing to TokenCue

Thank you for helping improve TokenCue. Contributions are welcome when they preserve user privacy, keep providers isolated, and include evidence that the affected platform still behaves correctly.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

- Search existing [issues](https://github.com/Noliravena/TokenCue/issues) and [discussions](https://github.com/Noliravena/TokenCue/discussions).
- Use Discussions for setup questions and feature exploration.
- Use the bug template for reproducible defects.
- Never post API keys, cookies, tokens, account identifiers, raw diagnostic archives, or unredacted screenshots.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Documentation map

Do not treat this file as a full command reference. Start with:

| Resource | Purpose |
| --- | --- |
| [docs/README.md](docs/README.md) | Documentation hub |
| [README.md](README.md) | Product overview and detailed Windows / macOS dev commands |
| [docs/architecture.md](docs/architecture.md) | Data flow and trust boundaries |
| [docs/design-system.md](docs/design-system.md) | Tokens, geometry, thresholds |
| [docs/plugin-protocol.md](docs/plugin-protocol.md) | Sandboxed plugin protocol |
| [docs/upstream-policy.md](docs/upstream-policy.md) | Import-pin process |
| [apps/windows/README.md](apps/windows/README.md) | Short Windows entry |
| [apps/macos/README.md](apps/macos/README.md) | Short macOS entry |

## Development setup

- **Windows:** follow [README.md § Windows development](README.md#windows-development).
- **macOS:** follow [README.md § macOS development](README.md#macos-development) and complete [docs/acceptance/macos.md](docs/acceptance/macos.md) before claiming native verification.

Install Windows frontend dependencies with the committed lockfile:

```powershell
corepack enable
pnpm --dir apps/windows/apps/desktop-tauri install --frozen-lockfile
```

## Making changes

- Keep provider-specific behavior inside the provider adapter.
- Do not add provider branching to shared refresh or rendering code.
- Keep sensitive data out of ordinary configuration, logs, panic messages, test output, and screenshots.
- Use deterministic, synthetic, redacted fixtures. Never commit a real credential, even if it has expired.
- Update shared contracts before changing platform-specific payload shapes.
- Keep Windows and macOS command names, JSON fields, exit codes, and redaction behavior aligned.
- Do not add a dependency when the standard library or an existing dependency is sufficient.
- Preserve unrelated work and keep pull requests focused.

## Adding or changing a provider

A provider change normally includes:

1. Provider metadata in the shared manifest (`shared/contracts/provider-manifest.json`).
2. A platform adapter and registration entry for each supported platform.
3. Synthetic parser fixtures covering success, authentication failure, quota windows, reset handling, cost, and service status where applicable.
4. Contract and locale updates.
5. Tests proving one provider failure does not block other providers.

Do not perform live provider tests without explicit authorization from the test account owner.

## Required checks

Run the smallest relevant tests while developing, then the full applicable set before opening a pull request. Full command lists live in the root [README.md § Validation](README.md#validation). At minimum:

```bash
pnpm run generate
pnpm run check
```

Visual or tray behavior changes also require a fresh native build and before/after evidence from the affected operating system. See [docs/acceptance/windows.md](docs/acceptance/windows.md) and [docs/acceptance/macos.md](docs/acceptance/macos.md).

## Pull requests

- Use a concise imperative title.
- Explain the user-visible behavior and why the change is needed.
- Identify security or privacy effects.
- List the exact checks that passed.
- Include screenshots for UI changes, with personal information removed.
- Keep generated files synchronized with their source contracts (`pnpm run generate`).

All contributions are submitted under the repository's [MIT License](LICENSE).
