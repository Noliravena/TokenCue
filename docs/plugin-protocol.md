# TokenCue provider plugin protocol v1

A TokenCue provider plugin is one UTF-8 `.js` or `.ts` file, no larger than **1 MiB**, that calls `defineProvider({...})` exactly once. TypeScript is transpiled with the checked-in Sucrase 3.35.1 asset under `shared/plugins/`. macOS evaluates the result with **JavaScriptCore**; Windows evaluates it with **`rquickjs`**. Both runtimes use the same prelude, manifest fields, output shape, approval binding, and fixtures.

Documentation index: [README.md](README.md). Related schemas live under `shared/contracts/`. A short pointer also exists at [`shared/contracts/README.md`](../shared/contracts/README.md).

## Manifest

The manifest declares:

- `schemaVersion: 1`
- Provider identity
- Fixed or setting-backed origins
- Plain and secure settings
- Optional authentication
- Optional browser-cookie capability
- Optional resource limits

A **source hash** is part of the saved approval binding, so editing a plugin invalidates prior approval.

### Origins

- Fixed endpoints require **HTTPS**.
- `https-or-loopback-http` is accepted only for a setting-backed localhost, `.local`, or loopback IP origin and requires typed confirmation.

### Resource limits

| Limit | Default | Maximum requestable |
| --- | --- | --- |
| Execution time | 10 seconds | 30 seconds |
| Response size | 1 MiB | 5 MiB |

Windows additionally bounds QuickJS memory and stack.

## Runtime context

`fetchUsage(ctx)` may return a snapshot directly or resolve it from a Promise. The frozen context contains:

| API | Behavior |
| --- | --- |
| `ctx.http.getJSON`, `ctx.http.get`, `ctx.http.postJSON` | Every request and redirect is checked against the approved origin set |
| `ctx.settings.get`, `ctx.settings.getSecret` | Only settings declared with the matching kind are readable |
| `ctx.browser.cookieHeader` | Only declared domains are accepted, and only after the desktop browser-authorization flow supplies a brokered value |
| Helpers | Bounded date, JWT, percentage, HTML, cache, and redacted logging helpers from `provider-plugin-prelude.js` |

## Capabilities plugins never receive

Plugins never receive:

- Arbitrary filesystem access
- Arbitrary credential stores
- Process / subprocess execution
- Node.js globals
- Browser DOM / unconstrained network APIs
- Native handles
- Module loaders, dynamic import, or runtime code generation

Network clients do not persist cookies, strip `Set-Cookie` from response headers, revalidate redirects, and cap header/cache sizes.

CLI execution without an interactive approval channel **fails closed**. Browser-cookie access is **desktop-only**.

## Output validation and redaction

A response must validate against `shared/contracts/plugin-output-v1.schema.json` before conversion to a native usage snapshot. Secrets and cookie values are redacted from logs and errors.

## Fixtures

Synthetic plugin fixtures and golden outputs live under `shared/fixtures/plugins/`. Use them for contract gates; never commit real credentials.

## Security references

- Architecture trust boundaries: [architecture.md](architecture.md)
- Vulnerability reporting: [../SECURITY.md](../SECURITY.md)
