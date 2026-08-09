# Shared contracts

Versioned JSON schemas, the provider manifest, and generated TypeScript helpers for TokenCue.

| Artifact | Role |
| --- | --- |
| `provider-manifest.json` | Authoritative catalog of providers and capabilities |
| `*.schema.json` | Usage, CLI, plugin, and lock-file schemas |
| `generated/providers.ts` | Generated TypeScript provider constants |

## Plugin protocol

The full sandboxed provider plugin host protocol is documented in:

**[../../docs/plugin-protocol.md](../../docs/plugin-protocol.md)**

Do not maintain a second full copy of that protocol under this folder.
