# Security policy

TokenCue handles local authentication material and usage metadata. Security reports are treated seriously.

## Supported versions

TokenCue is currently a developer preview. Security fixes are applied to the latest commit on the default branch. There are no supported binary release channels yet.

## Reporting a vulnerability

**Do not open a public issue** for a suspected vulnerability.

Use GitHub's private vulnerability reporting form in the repository Security tab. Include:

- The affected platform and commit
- A minimal reproduction that does not contain real credentials
- Expected and observed behavior
- The security impact and any known preconditions
- Suggested remediation, if available

Do not upload raw cookies, API keys, OAuth tokens, browser databases, Keychain exports, Credential Manager exports, or unredacted diagnostic bundles. Replace sensitive values with clearly synthetic placeholders.

Maintainers will acknowledge reports on a best-effort basis, validate the issue, prepare a fix, and coordinate disclosure when appropriate. Please allow time for both native platforms and the shared contracts to be reviewed.

## Security boundaries

- Ordinary configuration files must contain only non-sensitive settings and secure-storage references.
- Logs, CLI output, diagnostics, fixtures, and error messages must not expose credentials.
- Plugins must not access arbitrary files, subprocesses, browser globals, undeclared network domains, or unapproved cookies.
- Redirects, oversized responses, timeouts, damaged caches, and non-interactive permission requests must fail safely.
- Automated tests must not access live browser sessions or native credential prompts.
- Browser sessions are never read automatically on first launch; the user chooses a provider and authorization source.
- Windows stores secrets via DPAPI and Windows Credential Manager integration; macOS uses a dedicated TokenCue Keychain namespace.

For data flow and trust boundaries used by the desktop applications, see [docs/architecture.md](docs/architecture.md). For the plugin host rules, see [docs/plugin-protocol.md](docs/plugin-protocol.md).
